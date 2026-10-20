import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addLotEvent, addMovement, nextNumber, pad } from './stock.helpers';

class OpenDto { @IsString() @Length(8, 100) idempotency_key: string; @IsUUID() warehouse_id: string; }
class CountLineDto {
  @IsUUID() lot_id: string;
  @Dec(3) counted_kg: string;
  @IsOptional() @IsString() @Length(3, 300) reason?: string;
}
class CountDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines: CountLineDto[]; }
class DecideDto { @IsString() @Length(3, 500) note: string; }

/** Inventaire (CDC §15.3) : théorique, compté, écart, motif, compteur, approbateur ; la correction est un mouvement d'ajustement, jamais une suppression. */
@ApiTags('inventaire')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('stock-counts')
export class StockCountController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}
  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'stock_count', entityId: id, details });
  }
  private async load(c: PoolClient, id: string, lock = true) {
    const s = (await c.query(`SELECT * FROM stock_counts WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!s) throw new NotFoundException();
    return s;
  }
  private balance = async (c: PoolClient, lot: string, wh: string): Promise<string> =>
    (await c.query(`SELECT coalesce(sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END),0) AS b FROM warehouse_movements WHERE lot_id = $1 AND warehouse_id = $2`, [lot, wh])).rows[0].b;

  @Post()
  @RequirePermissions('stock:count')
  async open(@Body() b: OpenDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM stock_counts WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      const wh = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!wh || wh.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');
      if ((await c.query(`SELECT 1 FROM stock_counts WHERE warehouse_id = $1 AND status IN ('counting','submitted')`, [b.warehouse_id])).rowCount)
        throw new ConflictException('Un inventaire est déjà en cours dans ce magasin');
      const n = await nextNumber(c, req.org.id, 'stock_count');
      const s = (await c.query(`INSERT INTO stock_counts(organization_id, idempotency_key, number, warehouse_id, opened_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.org.id, b.idempotency_key, `INV-${new Date().getUTCFullYear()}-${pad(n, 4)}`, b.warehouse_id, req.user.id])).rows[0];
      await c.query(
        `INSERT INTO stock_count_lines(organization_id, count_id, lot_id, theoretical_kg)
         SELECT $1, $2, lot_id, sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END) FROM warehouse_movements WHERE warehouse_id = $3 GROUP BY lot_id
          HAVING sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END) <> 0`, [req.org.id, s.id, b.warehouse_id]);
      await this.log(req, 'stock_count.open', s.id, { number: s.number });
      return s;
    });
  }

  @Get()
  @RequirePermissions('stock:count')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM stock_counts WHERE ($1::text IS NULL OR status = $1) ORDER BY opened_at DESC LIMIT 200`, [status ?? null])).rows);
  }

  @Get(':id')
  @RequirePermissions('stock:count')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.load(c, id, false);
      const lines = (await c.query(
        `SELECT l.*, lt.code AS lot_code, (l.counted_kg - l.theoretical_kg) AS variance_kg, cu.full_name AS counted_by_name
           FROM stock_count_lines l JOIN lots lt ON lt.id = l.lot_id LEFT JOIN users cu ON cu.id = l.counted_by WHERE l.count_id = $1 ORDER BY lt.code`, [id])).rows;
      return { ...s, lines };
    });
  }

  /** Saisie des quantités comptées (un lot absent du théorique peut être ajouté : théorique 0). */
  @Post(':id/counts')
  @RequirePermissions('stock:count')
  async count(@Param('id', ParseUUIDPipe) id: string, @Body() b: CountDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.load(c, id);
      if (s.status !== 'counting') throw new ConflictException('Inventaire non ouvert au comptage');
      for (const l of b.lines) {
        const ex = (await c.query(`SELECT * FROM stock_count_lines WHERE count_id = $1 AND lot_id = $2`, [id, l.lot_id])).rows[0];
        if (!ex) {
          if (!(await c.query(`SELECT 1 FROM lots WHERE id = $1`, [l.lot_id])).rowCount) throw new BadRequestException('Lot inconnu');
          await c.query(`INSERT INTO stock_count_lines(organization_id, count_id, lot_id, theoretical_kg) VALUES ($1,$2,$3,0)`, [req.org.id, id, l.lot_id]);
        }
        await c.query(`UPDATE stock_count_lines SET counted_kg = $3, reason = $4, counted_by = $5, counted_at = now() WHERE count_id = $1 AND lot_id = $2`,
          [id, l.lot_id, l.counted_kg, l.reason ?? null, req.user.id]);
      }
      return { id, lines_recorded: b.lines.length };
    });
  }

  @Post(':id/submit')
  @RequirePermissions('stock:count')
  async submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.load(c, id);
      if (s.status !== 'counting') throw new ConflictException('Inventaire non ouvert au comptage');
      const lines = (await c.query(`SELECT l.*, lt.code FROM stock_count_lines l JOIN lots lt ON lt.id = l.lot_id WHERE count_id = $1`, [id])).rows;
      const missing = lines.filter((l) => l.counted_kg === null);
      if (missing.length) throw new BadRequestException(`Lots non comptés : ${missing.map((l) => l.code).join(', ')}`);
      const noReason = lines.filter((l) => Number(l.counted_kg) !== Number(l.theoretical_kg) && !l.reason);
      if (noReason.length) throw new BadRequestException(`Motif obligatoire pour chaque écart : ${noReason.map((l) => l.code).join(', ')}`);
      const gaps = lines.filter((l) => Number(l.counted_kg) !== Number(l.theoretical_kg));
      const r = (await c.query(`UPDATE stock_counts SET status = 'submitted', submitted_at = now(), submitted_by = $2 WHERE id = $1 RETURNING *`, [id, req.user.id])).rows[0];
      if (gaps.length) await this.notif.notifyPermission(c, req.org.id, 'stock:count_approve', { kind: 'stock_count_gap', severity: 'warning', title: `Inventaire ${s.number} : ${gaps.length} écart(s) à approuver`,
        entityType: 'stock_count', entityId: id, dedupe: `stock_count_gap:${id}` }, req.user.id);
      await this.log(req, 'stock_count.submit', id, { gaps: gaps.length });
      return { ...r, gaps: gaps.length };
    });
  }

  /** Approbation par une autre personne que celles qui ont compté ; génère des ajustements audités. */
  @Post(':id/approve')
  @RequirePermissions('stock:count_approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.load(c, id);
      if (s.status !== 'submitted') throw new ConflictException('Inventaire non soumis');
      const counters = (await c.query(`SELECT DISTINCT counted_by FROM stock_count_lines WHERE count_id = $1`, [id])).rows.map((r) => r.counted_by);
      if (counters.includes(req.user.id) || s.submitted_by === req.user.id) throw new ForbiddenException('L\'approbateur doit être différent de la personne qui a compté ou soumis');
      const adjustments: any[] = [];
      for (const l of (await c.query(`SELECT * FROM stock_count_lines WHERE count_id = $1 ORDER BY lot_id`, [id])).rows) {
        await c.query(`SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, [l.lot_id]);
        const bal = await this.balance(c, l.lot_id, s.warehouse_id);
        // L'écart se mesure par rapport au théorique au moment du comptage : les mouvements survenus depuis restent valables
        const delta = (await c.query(`SELECT ($1::numeric - $2::numeric) AS d`, [l.counted_kg, l.theoretical_kg])).rows[0].d;
        let mvId: string | null = null;
        if (Number(delta) !== 0) {
          const dir = Number(delta) > 0 ? 'in' : 'out';
          const qty = (await c.query(`SELECT abs($1::numeric) AS q`, [delta])).rows[0].q;
          const mv = await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: s.warehouse_id, lotId: l.lot_id, type: dir === 'in' ? 'adjustment_in' : 'adjustment_out',
            direction: dir, quantityKg: qty, idempotencyKey: `count:${id}:${l.lot_id}`, reason: `Inventaire ${s.number} : ${l.reason ?? 'écart de comptage'}`, sourceType: 'stock_count', sourceId: id });
          mvId = mv.id;
          await addLotEvent(c, req.org.id, req.user.id, l.lot_id, 'inventory_adjustment', qty, { type: 'stock_count', id }, { number: s.number, direction: dir, theoretical_at_count: l.theoretical_kg, balance_at_approval: bal, counted: l.counted_kg });
          adjustments.push({ lot_id: l.lot_id, delta_kg: delta, movement: mv.reference });
        }
        await c.query(`UPDATE stock_count_lines SET theoretical_at_approval_kg = $2, adjustment_movement_id = $3 WHERE id = $1`, [l.id, bal, mvId]);
      }
      const r = (await c.query(`UPDATE stock_counts SET status = 'approved', decided_at = now(), decided_by = $2, decision_note = $3 WHERE id = $1 RETURNING *`, [id, req.user.id, b.note])).rows[0];
      await this.log(req, 'stock_count.approve', id, { adjustments: adjustments.length });
      return { ...r, adjustments };
    });
  }

  @Post(':id/reject')
  @RequirePermissions('stock:count_approve')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.load(c, id);
      if (s.status !== 'submitted') throw new ConflictException('Inventaire non soumis');
      // Retour au comptage : les saisies sont conservées pour être revues
      const r = (await c.query(`UPDATE stock_counts SET status = 'counting', decision_note = $2, decided_by = $3, decided_at = now() WHERE id = $1 RETURNING *`, [id, b.note, req.user.id])).rows[0];
      await this.notif.notifyUsers(c, req.org.id, [s.opened_by, s.submitted_by], { kind: 'stock_count_rejected', severity: 'warning', title: `Inventaire ${s.number} renvoyé en comptage`, body: b.note, entityType: 'stock_count', entityId: id, dedupe: `stock_count_rejected:${id}:${Date.now()}` });
      await this.log(req, 'stock_count.reject', id, { note: b.note });
      return r;
    });
  }

  @Post(':id/cancel')
  @RequirePermissions('stock:count')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.load(c, id);
      if (!['counting', 'submitted'].includes(s.status)) throw new ConflictException('Inventaire déjà clos');
      const r = (await c.query(`UPDATE stock_counts SET status = 'cancelled', decision_note = $2, decided_by = $3, decided_at = now() WHERE id = $1 RETURNING *`, [id, b.note, req.user.id])).rows[0];
      await this.log(req, 'stock_count.cancel', id, { note: b.note });
      return r;
    });
  }
}
