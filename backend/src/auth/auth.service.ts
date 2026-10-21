import { Injectable, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }

  async login(email: string, password: string, ip?: string, deviceLabel?: string, webClient = false) {
    const [u] = await this.db.query(
      `SELECT id, password_hash, status, failed_logins, locked_until FROM users WHERE email = $1`,
      [email],
    );
    const invalid = new UnauthorizedException('Identifiants invalides');
    if (!u || u.status !== 'active' || String(u.password_hash).startsWith('!')) throw invalid; // '!' = compte copié depuis un serveur local, sans mot de passe ici
    if (u.locked_until && new Date(u.locked_until) > new Date())
      throw new UnauthorizedException('Compte temporairement verrouillé');

    if (!(await argon2.verify(u.password_hash, password))) {
      await this.db.query(
        `UPDATE users SET failed_logins = failed_logins + 1,
                locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
          WHERE id = $1`,
        [u.id, MAX_FAILED, String(LOCK_MINUTES)],
      );
      await this.audit.log({ actorUserId: u.id, action: 'auth.login_failed', ip });
      throw invalid;
    }
    await this.db.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [u.id]);

    // Coachs, collecteurs et agents de terrain : application mobile uniquement. Refus seulement si TOUS leurs accès le sont (un compte qui administre aussi une autre coopérative peut se connecter).
    if (webClient) {
      // `roles` est protégée par organisation (RLS) : on lit le drapeau dans le contexte de chaque coopérative du compte.
      const links = await this.db.query<{ organization_id: string; role_id: string }>(`SELECT organization_id, role_id FROM user_organizations WHERE user_id = $1 AND status = 'active'`, [u.id]);
      const m: { mobile_only: boolean }[] = [];
      for (const l of links) m.push({ mobile_only: !!(await this.db.tx(l.organization_id, (c) => c.query(`SELECT mobile_only FROM roles WHERE id = $1`, [l.role_id]))).rows[0]?.mobile_only });
      if (m.length && m.every((x) => x.mobile_only)) {
        await this.audit.log({ actorUserId: u.id, action: 'auth.login_refused_mobile_only', ip });
        throw new ForbiddenException({ message: 'Ce compte se connecte uniquement depuis l\'application mobile AgriTrace.', code: 'MOBILE_ONLY' });
      }
    }

    let deviceId: string | null = null;
    if (deviceLabel) {
      const [d] = await this.db.query(
        `INSERT INTO devices(user_id, label) VALUES ($1,$2) RETURNING id`,
        [u.id, deviceLabel],
      );
      deviceId = d.id;
    }
    const tokens = await this.openSession(u.id, deviceId, ip);
    await this.audit.log({ actorUserId: u.id, action: 'auth.login', ip });
    return tokens;
  }

  private async openSession(userId: string, deviceId: string | null, ip?: string) {
    const refresh = randomBytes(48).toString('base64url');
    const days = Number(process.env.REFRESH_TTL_DAYS ?? 30);
    const [s] = await this.db.query(
      `INSERT INTO user_sessions(user_id, device_id, refresh_token_hash, expires_at, ip)
       VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5) RETURNING id`,
      [userId, deviceId, sha256(refresh), String(days), ip ?? null],
    );
    return this.issue(userId, s.id, refresh);
  }

  private async issue(userId: string, sessionId: string, refresh: string) {
    const access = await this.jwt.signAsync({ sub: userId, sid: sessionId });
    return {
      access_token: access,
      refresh_token: `${sessionId}.${refresh}`,
      token_type: 'Bearer',
      expires_in: Number(process.env.JWT_ACCESS_TTL ?? 900),
    };
  }

  /** Rotation : l'ancien jeton de renouvellement devient invalide ; sa réutilisation révoque la session. */
  async refresh(token: string) {
    const [sid, secret] = token.split('.');
    if (!sid || !secret) throw new UnauthorizedException();
    const [s] = await this.db.query(
      `SELECT id, user_id, refresh_token_hash, expires_at, revoked_at FROM user_sessions WHERE id = $1`,
      [sid],
    ).catch(() => []);
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) throw new UnauthorizedException();
    if (s.refresh_token_hash !== sha256(secret)) {
      await this.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE id = $1`, [sid]);
      await this.audit.log({ actorUserId: s.user_id, action: 'auth.refresh_reuse_detected' });
      throw new UnauthorizedException();
    }
    const next = randomBytes(48).toString('base64url');
    await this.db.query(`UPDATE user_sessions SET refresh_token_hash = $2 WHERE id = $1`, [sid, sha256(next)]);
    return this.issue(s.user_id, sid, next);
  }

  /** Changement de mot de passe par l'utilisateur : l'ancien est exigé, les autres sessions sont fermées. */
  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const [u] = await this.db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (!u || String(u.password_hash).startsWith('!') || !(await argon2.verify(u.password_hash, current))) throw new UnauthorizedException('Mot de passe actuel incorrect');
    if (await argon2.verify(u.password_hash, next)) throw new BadRequestException("Le nouveau mot de passe doit être différent de l'actuel");
    await this.db.query(`UPDATE users SET password_hash = $2, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = $1`, [userId, await this.hashPassword(next)]);
    await this.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [userId, sessionId]);
    await this.audit.log({ actorUserId: userId, action: 'auth.password_changed' });
  }

  /** Mot de passe temporaire posé par un administrateur : le titulaire devra le changer à la prochaine connexion. */
  async setTemporaryPassword(userId: string, temp: string) {
    await this.db.query(`UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1`, [userId, await this.hashPassword(temp)]);
    await this.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }

  async logout(sessionId: string, userId: string) {
    await this.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
    await this.audit.log({ actorUserId: userId, action: 'auth.logout' });
  }
}
