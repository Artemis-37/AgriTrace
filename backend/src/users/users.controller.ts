import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail, IsOptional, IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
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
}

class CreateRoleDto {
  @Matches(/^[a-z0-9_]{2,40}$/) code: string;
  @IsString() @Length(2, 100) name: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @IsString({ each: true }) permissions: string[];
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
      `SELECT u.id, u.email, u.full_name, u.phone, u.status, r.code AS role_code, uo.status AS membership_status
         FROM user_organizations uo
         JOIN users u ON u.id = uo.user_id
         JOIN roles r ON r.id = uo.role_id
        WHERE uo.organization_id = $1 ORDER BY u.full_name`,
      [req.org.id])).rows);
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
    const missing = t.permissions.filter((p) => !req.org.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Permissions non détenues : ${missing.join(', ')}`);
    const role = await this.db.tx(req.org.id, async (c) => {
      const ex = await c.query(`SELECT id, code, name FROM roles WHERE organization_id = $1 AND code = $2`, [req.org.id, b.code]);
      if (ex.rowCount) return ex.rows[0];
      const r = await c.query(`INSERT INTO roles(organization_id, code, name) VALUES ($1,$2,$3) RETURNING id, code, name`, [req.org.id, b.code, t.name]);
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
        const r = await c.query(`INSERT INTO roles(organization_id, code, name) VALUES ($1,$2,$3) RETURNING id, code, name`, [req.org.id, b.code, b.name]);
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
      await c.query(
        `INSERT INTO user_organizations(user_id, organization_id, role_id, created_by) VALUES ($1,$2,$3,$4)`,
        [userId, req.org.id, b.role_id, req.user.id],
      );
      return { id: userId, email, full_name: b.full_name };
    });
    await this.audit.log({
      organizationId: req.org.id,
      actorUserId: req.user.id,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      details: { role_id: b.role_id },
    });
    return user;
  }
}
