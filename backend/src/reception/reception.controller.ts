import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param,
  ParseUUIDPipe, Post, Put, Query, Req, Res, UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { Response } from 'express';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { receiptPdf } from '../common/pdf';
import { DbService } from '../db/db.service';
import { addLotEvent, addMovement, nextNumber, pad } from '../stock/stock.helpers';

export class CreateWeighingDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() declaration_id: string;
  @IsUUID() warehouse_id: string;
  @Dec(3) gross_kg: string;
  @IsOptional() @Dec(3) tare_kg?: string;
  @IsOptional() @Type(() => Number) @IsNumber() bags?: number;
  @IsOptional() @IsString() @Length(3, 500) justification?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}
class ApproveDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @Length(3, 500) comment?: string;
}
class CreateReceiptDto {
  @IsUUID() weighing_id: string;
  @IsOptional() @IsUUID() lot_id?: string;
}
class WeighingSettingsDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) variance_pct: number;
}

@ApiTags('pesée et réception')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ReceptionController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, entityType: string, entityId: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType, entityId, details });
  }

  // ---- Paramètres ----
  @Get('settings/weighing')
  @RequirePermissions('weighings:read')
  async getSettings(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const r = await c.query(`SELECT weighing_variance_pct AS variance_pct FROM org_settings`);
      return r.rows[0] ?? { variance_pct: '2.000' };
    });
  }

  @Put('settings/weighing')
  @RequirePermissions('settings:weighing')
  async putSettings(@Body() b: WeighingSettingsDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) =>
      (await c.query(
        `INSERT INTO org_settings(organization_id, weighing_variance_pct, updated_by) VALUES ($1,$2,$3)
         ON CONFLICT (organization_id) DO UPDATE SET weighing_variance_pct = EXCLUDED.weighing_variance_pct, updated_at = now(), updated_by = EXCLUDED.updated_by
         RETURNING weighing_variance_pct AS variance_pct`, [req.org.id, b.variance_pct, req.user.id])).rows[0]);
    await this.log(req, 'settings.weighing', 'org_settings', req.org.id, { variance_pct: b.variance_pct });
    return row;
  }

  // ---- Pesées ----
  @Post('weighings')
  @RequirePermissions('weighings:create')
  async createWeighing(@Body() b: CreateWeighingDto, @Req() req: any) {
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM weighings WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };

      const d = (await c.query(`SELECT * FROM purchase_declarations WHERE id = $1 FOR UPDATE`, [b.declaration_id])).rows[0];
      if (!d) throw new BadRequestException('Déclaration inconnue');
      if (d.status !== 'accepted') throw new BadRequestException(`La déclaration doit être acceptée (état actuel : ${d.status})`);
      if ((await c.query(`SELECT 1 FROM weighings WHERE declaration_id = $1 AND status IN ('pending_approval','recorded','received')`, [d.id])).rowCount)
        throw new ConflictException('Une pesée active existe déjà pour cette déclaration');
      const w = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!w || w.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');

      // Poids déclaré converti en kg (conversion explicite et configurable)
      let factor = '1';
      if (d.unit !== 'kg') {
        const f = await c.query(`SELECT factor FROM unit_conversions WHERE value_chain_id = $1 AND from_unit = $2 AND to_unit = 'kg'`, [d.value_chain_id, d.unit]);
        if (!f.rowCount) throw new UnprocessableEntityException(`Conversion ${d.unit} vers kg non configurée`);
        factor = f.rows[0].factor;
      }
      const tare = b.tare_kg ?? '0';
      const th = (await c.query(`SELECT weighing_variance_pct FROM org_settings`)).rows[0]?.weighing_variance_pct ?? '2.000';
      const calc = (await c.query(
        `SELECT ($1::numeric - $2::numeric) AS net, round($3::numeric * $4::numeric, 3) AS declared`, [b.gross_kg, tare, d.quantity, factor])).rows[0];
      if (Number(calc.net) <= 0) throw new BadRequestException('Poids net nul ou négatif (tare supérieure au poids brut)');
      const v = (await c.query(
        `SELECT $1::numeric - $2::numeric AS variance,
                CASE WHEN $2::numeric = 0 THEN NULL ELSE round(($1::numeric - $2::numeric) / $2::numeric * 100, 3) END AS pct,
                CASE WHEN $2::numeric = 0 THEN true ELSE abs(($1::numeric - $2::numeric) / $2::numeric * 100) > $3::numeric END AS over`,
        [calc.net, calc.declared, th])).rows[0];
      if (v.over && !b.justification) throw new BadRequestException(`Écart de ${v.pct} % supérieur au seuil de ${th} % : une justification est obligatoire`);

      const ins = await c.query(
        `INSERT INTO weighings(organization_id, idempotency_key, declaration_id, warehouse_id, operator_id, gross_kg, tare_kg, net_kg, bags,
                               declared_kg, variance_kg, variance_pct, threshold_pct, justification, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$5) RETURNING *`,
        [req.org.id, b.idempotency_key, d.id, b.warehouse_id, req.user.id, b.gross_kg, tare, calc.net, b.bags ?? d.bags ?? null,
         calc.declared, v.variance, v.pct, th, b.justification ?? null, b.notes ?? null, v.over ? 'pending_approval' : 'recorded']);
      return { row: ins.rows[0], replay: false };
    });
    if (!replay) await this.log(req, 'weighing.create', 'weighing', row.id, { net_kg: row.net_kg, variance_pct: row.variance_pct, status: row.status });
    return { ...row, replayed: replay };
  }

  /** Validation d'un écart au-delà du seuil : exige un utilisateur distinct de l'opérateur de pesée. */
  @Post('weighings/:id/approve')
  @RequirePermissions('weighings:approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ApproveDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const w = (await c.query(`SELECT * FROM weighings WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!w) throw new NotFoundException();
      if (w.status !== 'pending_approval') throw new BadRequestException(`Pesée non en attente de validation (état : ${w.status})`);
      if (w.operator_id === req.user.id) throw new ForbiddenException("La validation doit être faite par un utilisateur distinct de l'opérateur");
      if (!b.approve && !b.comment) throw new BadRequestException('Un motif est obligatoire pour refuser');
      return (await c.query(
        `UPDATE weighings SET status = $2, approved_by = $3, approved_at = now(), notes = coalesce($4, notes), updated_at = now() WHERE id = $1 RETURNING *`,
        [id, b.approve ? 'recorded' : 'rejected', req.user.id, b.comment ?? null])).rows[0];
    });
    await this.log(req, b.approve ? 'weighing.approve' : 'weighing.reject', 'weighing', id);
    return row;
  }

  @Get('weighings')
  @RequirePermissions('weighings:read')
  list(@Req() req: any, @Query('status') status?: string, @Query('declaration_id') decl?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, declaration_id, warehouse_id, operator_id, weighed_at, gross_kg, tare_kg, net_kg, declared_kg, variance_kg, variance_pct, status
         FROM weighings WHERE ($1::text IS NULL OR status = $1) AND ($2::uuid IS NULL OR declaration_id = $2) ORDER BY weighed_at DESC LIMIT 200`,
      [status ?? null, decl ?? null])).rows);
  }

  @Get('weighings/:id')
  @RequirePermissions('weighings:read')
  async getWeighing(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM weighings WHERE id = $1`, [id])).rows[0]);
    if (!r) throw new NotFoundException();
    return r;
  }

  // ---- Réception ----
  /**
   * Valide la réception : crée (ou alimente) le lot, écrit le mouvement de stock, émet le reçu et met à jour
   * l'état de la déclaration — dans une seule transaction.
   */
  @Post('receipts')
  @RequirePermissions('receipts:create')
  async createReceipt(@Body() b: CreateReceiptDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c: PoolClient) => {
      const w = (await c.query(`SELECT * FROM weighings WHERE id = $1 FOR UPDATE`, [b.weighing_id])).rows[0];
      if (!w) throw new NotFoundException('Pesée inconnue');
      if (w.status === 'received') {
        const ex = (await c.query(`SELECT * FROM receipts WHERE weighing_id = $1`, [w.id])).rows[0];
        return { receipt: ex, replayed: true };
      }
      if (w.status !== 'recorded') throw new BadRequestException(`Pesée non réceptionnable (état : ${w.status})`);
      const d = (await c.query(`SELECT * FROM purchase_declarations WHERE id = $1 FOR UPDATE`, [w.declaration_id])).rows[0];
      if (d.status !== 'accepted') throw new BadRequestException(`Déclaration non acceptée (état : ${d.status})`);

      let lotId = b.lot_id;
      if (lotId) {
        const l = (await c.query(`SELECT value_chain_id, campaign_id, status FROM lots WHERE id = $1 FOR UPDATE`, [lotId])).rows[0];
        if (!l) throw new BadRequestException('Lot inconnu');
        if (l.status !== 'open') throw new BadRequestException('Lot clôturé');
        if (l.value_chain_id !== d.value_chain_id || l.campaign_id !== d.campaign_id)
          throw new BadRequestException('Le lot doit appartenir à la même filière et à la même campagne');
      } else {
        const vc = (await c.query(`SELECT code FROM value_chains WHERE id = $1`, [d.value_chain_id])).rows[0];
        const n = await nextNumber(c, req.org.id, 'lot');
        const code = `LOT-${vc.code}-${new Date().getUTCFullYear()}-${pad(n, 5)}`;
        lotId = (await c.query(
          `INSERT INTO lots(organization_id, code, value_chain_id, campaign_id, kind, created_by) VALUES ($1,$2,$3,$4,'reception',$5) RETURNING id`,
          [req.org.id, code, d.value_chain_id, d.campaign_id, req.user.id])).rows[0].id;
      }

      const mv = await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: w.warehouse_id, lotId: lotId!,
        type: 'reception', direction: 'in', quantityKg: w.net_kg, idempotencyKey: `reception:${w.id}`,
        reason: 'Réception après pesée', sourceType: 'weighing', sourceId: w.id });
      const rn = await nextNumber(c, req.org.id, 'receipt');
      const receipt = (await c.query(
        `INSERT INTO receipts(organization_id, number, weighing_id, declaration_id, lot_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.org.id, `RC-${new Date().getUTCFullYear()}-${pad(rn, 5)}`, w.id, d.id, lotId, req.user.id])).rows[0];
      await c.query(`UPDATE weighings SET status = 'received', updated_at = now() WHERE id = $1`, [w.id]);

      const full = (await c.query(`SELECT $1::numeric >= $2::numeric AS full`, [w.net_kg, w.declared_kg])).rows[0].full;
      const newStatus = full ? 'received_confirmed' : 'partially_received';
      await c.query(`UPDATE purchase_declarations SET status = $2, updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1`, [d.id, newStatus, req.user.id]);
      await c.query(
        `INSERT INTO purchase_declaration_history(organization_id, declaration_id, from_status, to_status, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.org.id, d.id, d.status, newStatus, `Reçu ${receipt.number}`, req.user.id]);
      await addLotEvent(c, req.org.id, req.user.id, lotId!, 'received', w.net_kg, { type: 'receipt', id: receipt.id },
        { declaration_id: d.id, weighing_id: w.id, producer_id: d.producer_id, collector_id: d.collector_id, declared_kg: w.declared_kg,
          variance_pct: w.variance_pct, movement: mv.reference });
      return { receipt, declaration_status: newStatus, lot_id: lotId, replayed: false };
    });
    if (!out.replayed) await this.log(req, 'receipt.create', 'receipt', out.receipt.id, { number: out.receipt.number });
    return out;
  }

  private async receiptData(orgId: string, id: string) {
    const r = await this.db.tx(orgId, async (c) => (await c.query(
      `SELECT r.id, r.number, r.status, r.created_at, o.name AS organization_name,
              w.weighed_at, w.gross_kg, w.tare_kg, w.net_kg, w.declared_kg, w.variance_kg, w.variance_pct, w.bags,
              p.last_name || ' ' || p.first_names AS producer_name, p.internal_code AS producer_code,
              cu.full_name AS collector_name, ou.full_name AS operator_name, wh.name AS warehouse_name,
              l.code AS lot_code, d.status AS declaration_status
         FROM receipts r
         JOIN organizations o ON o.id = r.organization_id
         JOIN weighings w ON w.id = r.weighing_id
         JOIN purchase_declarations d ON d.id = r.declaration_id
         JOIN producers p ON p.id = d.producer_id
         JOIN collectors co ON co.id = d.collector_id JOIN users cu ON cu.id = co.user_id
         JOIN users ou ON ou.id = w.operator_id
         JOIN warehouses wh ON wh.id = w.warehouse_id
         JOIN lots l ON l.id = r.lot_id
        WHERE r.id = $1`, [id])).rows[0]);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get('receipts/:id')
  @RequirePermissions('weighings:read')
  getReceipt(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.receiptData(req.org.id, id);
  }

  @Get('receipts/:id/pdf')
  @RequirePermissions('weighings:read')
  async receiptPdfFile(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const data = await this.receiptData(req.org.id, id);
    const buf = await receiptPdf(data);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${data.number}.pdf"` }).send(buf);
    await this.log(req, 'receipt.download', 'receipt', id);
  }
}
