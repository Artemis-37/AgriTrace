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
import { findWorkstation, workstationsRequired } from './workstation-policy';

/** Droits sensibles : avec REQUIRE_2FA=true, leurs titulaires doivent activer la double authentification avant de poursuivre. */
const SENSITIVE = ['users:manage', 'roles:manage', 'audit:read', 'finance:reverse', 'cash:manage', 'accounting:post', 'accounting:close', 'payments:confirm', 'loans:approve', 'loans:disburse', 'stock:adjust'];
export const needsTwoFactor = (user: any, granted: Set<string>) =>
  process.env.REQUIRE_2FA === 'true' && !user.totp_enabled && (!!user.is_platform_admin || SENSITIVE.some((p) => granted.has(p)));
const TWO_FACTOR_OPEN = /^\/v1\/(auth\/(2fa(\/setup|\/enable)?|logout|change-password)|me|organizations)\/?(\?.*)?$/;
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
      `SELECT u.id, u.email, u.full_name, u.is_platform_admin, u.must_change_password, u.totp_enabled
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
          AND s.expires_at > now() AND u.status = 'active'`,
      [payload.sid, payload.sub],
    );
    if (!rows.length) throw new UnauthorizedException('Session révoquée ou expirée');
    req.user = { ...rows[0], sessionId: payload.sid };
    // Mot de passe temporaire : seules les routes de changement de mot de passe, de déconnexion, « me » et la liste des coopératives restent ouvertes.
    if (rows[0].must_change_password && !/^\/v1\/(auth\/change-password|auth\/logout|me|organizations)\/?(\?.*)?$/.test(String(req.originalUrl ?? req.url)) )
      throw new ForbiddenException({ message: 'Vous devez changer votre mot de passe temporaire avant de continuer', code: 'PASSWORD_CHANGE_REQUIRED' });

    const url = String(req.originalUrl ?? req.url);
    if (req.user.is_platform_admin && needsTwoFactor(req.user, new Set()) && !TWO_FACTOR_OPEN.test(url))
      throw new ForbiddenException({ message: 'Activez la double authentification pour continuer', code: 'TWO_FACTOR_REQUIRED' });
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
    // Accès support : un administrateur de plateforme peut entrer, en le demandant expressément (X-Support-Mode), dans toute organisation active
    // (coopérative ou exportateur) avec l'ensemble des droits ; chaque modification est consignée au journal d'audit de l'organisation.
    const support = !member.length && !!req.user.is_platform_admin && req.headers['x-support-mode'] === '1';
    if (!member.length && !support) throw new ForbiddenException('Organisation inaccessible');
    if (support) {
      const all = await this.db.query<{ code: string }>(`SELECT code FROM permissions WHERE code <> 'cash:session'`);
      for (const r of all) perms.push({ permission_code: r.code });
    }

    // Comptes réservés au mobile (coachs, délégués, agents de terrain) : refusés depuis le portail web, qui s'annonce par « X-Client: web ».
    // C'est une règle d'usage (interface), pas une barrière de sécurité : l'authentification et les droits restent vérifiés comme pour tout compte.
    if (req.headers['x-client'] === 'web' && !req.user.is_platform_admin) {
      const mo = (await this.db.tx(orgId, (c) => c.query(
        `SELECT r.mobile_only FROM user_organizations uo JOIN roles r ON r.id = uo.role_id WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.status = 'active'`, [req.user.id, orgId]))).rows as { mobile_only: boolean }[];
      const isCollector = ((await this.db.tx(orgId, (c) => c.query(`SELECT 1 FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id]))).rowCount ?? 0) > 0;
      if ((mo.length > 0 && mo.every((x) => x.mobile_only)) || isCollector)
        throw new ForbiddenException({ message: 'Ce compte se connecte uniquement depuis l\'application mobile AgriTrace.', code: 'MOBILE_ONLY' });
    }

    const granted = new Set(perms.map((p) => p.permission_code));
    if (needsTwoFactor(req.user, granted) && !TWO_FACTOR_OPEN.test(String(req.originalUrl ?? req.url)))
      throw new ForbiddenException({ message: 'Activez la double authentification pour continuer', code: 'TWO_FACTOR_REQUIRED' });
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    if (!hasAllPermissions(granted, required)) throw new ForbiddenException('Permission insuffisante');

    // Au central, une coopérative gérée par un serveur local est en lecture seule : la réplication va dans un seul sens.
    if (process.env.AGRITRACE_MODE !== 'local' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const owned = await this.db.query(`SELECT 1 FROM replication_sites WHERE organization_id = $1`, [orgId]);
      if (owned.length) throw new ForbiddenException('Cette coopérative est gérée par son serveur local : le serveur central est en lecture seule pour elle.');
    }

    // Poste associé (jeton propre au poste). Si la coopérative l'exige, un appareil inconnu ou révoqué est refusé, même avec un bon mot de passe.
    const dt = req.headers['x-device-token'];
    req.workstation = await findWorkstation(this.db, orgId, typeof dt === 'string' ? dt : undefined);
    if (!req.workstation && (await workstationsRequired(this.db, orgId)))
      throw new ForbiddenException({ statusCode: 403, message: 'Ce poste n\'est pas associé à la coopérative. Demandez un code d\'association à votre administrateur.', code: 'workstation_required' });

    req.org = { id: orgId, permissions: granted, support };
    if (support) {
      const method = String(req.method);
      const u = String(req.originalUrl ?? req.url).split('?')[0];
      const entering = method === 'GET' && /^\/v1\/me\/?$/.test(u);
      if (entering || !['GET', 'HEAD', 'OPTIONS'].includes(method))
        await this.db.tx(orgId, (c) => c.query(`INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, details) VALUES ($1,$2,$3,'organization',$4)`,
          [orgId, req.user.id, entering ? 'support.enter' : 'support.intervention', JSON.stringify({ method, path: u, by: req.user.email })]));
    }
    return true;
  }
}
