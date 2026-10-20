import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../db/db.service';
import { IS_PUBLIC, NO_ORG, PERMISSIONS, PLATFORM_ADMIN } from './decorators';
import { hasAllPermissions } from './permission-evaluator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Garde globale : authentification, session non révoquée, organisation explicite
 * (en-tête X-Organization-Id), appartenance et permissions — vérifiées à chaque requête.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Jeton manquant');

    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }

    const rows = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.is_platform_admin
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
          AND s.expires_at > now() AND u.status = 'active'`,
      [payload.sid, payload.sub],
    );
    if (!rows.length) throw new UnauthorizedException('Session révoquée ou expirée');
    req.user = { ...rows[0], sessionId: payload.sid };

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets)) {
      if (!req.user.is_platform_admin) throw new ForbiddenException('Réservé aux administrateurs de plateforme');
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(NO_ORG, targets)) return true;

    const orgId = req.headers['x-organization-id'];
    if (typeof orgId !== 'string' || !UUID_RE.test(orgId))
      throw new ForbiddenException('En-tête X-Organization-Id requis');

    const org = await this.db.query(`SELECT id, status FROM organizations WHERE id = $1`, [orgId]);
    if (!org.length || org[0].status !== 'active') throw new ForbiddenException('Organisation inaccessible');

    // Une organisation inconnue ou non attribuée donne la même réponse : pas de fuite d'existence.
    const perms = await this.db.query<{ permission_code: string }>(
      `SELECT DISTINCT rp.permission_code
         FROM user_organizations uo
         JOIN role_permissions rp ON rp.role_id = uo.role_id
        WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.status = 'active'`,
      [req.user.id, orgId],
    );
    const member = await this.db.query(
      `SELECT 1 FROM user_organizations WHERE user_id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,
      [req.user.id, orgId],
    );
    if (!member.length) throw new ForbiddenException('Organisation inaccessible');

    const granted = new Set(perms.map((p) => p.permission_code));
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    if (!hasAllPermissions(granted, required)) throw new ForbiddenException('Permission insuffisante');

    // Au central, une coopérative gérée par un serveur local est en lecture seule : la réplication va dans un seul sens.
    if (process.env.AGRITRACE_MODE !== 'local' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const owned = await this.db.query(`SELECT 1 FROM replication_sites WHERE organization_id = $1`, [orgId]);
      if (owned.length) throw new ForbiddenException('Cette coopérative est gérée par son serveur local : le serveur central est en lecture seule pour elle.');
    }

    req.org = { id: orgId, permissions: granted };
    return true;
  }
}
