import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, Length } from 'class-validator';
import { Response } from 'express';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DecEach, isUniqueViolation } from '../common/dto';
import { traceabilityPdf } from '../common/pdf';
import { DbService } from '../db/db.service';
import { addLotEvent, addMovement, lotBalance, nextNumber } from '../stock/stock.helpers';

class SplitDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() warehouse_id: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @DecEach(3) quantities_kg: string[];
}
class MergeDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() warehouse_id: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(20) @IsUUID('all', { each: true }) lot_ids: string[];
}

@ApiTags('lots et traçabilité')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('lots')
export class LotsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, entityType: string, entityId: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType, entityId, details });
  }

  @Get()
  @RequirePermissions('lots:read')
  list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT l.id, l.code, l.kind, l.status, l.value_chain_id, l.campaign_id, l.created_at,
              coalesce((SELECT sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END) FROM warehouse_movements m WHERE m.lot_id = l.id), 0) AS balance_kg
         FROM lots l ORDER BY l.created_at DESC LIMIT 300`)).rows);
  }

  @Post('merge')
  @RequirePermissions('lots:manage', 'stock:move')
  async merge(@Body() b: MergeDto, @Req() req: any) {
    const ids = [...new Set(b.lot_ids)].sort();
    if (ids.length < 2) throw new BadRequestException('Au moins deux lots distincts sont nécessaires');
    try {
      const out = await this.db.tx(req.org.id, async (c: PoolClient) => {
        if (!(await c.query(`SELECT 1 FROM warehouses WHERE id = $1 AND status = 'active'`, [b.warehouse_id])).rowCount)
          throw new BadRequestException('Magasin inconnu ou fermé');
        // Verrou dans un ordre fixe pour éviter les interblocages
        const lots = (await c.query(`SELECT id, code, value_chain_id, campaign_id, status FROM lots WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [ids])).rows;
        if (lots.length !== ids.length) throw new BadRequestException('Lot inconnu');
        if (lots.some((l) => l.status !== 'open')) throw new BadRequestException('Un des lots est clôturé');
        if (new Set(lots.map((l) => `${l.value_chain_id}|${l.campaign_id}`)).size !== 1)
          throw new BadRequestException('Les lots doivent partager la même filière et la même campagne');
        const balances: { lot: any; qty: string }[] = [];
        for (const l of lots) {
          const qty = await lotBalance(c, l.id, b.warehouse_id);
          if (Number(qty) <= 0) throw new BadRequestException(`Le lot ${l.code} n'a pas de stock dans ce magasin`);
          balances.push({ lot: l, qty });
        }
        const total = (await c.query(`SELECT sum(x::numeric) AS t FROM unnest($1::text[]) x`, [balances.map((x) => x.qty)])).rows[0].t;
        const code = `${lots[0].code}-M${await nextNumber(c, req.org.id, 'lot_merge')}`;
        const merged = (await c.query(
          `INSERT INTO lots(organization_id, code, value_chain_id, campaign_id, kind, created_by) VALUES ($1,$2,$3,$4,'merge',$5) RETURNING id, code`,
          [req.org.id, code, lots[0].value_chain_id, lots[0].campaign_id, req.user.id])).rows[0];
        let i = 0;
        for (const { lot, qty } of balances) {
          i++;
          await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.warehouse_id, lotId: lot.id, type: 'merge_out',
            direction: 'out', quantityKg: qty, idempotencyKey: `${b.idempotency_key}:merge:${i}:out`, reason: `Fusion vers ${merged.code}` });
          await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.warehouse_id, lotId: merged.id, type: 'merge_in',
            direction: 'in', quantityKg: qty, idempotencyKey: `${b.idempotency_key}:merge:${i}:in`, reason: `Fusion depuis ${lot.code}` });
          await c.query(`INSERT INTO lot_relationships(organization_id, parent_lot_id, child_lot_id, relation, quantity_kg, created_by) VALUES ($1,$2,$3,'merge',$4,$5)`,
            [req.org.id, lot.id, merged.id, qty, req.user.id]);
          await addLotEvent(c, req.org.id, req.user.id, lot.id, 'merged_into', qty, { type: 'lot', id: merged.id }, { into: merged.code });
          await c.query(`UPDATE lots SET status = 'closed', updated_at = now() WHERE id = $1`, [lot.id]);
        }
        await addLotEvent(c, req.org.id, req.user.id, merged.id, 'created_by_merge', total, undefined, { sources: lots.map((l) => l.code) });
        return { lot: merged, quantity_kg: total, sources: lots.map((l) => l.code) };
      });
      await this.log(req, 'lot.merge', 'lot', out.lot.id, { sources: out.sources });
      return out;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("Cette opération (clé d'idempotence) a déjà été traitée");
      throw e;
    }
  }

  @Post(':id/split')
  @RequirePermissions('lots:manage', 'stock:move')
  async split(@Param('id', ParseUUIDPipe) id: string, @Body() b: SplitDto, @Req() req: any) {
    try {
      const out = await this.db.tx(req.org.id, async (c: PoolClient) => {
        if (!(await c.query(`SELECT 1 FROM warehouses WHERE id = $1 AND status = 'active'`, [b.warehouse_id])).rowCount)
          throw new BadRequestException('Magasin inconnu ou fermé');
        const p = (await c.query(`SELECT id, code, value_chain_id, campaign_id, status FROM lots WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!p) throw new NotFoundException();
        if (p.status !== 'open') throw new BadRequestException('Lot clôturé');
        const bal = await lotBalance(c, id, b.warehouse_id);
        const sum = (await c.query(`SELECT sum(x::numeric) AS s, sum(x::numeric) <= $2::numeric AS ok FROM unnest($1::text[]) x`, [b.quantities_kg, bal])).rows[0];
        if (!sum.ok) throw new BadRequestException(`Quantités supérieures au stock du lot dans ce magasin (${bal} kg)`);
        const children: any[] = [];
        let i = 0;
        for (const q of b.quantities_kg) {
          i++;
          const code = `${p.code}-S${await nextNumber(c, req.org.id, 'lot_split')}`;
          const child = (await c.query(
            `INSERT INTO lots(organization_id, code, value_chain_id, campaign_id, kind, created_by) VALUES ($1,$2,$3,$4,'split',$5) RETURNING id, code`,
            [req.org.id, code, p.value_chain_id, p.campaign_id, req.user.id])).rows[0];
          await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.warehouse_id, lotId: id, type: 'split_out', direction: 'out',
            quantityKg: q, idempotencyKey: `${b.idempotency_key}:split:${i}:out`, reason: `Division vers ${child.code}` });
          await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.warehouse_id, lotId: child.id, type: 'split_in', direction: 'in',
            quantityKg: q, idempotencyKey: `${b.idempotency_key}:split:${i}:in`, reason: `Division depuis ${p.code}` });
          await c.query(`INSERT INTO lot_relationships(organization_id, parent_lot_id, child_lot_id, relation, quantity_kg, created_by) VALUES ($1,$2,$3,'split',$4,$5)`,
            [req.org.id, id, child.id, q, req.user.id]);
          await addLotEvent(c, req.org.id, req.user.id, child.id, 'created_by_split', q, { type: 'lot', id }, { from: p.code });
          children.push({ ...child, quantity_kg: q });
        }
        await addLotEvent(c, req.org.id, req.user.id, id, 'split', sum.s, undefined, { children: children.map((x) => x.code) });
        return { parent: p.code, remaining_kg: (await lotBalance(c, id, b.warehouse_id)), children };
      });
      await this.log(req, 'lot.split', 'lot', id, { children: out.children.map((x: any) => x.code) });
      return out;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("Cette opération (clé d'idempotence) a déjà été traitée");
      throw e;
    }
  }

  /** Données du rapport : origines, historique, anomalies et informations manquantes signalées comme telles. */
  private async traceability(orgId: string, id: string) {
    return this.db.tx(orgId, async (c) => {
      const lot = (await c.query(
        `SELECT l.id, l.code, l.kind, l.status, l.created_at, l.value_chain_id, v.code AS value_chain_code, ca.code AS campaign_code
           FROM lots l JOIN value_chains v ON v.id = l.value_chain_id JOIN campaigns ca ON ca.id = l.campaign_id WHERE l.id = $1`, [id])).rows[0];
      if (!lot) throw new NotFoundException();

      const anc = (await c.query(
        `WITH RECURSIVE up AS (
           SELECT r.id, r.parent_lot_id, r.child_lot_id, r.relation, r.quantity_kg, 1 AS depth FROM lot_relationships r WHERE r.child_lot_id = $1
           UNION ALL
           SELECT r.id, r.parent_lot_id, r.child_lot_id, r.relation, r.quantity_kg, up.depth + 1
             FROM lot_relationships r JOIN up ON r.child_lot_id = up.parent_lot_id WHERE up.depth < 20)
         SELECT up.*, p.code AS parent_code, ch.code AS child_code FROM up JOIN lots p ON p.id = up.parent_lot_id JOIN lots ch ON ch.id = up.child_lot_id ORDER BY depth, id`, [id])).rows;
      const desc = (await c.query(
        `WITH RECURSIVE down AS (
           SELECT r.id, r.parent_lot_id, r.child_lot_id, r.relation, r.quantity_kg, 1 AS depth FROM lot_relationships r WHERE r.parent_lot_id = $1
           UNION ALL
           SELECT r.id, r.parent_lot_id, r.child_lot_id, r.relation, r.quantity_kg, down.depth + 1
             FROM lot_relationships r JOIN down ON r.parent_lot_id = down.child_lot_id WHERE down.depth < 20)
         SELECT down.*, p.code AS parent_code, ch.code AS child_code FROM down JOIN lots p ON p.id = down.parent_lot_id JOIN lots ch ON ch.id = down.child_lot_id ORDER BY depth, id`, [id])).rows;
      const lotIds = [id, ...new Set(anc.map((a: any) => a.parent_lot_id))];

      const origins = (await c.query(
        `SELECT r.lot_id, r.number AS receipt_number, d.purchase_receipt_no, r.created_at AS received_at, d.id AS declaration_id, w.net_kg, w.declared_kg, w.variance_pct, w.justification,
                p.id AS producer_id, p.internal_code AS producer_code, p.last_name || ' ' || p.first_names AS producer_name, p.village, p.section,
                cu.full_name AS collector_name, d.operation_date
           FROM receipts r JOIN weighings w ON w.id = r.weighing_id JOIN purchase_declarations d ON d.id = r.declaration_id
           JOIN producers p ON p.id = d.producer_id JOIN collectors co ON co.id = d.collector_id JOIN users cu ON cu.id = co.user_id
          WHERE r.lot_id = ANY($1) ORDER BY r.created_at LIMIT 500`, [lotIds])).rows;

      const producerIds = [...new Set(origins.map((o: any) => o.producer_id))];
      const parcels = producerIds.length ? (await c.query(
        `SELECT pc.code, pc.producer_id, pr.internal_code AS producer_code, pc.declared_area_ha, pc.geometry_area_ha, pc.latitude, pc.longitude, pc.verification_status
           FROM parcels pc JOIN producers pr ON pr.id = pc.producer_id
          WHERE pc.producer_id = ANY($1) AND pc.status = 'active' AND pc.value_chain_id = $2 ORDER BY pr.internal_code, pc.code LIMIT 500`, [producerIds, lot.value_chain_id])).rows : [];
      const quality = (await c.query(
        `SELECT i.id, i.kind, i.outcome, i.completed_at, i.summary, i.subject_id,
                (SELECT count(*) FROM inspection_results r WHERE r.inspection_id = i.id AND NOT r.passed)::int AS failed_checks
           FROM inspections i WHERE i.subject_type = 'lot' AND i.subject_id = ANY($1) AND i.status = 'completed' ORDER BY i.completed_at LIMIT 200`, [lotIds])).rows;

      const events = (await c.query(
        `SELECT e.id, e.created_at, e.event_type, e.quantity_kg, e.details, l.code AS lot_code
           FROM lot_events e JOIN lots l ON l.id = e.lot_id WHERE e.lot_id = ANY($1) ORDER BY e.id LIMIT 1000`, [lotIds])).rows;
      const stock = (await c.query(
        `SELECT m.warehouse_id, w.name AS warehouse_name,
                sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) AS balance_kg
           FROM warehouse_movements m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.lot_id = $1 GROUP BY m.warehouse_id, w.name
          HAVING sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) <> 0`, [id])).rows;
      const movements = (await c.query(
        `SELECT reference, movement_type, direction, quantity_kg, occurred_at, lot_id FROM warehouse_movements WHERE lot_id = ANY($1) ORDER BY occurred_at, reference LIMIT 1000`, [lotIds])).rows;

      const anomalies: string[] = [];
      for (const o of origins) {
        if (o.justification) anomalies.push(`Reçu ${o.receipt_number} : écart de pesée ${o.variance_pct} % justifié — « ${o.justification} »`);
        else if (o.variance_pct != null && Number(o.variance_pct) < 0) anomalies.push(`Reçu ${o.receipt_number} : réception inférieure au poids déclaré (${o.variance_pct} %)`);
      }
      const missing: string[] = [];
      if (!origins.length) missing.push('Aucune réception rattachée à ce lot : origine producteur inconnue');
      for (const pid of producerIds) {
        const code = origins.find((o: any) => o.producer_id === pid).producer_code;
        const mine = parcels.filter((x: any) => x.producer_id === pid);
        if (!mine.length) missing.push(`Producteur ${code} : aucune parcelle enregistrée pour cette filière`);
        else {
          if (mine.some((x: any) => x.latitude === null)) missing.push(`Producteur ${code} : parcelle(s) sans coordonnées GPS`);
          if (mine.some((x: any) => x.verification_status !== 'verified')) anomalies.push(`Producteur ${code} : parcelle(s) non vérifiée(s) (données seulement déclarées ou contrôlées)`);
        }
      }
      if (parcels.length) missing.push("Lien exact déclaration → parcelle : non saisi (les parcelles listées sont celles du producteur pour la filière du lot)");
      if (!quality.length) missing.push('Contrôles qualité : aucune inspection terminée enregistrée pour ce lot');
      for (const q of quality) if (q.outcome !== 'compliant') anomalies.push(`Inspection du ${String(q.completed_at).slice(0, 10)} : ${q.outcome === 'non_compliant' ? 'non conforme' : 'à examiner'} (${q.failed_checks} anomalie(s))`);
      missing.push('Expéditions : aucune enregistrée (module non encore disponible)');

      return { generated_at: new Date().toISOString(), lot, stock, origins, parcels, quality, ancestors: anc, descendants: desc, events, movements, anomalies, missing };
    });
  }

  @Get(':id/traceability')
  @RequirePermissions('lots:read')
  async trace(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.traceability(req.org.id, id);
  }

  @Get(':id/traceability.pdf')
  @RequirePermissions('lots:read')
  async tracePdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const t = await this.traceability(req.org.id, id);
    const buf = await traceabilityPdf(t);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="tracabilite-${t.lot.code}.pdf"` }).send(buf);
    await this.log(req, 'lot.traceability_export', 'lot', id);
  }
}
