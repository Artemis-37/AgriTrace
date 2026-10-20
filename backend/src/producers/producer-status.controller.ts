import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

const STATUSES = ['creating', 'active', 'to_verify', 'suspended', 'inactive', 'left', 'archived'];
class StatusDto { @IsIn(STATUSES) status: string; @IsString() @Length(3, 300) reason: string; }

/** Statuts du producteur (CDC §6.2) : chaque changement est historisé (table immuable) et audité. */
@ApiTags('producteurs')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('producers')
export class ProducerStatusController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Post(':id/status')
  @RequirePermissions('producers:status')
  async set(@Param('id', ParseUUIDPipe) id: string, @Body() b: StatusDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const p = (await c.query(`SELECT id, status FROM producers WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!p) throw new NotFoundException();
      if (p.status === b.status) return p;
      if (p.status === 'archived') throw new ConflictException('Un producteur archivé ne peut plus changer de statut');
      if (b.status === 'archived' && !['inactive', 'left'].includes(p.status)) throw new BadRequestException('Seul un producteur inactif ou sorti peut être archivé');
      if (b.status === 'left') {
        const open = (await c.query(`SELECT count(*)::int AS n FROM loans WHERE borrower_type = 'producer' AND borrower_id = $1 AND status IN ('approved','disbursed')`, [id])).rows[0].n;
        if (open) throw new ConflictException(`${open} prêt(s) ou avance(s) en cours : à solder avant la sortie`);
      }
      const r = (await c.query(`UPDATE producers SET status = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1 RETURNING id, internal_code, status`, [id, b.status, req.user.id])).rows[0];
      await c.query(`INSERT INTO producer_status_history(organization_id, producer_id, from_status, to_status, reason, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`, [req.org.id, id, p.status, b.status, b.reason, req.user.id]);
      await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.status', entityType: 'producer', entityId: id, details: { from: p.status, to: b.status, reason: b.reason } });
      return r;
    });
  }

  @Get(':id/status-history')
  @RequirePermissions('producers:read')
  history(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT h.id, h.from_status, h.to_status, h.reason, h.created_at, u.full_name AS actor_name FROM producer_status_history h LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.producer_id = $1 ORDER BY h.id`, [id])).rows);
  }
}
