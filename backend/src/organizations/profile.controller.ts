import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

class ProfileDto {
  @IsOptional() @IsString() @Length(0, 200) commercial_name?: string;
  @IsOptional() @IsString() @Length(0, 300) address?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsEmail() email?: string | '';
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['fr', 'en']) default_language?: string;
}

/** Profil de la coopérative (nom commercial, coordonnées, devise, langue) : repris en en-tête des reçus imprimés. */
@ApiTags('organisation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('organization/profile')
export class ProfileController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  async get(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT o.name, o.code, p.commercial_name, p.address, p.phone, p.email, coalesce(p.currency, 'XOF') AS currency, coalesce(p.default_language, 'fr') AS default_language
         FROM organizations o LEFT JOIN organization_profile p ON p.organization_id = o.id WHERE o.id = $1`, [req.org.id])).rows[0]);
  }

  @Put()
  @RequirePermissions('org:branding')
  async put(@Body() b: ProfileDto, @Req() req: any) {
    const v = (x?: string) => (x == null || x.trim() === '' ? null : x.trim());
    await this.db.tx(req.org.id, (c) => c.query(
      `INSERT INTO organization_profile(organization_id, commercial_name, address, phone, email, currency, default_language, updated_by)
       VALUES ($1,$2,$3,$4,$5,coalesce($6,'XOF'),coalesce($7,'fr'),$8)
       ON CONFLICT (organization_id) DO UPDATE SET commercial_name = $2, address = $3, phone = $4, email = $5,
         currency = coalesce($6, organization_profile.currency), default_language = coalesce($7, organization_profile.default_language), updated_by = $8, updated_at = now()`,
      [req.org.id, v(b.commercial_name), v(b.address), v(b.phone), v(b.email), b.currency ?? null, b.default_language ?? null, req.user.id]));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'org.profile_update', entityType: 'organization', entityId: req.org.id });
    return this.get(req);
  }
}
