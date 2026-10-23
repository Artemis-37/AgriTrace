import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

class ReasonDto { @IsString() @Length(3, 300) reason: string; }
class RoleChangeDto { @IsUUID() role_id: string; @IsString() @Length(3, 300) reason: string; }

/**
 * Suspension, réactivation, changement de rôle et révocation de sessions (CDC §27.7).
 * Le garde d'accès revérifie l'appartenance et les permissions à chaque requête : une suspension ou un changement de rôle prend effet immédiatement,
 * y compris pour la synchronisation mobile (les appels suivants reçoivent 403 et l'appareil doit verrouiller et purger ses données locales).
 */
@ApiTags('accès et sessions')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('users')
export class AccessAdminController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private async member(c: PoolClient, orgId: string, userId: string) {
    const rows = (await c.query(`SELECT user_id, role_id, status FROM user_organizations WHERE organization_id = $1 AND user_id = $2 FOR UPDATE`, [orgId, userId])).rows;
    if (!rows.length) throw new NotFoundException('Utilisateur introuvable dans cette coopérative');
    return rows;
  }
  private async event(c: PoolClient, req: any, userId: string, action: string, reason: string | undefined, details: object = {}) {
    await c.query(`INSERT INTO user_access_events(organization_id, user_id, action, reason, details, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.org.id, userId, action, reason ?? null, JSON.stringify(details), req.user.id]);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: `user.${action}`, entityType: 'user', entityId: userId, details: { reason, ...details } });
  }
  /** Sessions révoquées seulement si la personne n'a plus aucun accès actif ailleurs (les sessions sont communes à toutes ses coopératives). */
  private async revokeIfNoOtherAccess(c: PoolClient, orgId: string, userId: string) {
    const other = (await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id <> $2 AND status = 'active'`, [userId, orgId])).rowCount;
    if (other) return 0;
    return (await c.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId])).rowCount ?? 0;
  }

  @Post(':id/suspend')
  @RequirePermissions('users:suspend')
  async suspend(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @Req() req: any) {
    if (id === req.user.id) throw new ConflictException('Impossible de suspendre son propre compte');
    return this.db.tx(req.org.id, async (c) => {
      const rows = await this.member(c, req.org.id, id);
      if (rows.every((r) => r.status === 'suspended')) return { id, status: 'suspended', sessions_revoked: 0 };
      // Garde-fou : conserver au moins un compte capable d'administrer les accès
      const admins = (await c.query(
        `SELECT count(DISTINCT uo.user_id)::int AS n FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id
          WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = 'users:suspend' AND uo.user_id <> $2`, [req.org.id, id])).rows[0].n;
      if (!admins) throw new ConflictException('Il doit rester au moins un administrateur actif');
      await c.query(`UPDATE user_organizations SET status = 'suspended' WHERE organization_id = $1 AND user_id = $2`, [req.org.id, id]);
      const revoked = await this.revokeIfNoOtherAccess(c, req.org.id, id);
      await this.event(c, req, id, 'suspend', b.reason, { sessions_revoked: revoked });
      await this.notif.notifyPermission(c, req.org.id, 'users:suspend', { kind: 'user_suspended', severity: 'warning', title: 'Compte suspendu', body: b.reason, entityType: 'user', entityId: id }, req.user.id);
      return { id, status: 'suspended', sessions_revoked: revoked };
    });
  }

  @Post(':id/reactivate')
  @RequirePermissions('users:suspend')
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      await this.member(c, req.org.id, id);
      const u = (await c.query(`SELECT status FROM users WHERE id = $1`, [id])).rows[0];
      if (u.status !== 'active') throw new ConflictException('Compte désactivé au niveau de la plateforme');
      await c.query(`UPDATE user_organizations SET status = 'active' WHERE organization_id = $1 AND user_id = $2`, [req.org.id, id]);
      await this.event(c, req, id, 'reactivate', b.reason);
      return { id, status: 'active' };
    });
  }

  @Post(':id/revoke-sessions')
  @RequirePermissions('users:suspend')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      await this.member(c, req.org.id, id);
      const other = (await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id <> $2 AND status = 'active'`, [id, req.org.id])).rowCount;
      if (other) throw new ConflictException('Cette personne a aussi accès à une autre coopérative : suspendre son accès ici suffit à bloquer cette coopérative');
      const n = (await c.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id])).rowCount ?? 0;
      await this.event(c, req, id, 'revoke_sessions', b.reason, { sessions_revoked: n });
      return { id, sessions_revoked: n };
    });
  }

  @Post(':id/role')
  @RequirePermissions('users:change_role')
  async changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() b: RoleChangeDto, @Req() req: any) {
    if (id === req.user.id) throw new ConflictException('Impossible de modifier son propre rôle');
    return this.db.tx(req.org.id, async (c) => {
      const rows = await this.member(c, req.org.id, id);
      const role = (await c.query(`SELECT id, code FROM roles WHERE id = $1 AND organization_id = $2`, [b.role_id, req.org.id])).rows[0];
      if (!role) throw new BadRequestException('Rôle inconnu pour cette coopérative');
      const perms = (await c.query(`SELECT permission_code FROM role_permissions WHERE role_id = $1`, [b.role_id])).rows.map((r) => r.permission_code);
      const missing = perms.filter((p) => !req.org.permissions.has(p));
      if (missing.length) throw new ForbiddenException(`Permissions non détenues : ${missing.join(', ')}`);
      const status = rows.some((r) => r.status === 'active') ? 'active' : 'suspended';
      const before = rows.map((r) => r.role_id);
      await c.query(`DELETE FROM user_organizations WHERE organization_id = $1 AND user_id = $2`, [req.org.id, id]);
      await c.query(`INSERT INTO user_organizations(user_id, organization_id, role_id, status, created_by) VALUES ($1,$2,$3,$4,$5)`, [id, req.org.id, b.role_id, status, req.user.id]);
      const left = (await c.query(
        `SELECT count(DISTINCT uo.user_id)::int AS n FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id
          WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = 'users:suspend'`, [req.org.id])).rows[0].n;
      if (!left) throw new ConflictException('Il doit rester au moins un administrateur actif');
      await this.event(c, req, id, 'role_change', b.reason, { from: before, to: b.role_id, role: role.code });
      await this.notif.notifyUsers(c, req.org.id, [id], { kind: 'role_changed', title: 'Vos droits ont été modifiés', body: `Nouveau rôle : ${role.code}`, entityType: 'user', entityId: id });
      return { id, role_id: b.role_id, role_code: role.code };
    });
  }

  /** Ajoute un rôle à la personne (plusieurs rôles possibles : ses droits sont la somme de ceux de ses rôles). */
  @Post(':id/roles')
  @RequirePermissions('users:change_role')
  async addRole(@Param('id', ParseUUIDPipe) id: string, @Body() b: RoleChangeDto, @Req() req: any) {
    if (id === req.user.id) throw new ConflictException('Impossible de modifier ses propres rôles');
    return this.db.tx(req.org.id, async (c) => {
      const rows = await this.member(c, req.org.id, id);
      const role = (await c.query(`SELECT id, code FROM roles WHERE id = $1 AND organization_id = $2`, [b.role_id, req.org.id])).rows[0];
      if (!role) throw new BadRequestException('Rôle inconnu pour cette coopérative');
      if (rows.some((r) => r.role_id === b.role_id)) throw new ConflictException('Cette personne a déjà ce rôle');
      const perms = (await c.query(`SELECT permission_code FROM role_permissions WHERE role_id = $1`, [b.role_id])).rows.map((r) => r.permission_code);
      const missing = perms.filter((p) => !req.org.permissions.has(p));
      if (missing.length) throw new ForbiddenException(`Permissions non détenues : ${missing.join(', ')}`);
      const status = rows.some((r) => r.status === 'active') ? 'active' : 'suspended';
      await c.query(`INSERT INTO user_organizations(user_id, organization_id, role_id, status, created_by) VALUES ($1,$2,$3,$4,$5)`, [id, req.org.id, b.role_id, status, req.user.id]);
      await this.event(c, req, id, 'role_add', b.reason, { role: role.code });
      await this.notif.notifyUsers(c, req.org.id, [id], { kind: 'role_changed', title: 'Vos droits ont été modifiés', body: `Rôle ajouté : ${role.code}`, entityType: 'user', entityId: id });
      return { id, role_id: b.role_id, role_code: role.code };
    });
  }

  /** Retire un des rôles de la personne ; elle doit en garder au moins un. */
  @Delete(':id/roles/:roleId')
  @RequirePermissions('users:change_role')
  async removeRole(@Param('id', ParseUUIDPipe) id: string, @Param('roleId', ParseUUIDPipe) roleId: string, @Query('reason') reason: string, @Req() req: any) {
    if (id === req.user.id) throw new ConflictException('Impossible de modifier ses propres rôles');
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Motif requis (3 caractères minimum)');
    return this.db.tx(req.org.id, async (c) => {
      const rows = await this.member(c, req.org.id, id);
      if (!rows.some((r) => r.role_id === roleId)) throw new NotFoundException("Cette personne n'a pas ce rôle");
      if (rows.length === 1) throw new ConflictException('Une personne doit garder au moins un rôle : utilisez « Remplacer » pour en changer');
      const role = (await c.query(`SELECT code FROM roles WHERE id = $1`, [roleId])).rows[0];
      await c.query(`DELETE FROM user_organizations WHERE organization_id = $1 AND user_id = $2 AND role_id = $3`, [req.org.id, id, roleId]);
      const left = (await c.query(
        `SELECT count(DISTINCT uo.user_id)::int AS n FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id
          WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = 'users:suspend'`, [req.org.id])).rows[0].n;
      if (!left) throw new ConflictException('Il doit rester au moins un administrateur actif');
      await this.event(c, req, id, 'role_remove', reason, { role: role?.code });
      await this.notif.notifyUsers(c, req.org.id, [id], { kind: 'role_changed', title: 'Vos droits ont été modifiés', body: `Rôle retiré : ${role?.code}`, entityType: 'user', entityId: id });
      return { id, removed: roleId };
    });
  }

  @Get(':id/access-history')
  @RequirePermissions('users:read')
  history(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT e.id, e.action, e.reason, e.details, e.created_at, a.full_name AS actor_name FROM user_access_events e LEFT JOIN users a ON a.id = e.actor_id
        WHERE e.user_id = $1 ORDER BY e.id`, [id])).rows);
  }
}
