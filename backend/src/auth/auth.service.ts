import { Injectable, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { DbService } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { assertStrongPassword } from './password-policy';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp';

// Empreinte factice : un compte inconnu coûte le même temps de calcul qu'un compte réel (pas de devinette d'adresses par le temps de réponse).
let DUMMY: Promise<string> | null = null;
const dummyHash = () => (DUMMY ??= argon2.hash('agritrace-dummy-password', { type: argon2.argon2id }));

const MAX_FAILED = 5;            // échecs avant verrouillage d'un couple (compte, adresse)
const MAX_FAILED_ACCOUNT = 50;   // échecs toutes adresses confondues avant verrouillage du compte (attaque répartie)
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

  async login(email: string, password: string, ip?: string, deviceLabel?: string, webClient = false, otp?: string) {
    const [u] = await this.db.query(
      `SELECT id, password_hash, status, failed_logins, locked_until, totp_enabled, totp_secret, totp_recovery, totp_last_step FROM users WHERE email = $1`,
      [email],
    );
    const where = ip || 'inconnue';
    const invalid = new UnauthorizedException('Identifiants invalides');
    // Même réponse et même durée pour : compte inconnu, désactivé, copié sans mot de passe ('!'), verrouillé ou mauvais mot de passe.
    if (!u || u.status !== 'active' || String(u.password_hash).startsWith('!')) { await argon2.verify(await dummyHash(), password).catch(() => false); throw invalid; }
    const [lf] = await this.db.query(`SELECT locked_until FROM login_failures WHERE user_id = $1 AND ip = $2`, [u.id, where]);
    if ((u.locked_until && new Date(u.locked_until) > new Date()) || (lf?.locked_until && new Date(lf.locked_until) > new Date())) {
      await argon2.verify(await dummyHash(), password).catch(() => false);
      await this.audit.log({ actorUserId: u.id, action: 'auth.login_while_locked', ip });
      throw invalid;
    }

    if (!(await argon2.verify(u.password_hash, password))) {
      await this.recordFailure(u.id, where);
      await this.audit.log({ actorUserId: u.id, action: 'auth.login_failed', ip });
      throw invalid;
    }

    // Double authentification : le mot de passe est correct, le second facteur est exigé (code à 6 chiffres ou code de secours).
    let usedStep: number | null = null; let usedRecovery: string | null = null;
    if (u.totp_enabled) {
      if (!otp) throw new UnauthorizedException({ message: 'Code de vérification requis', code: 'OTP_REQUIRED' });
      const code = otp.replace(/\s|-/g, '');
      usedStep = verifyTotp(decryptSecret(u.totp_secret), code, u.totp_last_step == null ? null : Number(u.totp_last_step));
      if (usedStep == null) { const h = sha256(code.toLowerCase()); if ((u.totp_recovery ?? []).includes(h)) usedRecovery = h; }
      if (usedStep == null && !usedRecovery) {
        await this.recordFailure(u.id, where);
        await this.audit.log({ actorUserId: u.id, action: 'auth.otp_failed', ip });
        throw new UnauthorizedException({ message: 'Code de vérification invalide', code: 'OTP_INVALID' });
      }
      if (usedStep != null) await this.db.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [u.id, usedStep]);
      if (usedRecovery) { await this.db.query(`UPDATE users SET totp_recovery = array_remove(totp_recovery, $2) WHERE id = $1`, [u.id, usedRecovery]); await this.audit.log({ actorUserId: u.id, action: 'auth.recovery_code_used', ip }); }
    }
    await this.db.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [u.id]);
    await this.db.query(`DELETE FROM login_failures WHERE user_id = $1 AND ip = $2`, [u.id, where]);

    // Coachs, délégués et agents de terrain : application mobile uniquement. Refus seulement si TOUS leurs accès le sont (un compte qui administre aussi une autre coopérative peut se connecter).
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

  /** Échec : verrouille le couple (compte, adresse) après MAX_FAILED, le compte entier après MAX_FAILED_ACCOUNT (toutes adresses). */
  private async recordFailure(userId: string, ip: string) {
    await this.db.query(
      `INSERT INTO login_failures(user_id, ip, failures) VALUES ($1,$2,1)
       ON CONFLICT (user_id, ip) DO UPDATE SET failures = login_failures.failures + 1, updated_at = now(),
         locked_until = CASE WHEN login_failures.failures + 1 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE login_failures.locked_until END`,
      [userId, ip, MAX_FAILED, String(LOCK_MINUTES)],
    );
    await this.db.query(
      `UPDATE users SET failed_logins = failed_logins + 1,
              locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
        WHERE id = $1`,
      [userId, MAX_FAILED_ACCOUNT, String(LOCK_MINUTES)],
    );
  }

  // ---------- Double authentification ----------
  async twoFactorStatus(userId: string) {
    const [u] = await this.db.query(`SELECT totp_enabled, cardinality(totp_recovery) AS left FROM users WHERE id = $1`, [userId]);
    return { enabled: !!u?.totp_enabled, recovery_codes_left: Number(u?.left ?? 0) };
  }
  /** Prépare l'activation : génère un secret (non actif tant qu'un code valide n'a pas été saisi). */
  async twoFactorSetup(userId: string) {
    const [u] = await this.db.query(`SELECT email, totp_enabled FROM users WHERE id = $1`, [userId]);
    if (u.totp_enabled) throw new BadRequestException('La double authentification est déjà active');
    const secret = newTotpSecret();
    await this.db.query(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [userId, encryptSecret(secret)]);
    return { secret, otpauth_uri: otpauthUri(secret, u.email) };
  }
  async twoFactorEnable(userId: string, code: string) {
    const [u] = await this.db.query(`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, [userId]);
    if (u.totp_enabled) throw new BadRequestException('La double authentification est déjà active');
    if (!u.totp_secret) throw new BadRequestException("Démarrez d'abord la configuration");
    const step = verifyTotp(decryptSecret(u.totp_secret), code.replace(/\s/g, ''));
    if (step == null) throw new BadRequestException('Code invalide');
    const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    await this.db.query(`UPDATE users SET totp_enabled = true, totp_last_step = $2, totp_recovery = $3 WHERE id = $1`, [userId, step, codes.map((c) => sha256(c))]);
    await this.audit.log({ actorUserId: userId, action: 'auth.2fa_enabled' });
    return { recovery_codes: codes };
  }
  async twoFactorDisable(userId: string, password: string, code: string) {
    const [u] = await this.db.query(`SELECT password_hash, totp_secret, totp_enabled, totp_recovery FROM users WHERE id = $1`, [userId]);
    if (!u.totp_enabled) throw new BadRequestException("La double authentification n'est pas active");
    if (!(await argon2.verify(u.password_hash, password))) throw new UnauthorizedException('Mot de passe incorrect');
    const c = code.replace(/\s|-/g, '');
    if (verifyTotp(decryptSecret(u.totp_secret), c) == null && !(u.totp_recovery ?? []).includes(sha256(c.toLowerCase()))) throw new UnauthorizedException('Code invalide');
    await this.db.query(`UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_recovery = '{}', totp_last_step = NULL WHERE id = $1`, [userId]);
    await this.audit.log({ actorUserId: userId, action: 'auth.2fa_disabled' });
  }
  /** Réinitialisation par un administrateur (téléphone perdu) : la personne devra reconfigurer. */
  async twoFactorReset(userId: string, actorId: string) {
    await this.db.query(`UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_recovery = '{}', totp_last_step = NULL WHERE id = $1`, [userId]);
    await this.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await this.audit.log({ actorUserId: actorId, action: 'auth.2fa_reset', entityType: 'user', entityId: userId });
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
      // Tolérance : l'ancien jeton, présenté dans les 30 s qui suivent sa rotation (requêtes simultanées de l'application), est accepté une fois de plus.
      const [g] = await this.db.query(`SELECT 1 AS ok FROM user_sessions WHERE id = $1 AND prev_refresh_token_hash = $2 AND rotated_at > now() - interval '30 seconds'`, [sid, sha256(secret)]).catch(() => []);
      if (g) {
        const again = randomBytes(48).toString('base64url');
        await this.db.query(`UPDATE user_sessions SET prev_refresh_token_hash = refresh_token_hash, refresh_token_hash = $2, rotated_at = now() WHERE id = $1`, [sid, sha256(again)]);
        return this.issue(s.user_id, sid, again);
      }
      await this.db.query(`UPDATE user_sessions SET revoked_at = now() WHERE id = $1`, [sid]);
      await this.audit.log({ actorUserId: s.user_id, action: 'auth.refresh_reuse_detected' });
      throw new UnauthorizedException();
    }
    const next = randomBytes(48).toString('base64url');
    await this.db.query(`UPDATE user_sessions SET prev_refresh_token_hash = refresh_token_hash, refresh_token_hash = $2, rotated_at = now() WHERE id = $1`, [sid, sha256(next)]);
    return this.issue(s.user_id, sid, next);
  }

  /** Changement de mot de passe par l'utilisateur : l'ancien est exigé, les autres sessions sont fermées. */
  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const [u] = await this.db.query(`SELECT password_hash, email FROM users WHERE id = $1`, [userId]);
    if (!u || String(u.password_hash).startsWith('!') || !(await argon2.verify(u.password_hash, current))) throw new UnauthorizedException('Mot de passe actuel incorrect');
    assertStrongPassword(next, u.email);
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
    // La caissière qui se déconnecte du logiciel quitte aussi la caisse (la caisse ne se clôture pas : ni comptage, ni écart).
    const orgs = await this.db.query<{ organization_id: string }>(`SELECT organization_id FROM user_organizations WHERE user_id = $1`, [userId]);
    for (const o of orgs) {
      await this.db.tx(o.organization_id, (c) => c.query(`UPDATE cash_sessions SET status = 'closed', closed_by = $1, closed_at = now() WHERE opened_by = $1 AND status = 'open'`, [userId]));
    }
    await this.audit.log({ actorUserId: userId, action: 'auth.logout' });
  }
}
