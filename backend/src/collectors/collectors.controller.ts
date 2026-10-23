import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';

class CreateCollectorDto { @IsUUID() user_id: string; }
class AssignmentDto {
  @IsOptional() @IsUUID() value_chain_id?: string;   // absent = toutes les filières de la coopérative
  @IsOptional() @IsString() zone?: string;
}

@ApiTags('collecteurs')
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
        `SELECT c.id, c.user_id, c.status, u.full_name, (SELECT mc.code FROM member_codes mc WHERE mc.user_id = c.user_id AND mc.organization_id = c.organization_id) AS member_code,
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
        return (await c.query(`INSERT INTO collectors(organization_id, user_id, created_by) VALUES ($1,$2,$3) RETURNING id, user_id, status`, [req.org.id, b.user_id, req.user.id])).rows[0];
      });
      await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.create', entityType: 'collector', entityId: row.id });
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Cet utilisateur est déjà collecteur');
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

  @Post(':id/disable')
  @RequirePermissions('collectors:manage')
  async disable(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const n = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE collectors SET status = 'disabled', updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`, [id, req.user.id])).rowCount);
    if (!n) throw new NotFoundException();
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'collector.disable', entityType: 'collector', entityId: id });
    return { id, status: 'disabled' };
  }
}
