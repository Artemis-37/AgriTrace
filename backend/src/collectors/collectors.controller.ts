import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';

class CreateCollectorDto {
  @IsUUID() user_id: string;
  /** Provenance habituelle des achats du délégué (localité, zone) : reprise sur chaque bulletin de pesée. */
  @IsOptional() @IsString() @Length(1, 80) origin?: string;
}
class ProfileDto {
  @IsOptional() @IsString() @Length(1, 80) origin?: string;
  @IsOptional() @IsString() @Length(0, 80) bank_name?: string;
  @IsOptional() @IsString() @Length(0, 40) bank_account?: string;
  @IsOptional() @IsIn(['cni', 'passeport', 'attestation', 'permis', 'autre', '']) id_doc_type?: string;
  @IsOptional() @IsString() @Length(0, 40) id_doc_no?: string;
}
class OriginDto { @IsString() @Length(1, 80) origin: string; }
class AssignmentDto {
  @IsOptional() @IsUUID() value_chain_id?: string;   // absent = toutes les filières de la coopérative
  @IsOptional() @IsString() zone?: string;
}

@ApiTags('délégués')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('collectors')
export class CollectorsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('collectors:read')
  list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) =>
      (await c.query(
        `SELECT c.id, c.user_id, c.status, c.origin, c.bank_name, c.bank_account, c.id_doc_type, c.id_doc_no, u.phone, u.email, u.full_name, (SELECT mc.code FROM member_codes mc WHERE mc.user_id = c.user_id AND mc.organization_id = c.organization_id) AS member_code,
                coalesce((SELECT json_agg(json_build_object('id', a.id, 'value_chain_id', a.value_chain_id, 'zone', a.zone))
                            FROM collector_assignments a WHERE a.collector_id = c.id), '[]') AS assignments
           FROM collectors c JOIN users u ON u.id = c.user_id ORDER BY u.full_name`)).rows);
  }

  @Post()
  @RequirePermissions('collectors:manage')
  async create(@Body() b: CreateCollectorDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => {
        const m = await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2 AND status = 'active'`, [b.user_id, req.org.id]);
        if (!m.rowCount) throw new BadRequestException("L'utilisateur n'est pas membre de cette organisation");
        return (await c.query(`INSERT INTO collectors(organization_id, user_id, created_by, origin) VALUES ($1,$2,$3,$4) RETURNING id, user_id, status, origin`, [req.org.id, b.user_id, req.user.id, b.origin?.trim() || null])).rows[0];
      });
      await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.create', entityType: 'collector', entityId: row.id });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Cet utilisateur est déjà délégué');
      throw e;
    }
  }

  @Post(':id/assignments')
  @RequirePermissions('collectors:manage')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignmentDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      if (!(await c.query(`SELECT 1 FROM collectors WHERE id = $1`, [id])).rowCount) throw new NotFoundException();
      if (b.value_chain_id && !(await c.query(`SELECT 1 FROM value_chains WHERE id = $1`, [b.value_chain_id])).rowCount)
        throw new BadRequestException('Filière inconnue');
      return (await c.query(
        `INSERT INTO collector_assignments(organization_id, collector_id, value_chain_id, zone, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, collector_id, value_chain_id, zone`,
        [req.org.id, id, b.value_chain_id ?? null, b.zone ?? null, req.user.id])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.assign', entityType: 'collector', entityId: id, details: b as any });
    return row;
  }

  /** Modifie la provenance du délégué (reprise sur les prochains bulletins ; les réceptions passées gardent la leur). */
  @Put(':id/origin')
  @RequirePermissions('collectors:manage')
  async setOrigin(@Param('id', ParseUUIDPipe) id: string, @Body() b: OriginDto, @Req() req: any) {
    const n = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE collectors SET origin = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1`, [id, b.origin.trim(), req.user.id])).rowCount);
    if (!n) throw new NotFoundException();
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.origin', entityType: 'collector', entityId: id, details: { origin: b.origin.trim() } });
    return { id, origin: b.origin.trim() };
  }

  /** Fiche du délégué : localité, banque, pièce d'identité. Une valeur vide efface le champ ; un champ absent reste inchangé. */
  @Put(':id/profile')
  @RequirePermissions('collectors:manage')
  async setProfile(@Param('id', ParseUUIDPipe) id: string, @Body() b: ProfileDto, @Req() req: any) {
    const cols = ['origin', 'bank_name', 'bank_account', 'id_doc_type', 'id_doc_no'] as const;
    const sets: string[] = []; const vals: any[] = [id, req.user.id];
    for (const k of cols) if (b[k] !== undefined) { vals.push(b[k]!.trim() || null); sets.push(`${k} = $${vals.length}`); }
    if (!sets.length) throw new BadRequestException('Aucune information à modifier');
    const n = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE collectors SET ${sets.join(', ')}, updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`, vals)).rowCount);
    if (!n) throw new NotFoundException();
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.profile', entityType: 'collector', entityId: id, details: { fields: cols.filter((k) => b[k] !== undefined) } });
    return { id };
  }

  @Post(':id/disable')
  @RequirePermissions('collectors:manage')
  async disable(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const n = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE collectors SET status = 'disabled', updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`, [id, req.user.id])).rowCount);
    if (!n) throw new NotFoundException();
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.disable', entityType: 'collector', entityId: id });
    return { id, status: 'disabled' };
  }
}
