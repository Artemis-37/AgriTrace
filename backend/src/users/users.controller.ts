import { HttpCode, BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { assertStrongPassword } from '../auth/password-policy';
import { randomBytes } from 'crypto';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../db/db.service';
import { STANDARD_ROLES } from './standard-roles';

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @Length(2, 200) full_name: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @MinLength(10) password: string;
  @IsUUID() role_id: string;
  /** Rôles supplémentaires (cumul) : les droits de la personne sont la somme de ceux de ses rôles. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) role_ids?: string[];
  /** Code (identifiant) de l'intervenant ; attribué automatiquement s'il est omis. */
  @IsOptional() @Matches(/^[A-Z0-9][A-Z0-9-]{1,29}$/, { message: 'Code : 2 à 30 caractères, majuscules, chiffres et tirets' }) member_code?: string;
}
class MemberCodeDto {
  @Matches(/^[A-Z0-9][A-Z0-9-]{1,29}$/, { message: 'Code : 2 à 30 caractères, majuscules, chiffres et tirets' }) code: string;
}

class CreateRoleDto {
  @Matches(/^[a-z0-9_]{2,40}$/) code: string;
  @IsString() @Length(2, 100) name: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @IsString({ each: true }) permissions: string[];
  /** Les comptes de ce rôle se connectent uniquement depuis l'application mobile (délégués, coachs, agents de terrain). */
  @IsOptional() @IsBoolean() mobile_only?: boolean;
}

@ApiTags('users')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class UsersController {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  @RequirePermissions('users:read')
  list(@Req() req: any) {
    // La table des rôles est protégée par RLS : la lecture doit se faire dans le contexte de l'organisation
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.status, (SELECT mc.code FROM member_codes mc WHERE mc.organization_id = uo.organization_id AND mc.user_id = u.id) AS member_code,
              string_agg(r.name, ', ' ORDER BY r.name) AS role_name, string_agg(r.code, ', ' ORDER BY r.code) AS role_code,
              array_agg(r.code ORDER BY r.code) AS role_codes, array_agg(r.id ORDER BY r.code) AS role_ids,
              CASE WHEN bool_or(uo.status = 'active') THEN 'active' ELSE 'suspended' END AS membership_status
         FROM user_organizations uo
         JOIN users u ON u.id = uo.user_id
         JOIN roles r ON r.id = uo.role_id
        WHERE uo.organization_id = $1
        GROUP BY u.id, uo.organization_id ORDER BY u.full_name`,
      [req.org.id])).rows);
  }

  /** Modifie le code (identifiant) d'un intervenant de la coopérative. */
  @Put('users/:id/member-code')
  @RequirePermissions('users:manage')
  async setMemberCode(@Param('id', ParseUUIDPipe) id: string, @Body() b: MemberCodeDto, @Req() req: any) {
    try {
      const n = await this.db.tx(req.org.id, async (c) => {
        if (!(await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2`, [id, req.org.id])).rowCount) throw new NotFoundException('Intervenant introuvable');
        return (await c.query(`UPDATE member_codes SET code = $3 WHERE user_id = $1 AND organization_id = $2`, [id, req.org.id, b.code])).rowCount;
      });
      if (!n) throw new NotFoundException('Intervenant introuvable');
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Ce code est déjà attribué à un autre intervenant');
      throw e;
    }
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'user.member_code', entityType: 'user', entityId: id, details: { code: b.code } });
    return { ok: true, code: b.code };
  }

  @Get('roles')
  @RequirePermissions('users:read')
  roles(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) =>
      (await c.query(`SELECT id, code, name FROM roles WHERE organization_id = $1 ORDER BY name`, [req.org.id])).rows,
    );
  }

  /** Rôles types disponibles et état (déjà créé ou non) pour cette coopérative. */
  @Get('roles/templates')
  @RequirePermissions('users:read')
  async templates(@Req() req: any) {
    const have = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT code FROM roles WHERE organization_id = $1`, [req.org.id])).rows.map((r) => r.code));
    return Object.entries(STANDARD_ROLES).map(([code, t]) => ({ code, name: t.name, description: t.description, hidden: t.hidden, created: have.includes(code) }));
  }

  /** Crée un rôle type (idempotent). Seul un administrateur qui détient lui-même ces permissions peut l'accorder. */
  @Post('roles/standard')
  @RequirePermissions('roles:manage')
  async createStandard(@Body() b: { code: string }, @Req() req: any) {
    const t = STANDARD_ROLES[b?.code];
    if (!t) throw new BadRequestException('Rôle type inconnu');
    // cash:session (connexion à la caisse) n'est jamais détenue par l'administrateur : seul le rôle caissier la porte
    const missing = t.permissions.filter((p) => p !== 'cash:session' && !req.org.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Permissions non détenues : ${missing.join(', ')}`);
    const role = await this.db.tx(req.org.id, async (c) => {
      const ex = await c.query(`SELECT id, code, name FROM roles WHERE organization_id = $1 AND code = $2`, [req.org.id, b.code]);
      if (ex.rowCount) return ex.rows[0];
      const r = await c.query(`INSERT INTO roles(organization_id, code, name, mobile_only) VALUES ($1,$2,$3,$4) RETURNING id, code, name, mobile_only`, [req.org.id, b.code, t.name, t.mobileOnly === true]);
      for (const p of t.permissions) await c.query(`INSERT INTO role_permissions(role_id, permission_code) VALUES ($1,$2)`, [r.rows[0].id, p]);
      return r.rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'role.create', entityType: 'role', entityId: role.id, details: { standard: b.code } });
    return role;
  }

  /** Création d'un rôle propre à l'organisation. On ne peut accorder que des permissions que l'on détient soi-même. */
  @Post('roles')
  @RequirePermissions('roles:manage')
  async createRole(@Body() b: CreateRoleDto, @Req() req: any) {
    const missing = b.permissions.filter((p) => !req.org.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Permissions non détenues : ${missing.join(', ')}`);
    try {
      const role = await this.db.tx(req.org.id, async (c) => {
        const known = await c.query(`SELECT code FROM permissions WHERE code = ANY($1)`, [b.permissions]);
        if (known.rowCount !== new Set(b.permissions).size) throw new BadRequestException('Permission inconnue');
        const r = await c.query(`INSERT INTO roles(organization_id, code, name, mobile_only) VALUES ($1,$2,$3,$4) RETURNING id, code, name, mobile_only`, [req.org.id, b.code, b.name, b.mobile_only === true]);
        for (const p of new Set(b.permissions))
          await c.query(`INSERT INTO role_permissions(role_id, permission_code) VALUES ($1,$2)`, [r.rows[0].id, p]);
        return r.rows[0];
      });
      await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'role.create', entityType: 'role', entityId: role.id, details: { permissions: b.permissions } });
      return role;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Code de rôle déjà utilisé');
      throw e;
    }
  }

  @Post('users')
  @RequirePermissions('users:create')
  async create(@Body() b: CreateUserDto, @Req() req: any) {
    const email = b.email.toLowerCase();
    assertStrongPassword(b.password, b.email);
    const hash = await this.auth.hashPassword(b.password);
    const user = await this.db.tx(req.org.id, async (c) => {
      // Le rôle doit appartenir à l'organisation courante (pas d'identifiant d'une autre coopérative).
      const role = await c.query(`SELECT id FROM roles WHERE id = $1 AND organization_id = $2`, [b.role_id, req.org.id]);
      if (!role.rowCount) throw new BadRequestException('Rôle inconnu pour cette organisation');
      const existing = await c.query(`SELECT id FROM users WHERE email = $1`, [email]);
      let userId: string;
      if (existing.rowCount) {
        // Un compte existant peut être rattaché à une autre coopérative, sans changer son mot de passe.
        userId = existing.rows[0].id;
        const already = await c.query(
          `SELECT 1 FROM user_organizations WHERE user_id=$1 AND organization_id=$2`,
          [userId, req.org.id],
        );
        if (already.rowCount) throw new ConflictException('Utilisateur déjà membre');
      } else {
        const ins = await c.query(
          `INSERT INTO users(email, full_name, phone, password_hash, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [email, b.full_name, b.phone ?? null, hash, req.user.id],
        );
        userId = ins.rows[0].id;
      }
      if (b.member_code) {
        if ((await c.query(`SELECT 1 FROM member_codes WHERE organization_id = $1 AND code = $2`, [req.org.id, b.member_code])).rowCount) throw new ConflictException('Ce code est déjà attribué à un autre intervenant');
        await c.query(`INSERT INTO member_codes(organization_id, user_id, code) VALUES ($1,$2,$3)`, [req.org.id, userId, b.member_code]);
      }
      await c.query(
        `INSERT INTO user_organizations(user_id, organization_id, role_id, created_by) VALUES ($1,$2,$3,$4)`,
        [userId, req.org.id, b.role_id, req.user.id],
      );
      for (const rid of [...new Set(b.role_ids ?? [])].filter((x) => x !== b.role_id)) {
        const extra = await c.query(`SELECT id FROM roles WHERE id = $1 AND organization_id = $2`, [rid, req.org.id]);
        if (!extra.rowCount) throw new BadRequestException('Rôle inconnu pour cette organisation');
        const perms = (await c.query(`SELECT permission_code FROM role_permissions WHERE role_id = $1`, [rid])).rows.map((r) => r.permission_code);
        const missing = perms.filter((p) => !req.org.permissions.has(p));
        if (missing.length) throw new ForbiddenException(`Permissions non détenues : ${missing.join(', ')}`);
        await c.query(`INSERT INTO user_organizations(user_id, organization_id, role_id, created_by) VALUES ($1,$2,$3,$4)`, [userId, req.org.id, rid, req.user.id]);
      }
      const code = (await c.query(`SELECT code FROM member_codes WHERE organization_id = $1 AND user_id = $2`, [req.org.id, userId])).rows[0]?.code;
      return { id: userId, email, full_name: b.full_name, member_code: code };
    });
    await this.audit.log({
      organizationId: req.org.id,
      actorUserId: req.user.id,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      details: { role_id: b.role_id, role_ids: b.role_ids ?? [] },
    });
    return user;
  }

  /** Réinitialisation par un administrateur : génère un mot de passe temporaire, montré une seule fois, à changer à la première connexion. */
  @Post('users/:id/reset-password')
  @RequirePermissions('users:manage')
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    if (id === req.user.id) throw new BadRequestException('Utilisez « Changer mon mot de passe » pour votre propre compte');
    const member = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT u.id, u.email, u.is_platform_admin, (SELECT count(*) FROM user_organizations x WHERE x.user_id = u.id AND x.status = 'active' AND x.organization_id <> $2) AS others
         FROM users u JOIN user_organizations uo ON uo.user_id = u.id WHERE u.id = $1 AND uo.organization_id = $2`, [id, req.org.id])).rows[0]);
    if (!member) throw new NotFoundException('Utilisateur introuvable dans cette coopérative');
    if (member.is_platform_admin) throw new ForbiddenException("Le compte d'un administrateur de plateforme ne se réinitialise pas ici");
    if (Number(member.others) > 0) throw new ConflictException('Ce compte appartient aussi à une autre coopérative : sa réinitialisation doit être demandée à l\'administrateur de la plateforme');
    const temp = randomBytes(9).toString('base64url') + 'a1';
    await this.auth.setTemporaryPassword(id, temp);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'user.reset_password', entityType: 'user', entityId: id });
    return { email: member.email, temporary_password: temp, must_change_password: true };
  }

  /** Téléphone perdu : l'administrateur retire la double authentification du compte (sessions fermées) ; la personne la reconfigurera. */
  @Post('users/:id/reset-2fa')
  @HttpCode(204)
  @RequirePermissions('users:manage')
  async resetTwoFactor(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    if (id === req.user.id) throw new BadRequestException("Utilisez « Désactiver » dans Mon compte pour votre propre compte");
    const member = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT u.is_platform_admin, (SELECT count(*) FROM user_organizations x WHERE x.user_id = u.id AND x.status = 'active' AND x.organization_id <> $2) AS others
         FROM users u JOIN user_organizations uo ON uo.user_id = u.id WHERE u.id = $1 AND uo.organization_id = $2`, [id, req.org.id])).rows[0]);
    if (!member) throw new NotFoundException('Utilisateur introuvable dans cette coopérative');
    if (member.is_platform_admin || Number(member.others) > 0) throw new ForbiddenException("Ce compte ne peut pas être réinitialisé depuis cette coopérative");
    await this.auth.twoFactorReset(id, req.user.id);
  }
}
