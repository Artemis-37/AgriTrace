import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { NoOrg, PlatformAdminOnly } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../db/db.service';

class CreateOrgAdminDto {
  @IsEmail() email: string;
  @IsString() @Length(2, 200) full_name: string;
  @IsString() @MinLength(12) password: string;
}

class CreateOrganizationDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/) code: string;
  @IsString() @Length(2, 200) name: string;
  @IsOptional() @Length(2, 2) country_code?: string;
}

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Organisations explicitement attribuées à l'utilisateur. */
  @NoOrg()
  @Get()
  mine(@Req() req: any) {
    return this.db.query(
      `SELECT DISTINCT o.id, o.code, o.name, o.country_code
         FROM organizations o JOIN user_organizations uo ON uo.organization_id = o.id
        WHERE uo.user_id = $1 AND uo.status = 'active' AND o.status = 'active'
        ORDER BY o.name`,
      [req.user.id],
    );
  }

  /** Amorçage : l'administrateur de plateforme crée le premier administrateur d'une coopérative. */
  @PlatformAdminOnly()
  @Post(':id/admins')
  async createFirstAdmin(@Param('id', ParseUUIDPipe) id: string, @Body() b: CreateOrgAdminDto, @Req() req: any) {
    const hash = await this.auth.hashPassword(b.password);
    const out = await this.db.tx(id, async (c) => {
      const role = await c.query(`SELECT id FROM roles WHERE organization_id = $1 AND code = 'coop_admin'`, [id]);
      if (!role.rowCount) throw new NotFoundException('Organisation inconnue');
      const email = b.email.toLowerCase();
      const ex = await c.query(`SELECT id FROM users WHERE email = $1`, [email]);
      const userId = ex.rowCount
        ? ex.rows[0].id
        : (await c.query(`INSERT INTO users(email, full_name, password_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
            [email, b.full_name, hash, req.user.id])).rows[0].id;
      await c.query(`INSERT INTO user_organizations(user_id, organization_id, role_id, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [userId, id, role.rows[0].id, req.user.id]);
      return { id: userId, email };
    });
    await this.audit.log({ organizationId: id, actorUserId: req.user.id, action: 'organization.admin_assigned', entityType: 'user', entityId: out.id });
    return out;
  }

  @PlatformAdminOnly()
  @Post()
  async create(@Body() b: CreateOrganizationDto, @Req() req: any) {
    const [org] = await this.db.query(
      `INSERT INTO organizations(code, name, country_code, created_by) VALUES ($1,$2,$3,$4)
       RETURNING id, code, name, country_code, status`,
      [b.code, b.name, (b.country_code ?? 'CI').toUpperCase(), req.user.id],
    );
    // Rôles de l'organisation : copie du jeu minimal (administrateur de coopérative)
    await this.db.tx(org.id, async (c) => {
      const r = await c.query(
        `INSERT INTO roles(organization_id, code, name) VALUES ($1,'coop_admin','Administrateur de coopérative') RETURNING id`,
        [org.id],
      );
      await c.query(
        `INSERT INTO role_permissions(role_id, permission_code) SELECT $1, code FROM permissions`,
        [r.rows[0].id],
      );
    });
    await this.audit.log({
      organizationId: org.id,
      actorUserId: req.user.id,
      action: 'organization.create',
      entityType: 'organization',
      entityId: org.id,
    });
    return org;
  }
}
