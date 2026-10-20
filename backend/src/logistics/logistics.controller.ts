import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec, isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';
import { addLotEvent, addMovement, nextNumber, pad } from '../stock/stock.helpers';

class CarrierDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/) code: string;
  @IsString() @Length(2, 150) name: string;
  @IsOptional() @IsString() @Length(3, 30) phone?: string;
}
class VehicleDto {
  @IsString() @Length(3, 20) plate: string;
  @IsOptional() @IsUUID() carrier_id?: string;
  @IsOptional() @IsString() @Length(2, 50) kind?: string;
  @IsOptional() @Dec(3) capacity_kg?: string;
}
class DriverDto {
  @IsString() @Length(2, 150) full_name: string;
  @IsOptional() @IsUUID() carrier_id?: string;
  @IsOptional() @IsString() @Length(3, 30) phone?: string;
  @IsOptional() @IsString() @Length(3, 50) licence_no?: string;
}
class ShipItemDto {
  @IsOptional() @IsUUID() allocation_id?: string;
  @IsOptional() @IsUUID() lot_id?: string;
  @Dec(3) planned_kg: string;
}
class ShipmentDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsOptional() @IsUUID() order_id?: string;
  @IsUUID() origin_warehouse_id: string;
  @IsString() @Length(2, 300) destination: string;
  @IsOptional() @IsUUID() carrier_id?: string;
  @IsOptional() @IsUUID() vehicle_id?: string;
  @IsOptional() @IsUUID() driver_id?: string;
  @IsOptional() @IsISO8601() planned_departure?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ShipItemDto) items: ShipItemDto[];
}
class LoadItemDto { @IsUUID() item_id: string; @Dec(3) loaded_kg: string; }
class LoadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) seals?: string[];
  @IsOptional() @IsString() @Length(2, 60) transport_doc_no?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LoadItemDto) items?: LoadItemDto[];
}
class DeliverItemDto {
  @IsUUID() item_id: string;
  @Dec(3) delivered_kg: string;
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
  @IsOptional() @IsUUID() handler_id?: string;
}
class DeliverDto {
  @IsOptional() @IsISO8601() arrived_at?: string;
  @IsString() @Length(2, 150) received_by_name: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DeliverItemDto) items: DeliverItemDto[];
}
class ValidateDto { @IsOptional() @IsString() @Length(1, 500) note?: string; }
class CancelDto { @IsString() @Length(3, 300) reason: string; }
class IncidentDto {
  @IsIn(['delay', 'damage', 'loss', 'accident', 'seal_broken', 'other']) kind: string;
  @IsString() @Length(3, 1000) description: string;
  @IsOptional() @Dec(3) quantity_kg?: string;
  @IsOptional() @IsUUID() handler_id?: string;
}
class ResolveDto { @IsString() @Length(3, 1000) resolution: string; }

@ApiTags('transport et expéditions')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class LogisticsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}
  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  // ---- Transporteurs, véhicules, conducteurs ----
  @Post('carriers') @RequirePermissions('logistics:manage')
  async carrier(@Body() b: CarrierDto, @Req() req: any) {
    try {
      const r = await this.db.tx(req.org.id, async (c) => (await c.query(`INSERT INTO carriers(organization_id, code, name, phone, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.org.id, b.code, b.name, b.phone ?? null, req.user.id])).rows[0]);
      await this.log(req, 'carrier.create', 'carrier', r.id); return r;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Code transporteur déjà utilisé'); throw e; }
  }
  @Get('carriers') @RequirePermissions('logistics:read')
  carriers(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM carriers ORDER BY code`)).rows); }

  @Post('vehicles') @RequirePermissions('logistics:manage')
  async vehicle(@Body() b: VehicleDto, @Req() req: any) {
    try {
      const r = await this.db.tx(req.org.id, async (c) => {
        if (b.carrier_id && !(await c.query(`SELECT 1 FROM carriers WHERE id = $1`, [b.carrier_id])).rowCount) throw new BadRequestException('Transporteur inconnu');
        return (await c.query(`INSERT INTO vehicles(organization_id, carrier_id, plate, kind, capacity_kg, created_by) VALUES ($1,$2,upper($3),$4,$5,$6) RETURNING *`,
          [req.org.id, b.carrier_id ?? null, b.plate, b.kind ?? null, b.capacity_kg ?? null, req.user.id])).rows[0];
      });
      await this.log(req, 'vehicle.create', 'vehicle', r.id); return r;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Immatriculation déjà enregistrée'); throw e; }
  }
  @Get('vehicles') @RequirePermissions('logistics:read')
  vehicles(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM vehicles ORDER BY plate`)).rows); }

  @Post('drivers') @RequirePermissions('logistics:manage')
  async driver(@Body() b: DriverDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      if (b.carrier_id && !(await c.query(`SELECT 1 FROM carriers WHERE id = $1`, [b.carrier_id])).rowCount) throw new BadRequestException('Transporteur inconnu');
      return (await c.query(`INSERT INTO drivers(organization_id, carrier_id, full_name, phone, licence_no, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.org.id, b.carrier_id ?? null, b.full_name, b.phone ?? null, b.licence_no ?? null, req.user.id])).rows[0];
    });
    await this.log(req, 'driver.create', 'driver', r.id); return r;
  }
  @Get('drivers') @RequirePermissions('logistics:read')
  drivers(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM drivers ORDER BY full_name`)).rows); }

  // ---- Expéditions ----
  private async ship(c: PoolClient, id: string, lock = true) {
    const s = (await c.query(`SELECT * FROM shipments WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!s) throw new NotFoundException();
    return s;
  }
  private async refreshOrder(c: PoolClient, orderId: string | null) {
    if (!orderId) return;
    const t = (await c.query(
      `SELECT (SELECT coalesce(sum(quantity_kg),0) FROM sales_order_lines WHERE order_id = $1) AS ordered,
              (SELECT coalesce(sum(i.loaded_kg),0) FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id WHERE s.order_id = $1 AND s.status <> 'cancelled') AS loaded,
              (SELECT count(*)::int FROM shipments WHERE order_id = $1 AND status IN ('planned','loaded','in_transit','delivered')) AS open_ships,
              (SELECT count(*)::int FROM shipments WHERE order_id = $1 AND status = 'validated') AS validated`, [orderId])).rows[0];
    const o = (await c.query(`SELECT status FROM sales_orders WHERE id = $1`, [orderId])).rows[0];
    if (!o || ['draft', 'cancelled', 'closed'].includes(o.status)) return;
    let st = 'confirmed';
    const full = Number(t.loaded) >= Number(t.ordered);
    if (Number(t.loaded) > 0) st = full ? 'shipped' : 'partially_shipped';
    if (full && t.open_ships === 0 && t.validated > 0) st = 'delivered';
    await c.query(`UPDATE sales_orders SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1 AND status <> $2`, [orderId, st]);
  }

  @Post('shipments') @RequirePermissions('shipments:manage')
  async create(@Body() b: ShipmentDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM shipments WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      const wh = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.origin_warehouse_id])).rows[0];
      if (!wh || wh.status !== 'active') throw new BadRequestException('Magasin d\'origine inconnu ou fermé');
      for (const [tbl, id, label] of [['carriers', b.carrier_id, 'Transporteur'], ['vehicles', b.vehicle_id, 'Véhicule'], ['drivers', b.driver_id, 'Conducteur']] as const)
        if (id && !(await c.query(`SELECT 1 FROM ${tbl} WHERE id = $1 AND status = 'active'`, [id])).rowCount) throw new BadRequestException(`${label} inconnu ou inactif`);
      if (b.order_id) {
        const o = (await c.query(`SELECT status FROM sales_orders WHERE id = $1`, [b.order_id])).rows[0];
        if (!o) throw new BadRequestException('Commande inconnue');
        if (!['confirmed', 'partially_shipped'].includes(o.status)) throw new ConflictException('La commande doit être confirmée (et non encore entièrement expédiée)');
      }
      const n = await nextNumber(c, req.org.id, 'shipment');
      const ref = `EXP-${new Date().getUTCFullYear()}-${pad(n, 5)}`;
      const s = (await c.query(
        `INSERT INTO shipments(organization_id, idempotency_key, reference, order_id, carrier_id, vehicle_id, driver_id, origin_warehouse_id, destination, planned_departure, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.org.id, b.idempotency_key, ref, b.order_id ?? null, b.carrier_id ?? null, b.vehicle_id ?? null, b.driver_id ?? null, b.origin_warehouse_id, b.destination, b.planned_departure ?? null, req.user.id])).rows[0];
      for (const it of b.items) {
        let lot = it.lot_id, whId = b.origin_warehouse_id, alloc: string | null = null;
        if (b.order_id) {
          if (!it.allocation_id) throw new BadRequestException('Une expédition de commande doit référencer des lots affectés (allocation_id)');
          const a = (await c.query(`SELECT * FROM order_allocations WHERE id = $1 AND order_id = $2 AND NOT released FOR UPDATE`, [it.allocation_id, b.order_id])).rows[0];
          if (!a) throw new BadRequestException('Affectation inconnue pour cette commande');
          if (a.warehouse_id !== b.origin_warehouse_id) throw new BadRequestException('L\'affectation est dans un autre magasin que le magasin d\'origine');
          const pending = (await c.query(`SELECT coalesce(sum(i.planned_kg),0) AS p FROM shipment_items i JOIN shipments x ON x.id = i.shipment_id WHERE i.allocation_id = $1 AND x.status = 'planned'`, [a.id])).rows[0].p;
          const room = (await c.query(`SELECT $1::numeric - $2::numeric - $3::numeric AS r`, [a.quantity_kg, a.loaded_kg, pending])).rows[0].r;
          if (Number(it.planned_kg) > Number(room)) throw new BadRequestException(`Quantité supérieure au reste à expédier de cette affectation (${room} kg)`);
          lot = a.lot_id; alloc = a.id;
        } else if (!lot) throw new BadRequestException('lot_id requis pour une expédition sans commande');
        await c.query(`INSERT INTO shipment_items(organization_id, shipment_id, allocation_id, lot_id, warehouse_id, planned_kg) VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.org.id, s.id, alloc, lot, whId, it.planned_kg]);
      }
      await this.log(req, 'shipment.create', 'shipment', s.id, { reference: ref });
      return s;
    });
  }

  @Get('shipments') @RequirePermissions('logistics:read')
  list(@Req() req: any, @Query('status') status?: string, @Query('order_id') order?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.*, (SELECT coalesce(sum(loaded_kg),0) FROM shipment_items WHERE shipment_id = s.id) AS loaded_kg,
              (SELECT coalesce(sum(delivered_kg),0) FROM shipment_items WHERE shipment_id = s.id) AS delivered_kg
         FROM shipments s WHERE ($1::text IS NULL OR s.status = $1) AND ($2::uuid IS NULL OR s.order_id = $2) ORDER BY s.created_at DESC LIMIT 300`, [status ?? null, order ?? null])).rows);
  }

  @Get('shipments/:id') @RequirePermissions('logistics:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id, false);
      const items = (await c.query(
        `SELECT i.*, l.code AS lot_code, (i.loaded_kg - i.delivered_kg) AS discrepancy_kg, (i.planned_kg - i.loaded_kg) AS loading_gap_kg
           FROM shipment_items i JOIN lots l ON l.id = i.lot_id WHERE i.shipment_id = $1 ORDER BY l.code`, [id])).rows;
      const incidents = (await c.query(`SELECT * FROM shipment_incidents WHERE shipment_id = $1 ORDER BY created_at`, [id])).rows;
      const documents = (await c.query(`SELECT id, kind, filename, mime, size_bytes, uploaded_at FROM documents WHERE subject_type = 'shipment' AND subject_id = $1 ORDER BY uploaded_at`, [id])).rows;
      return { ...s, items, incidents, documents };
    });
  }

  @Post('shipments/:id/load') @RequirePermissions('shipments:manage')
  async load(@Param('id', ParseUUIDPipe) id: string, @Body() b: LoadDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id);
      if (s.status === 'loaded') return s;
      if (s.status !== 'planned') throw new ConflictException(`Chargement impossible : expédition « ${s.status} »`);
      const items = (await c.query(`SELECT * FROM shipment_items WHERE shipment_id = $1 FOR UPDATE`, [id])).rows;
      const given = new Map((b.items ?? []).map((x) => [x.item_id, x.loaded_kg]));
      for (const k of given.keys()) if (!items.some((i) => i.id === k)) throw new BadRequestException('Ligne d\'expédition inconnue');
      let total = 0;
      for (const it of items) {
        const kg = given.get(it.id) ?? it.planned_kg;
        if (Number(kg) > Number(it.planned_kg)) throw new BadRequestException('Quantité chargée supérieure à la quantité prévue');
        total += Number(kg);
      }
      if (total <= 0) throw new BadRequestException('Aucune quantité chargée');
      if (s.vehicle_id) {
        const cap = (await c.query(`SELECT capacity_kg FROM vehicles WHERE id = $1`, [s.vehicle_id])).rows[0]?.capacity_kg;
        if (cap && total > Number(cap)) throw new ConflictException(`Chargement (${total} kg) supérieur à la capacité du véhicule (${cap} kg)`);
      }
      for (const it of items) {
        const kg = given.get(it.id) ?? it.planned_kg;
        let mvId: string | null = null;
        if (Number(kg) > 0) {
          const mv = await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: it.warehouse_id, lotId: it.lot_id, type: 'loading', direction: 'out',
            quantityKg: kg, idempotencyKey: `ship:${it.id}:load`, reason: `Chargement ${s.reference}`, sourceType: 'shipment', sourceId: s.id });
          mvId = mv.id;
          await addLotEvent(c, req.org.id, req.user.id, it.lot_id, 'shipment_loaded', kg, { type: 'shipment', id: s.id }, { reference: s.reference, movement: mv.reference });
        }
        await c.query(`UPDATE shipment_items SET loaded_kg = $2, loading_movement_id = $3 WHERE id = $1`, [it.id, kg, mvId]);
        if (it.allocation_id) await c.query(`UPDATE order_allocations SET loaded_kg = loaded_kg + $2 WHERE id = $1`, [it.allocation_id, kg]);
      }
      const r = (await c.query(`UPDATE shipments SET status = 'loaded', seals = $2, transport_doc_no = coalesce($3, transport_doc_no), updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
        [id, b.seals ?? [], b.transport_doc_no ?? null])).rows[0];
      await this.refreshOrder(c, s.order_id);
      await this.log(req, 'shipment.load', 'shipment', id, { total_kg: total, seals: b.seals });
      return r;
    });
  }

  @Post('shipments/:id/depart') @RequirePermissions('shipments:manage')
  async depart(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id);
      if (s.status === 'in_transit') return s;
      if (s.status !== 'loaded') throw new ConflictException('L\'expédition doit être chargée avant le départ');
      if (!s.vehicle_id || !s.driver_id) throw new BadRequestException('Véhicule et conducteur requis pour partir');
      const r = (await c.query(`UPDATE shipments SET status = 'in_transit', departed_at = now(), updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id])).rows[0];
      await this.log(req, 'shipment.depart', 'shipment', id); return r;
    });
  }

  @Post('shipments/:id/deliver') @RequirePermissions('shipments:manage')
  async deliver(@Param('id', ParseUUIDPipe) id: string, @Body() b: DeliverDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id);
      if (s.status !== 'in_transit') throw new ConflictException('L\'expédition doit être en transit');
      const items = (await c.query(`SELECT * FROM shipment_items WHERE shipment_id = $1 FOR UPDATE`, [id])).rows;
      if (b.items.length !== items.length || !items.every((i) => b.items.some((x) => x.item_id === i.id))) throw new BadRequestException('Indiquer la quantité livrée de chaque ligne');
      const discrepancies: any[] = [];
      for (const d of b.items) {
        const it = items.find((i) => i.id === d.item_id)!;
        const gap = (await c.query(`SELECT ($1::numeric - $2::numeric) AS g`, [it.loaded_kg, d.delivered_kg])).rows[0].g;
        if (Number(d.delivered_kg) > Number(it.loaded_kg)) throw new BadRequestException('Quantité livrée supérieure à la quantité chargée : corriger le chargement par un enregistrement justifié');
        if (Number(gap) !== 0 && (!d.reason || !d.handler_id)) throw new BadRequestException(`Écart de ${gap} kg : justification et responsable de traitement obligatoires`);
        if (d.handler_id && !(await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2 AND status = 'active'`, [d.handler_id, req.org.id])).rowCount)
          throw new BadRequestException('Responsable de traitement inconnu dans cette coopérative');
        await c.query(`UPDATE shipment_items SET delivered_kg = $2, discrepancy_reason = $3, discrepancy_handler = $4 WHERE id = $1`,
          [it.id, d.delivered_kg, Number(gap) !== 0 ? d.reason : null, Number(gap) !== 0 ? d.handler_id : null]);
        if (Number(gap) !== 0) discrepancies.push({ item_id: it.id, gap_kg: gap });
        await addLotEvent(c, req.org.id, req.user.id, it.lot_id, 'shipment_delivered', d.delivered_kg, { type: 'shipment', id }, { reference: s.reference, gap_kg: gap });
      }
      const r = (await c.query(`UPDATE shipments SET status = 'delivered', arrived_at = coalesce($2::timestamptz, now()), received_by_name = $3, updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
        [id, b.arrived_at ?? null, b.received_by_name])).rows[0];
      await this.log(req, 'shipment.deliver', 'shipment', id, { discrepancies });
      return { ...r, discrepancies };
    });
  }

  @Post('shipments/:id/validate') @RequirePermissions('shipments:validate')
  async validate(@Param('id', ParseUUIDPipe) id: string, @Body() b: ValidateDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id);
      if (s.status === 'validated') return s;
      if (s.status !== 'delivered') throw new ConflictException('La livraison doit d\'abord être enregistrée');
      const proofs = (await c.query(`SELECT count(*)::int AS n FROM documents WHERE subject_type = 'shipment' AND subject_id = $1 AND kind = 'proof_of_delivery'`, [id])).rows[0].n;
      if (!proofs) throw new BadRequestException('Preuve de livraison manquante (document de type proof_of_delivery)');
      const open = (await c.query(`SELECT count(*)::int AS n FROM shipment_incidents WHERE shipment_id = $1 AND status = 'open'`, [id])).rows[0].n;
      if (open) throw new ConflictException(`${open} incident(s) ouvert(s) : les traiter avant de valider la livraison`);
      const r = (await c.query(`UPDATE shipments SET status = 'validated', validated_by = $2, validated_at = now(), validation_note = $3, updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
        [id, req.user.id, b.note ?? null])).rows[0];
      await this.refreshOrder(c, s.order_id);
      await this.log(req, 'shipment.validate', 'shipment', id); return r;
    });
  }

  @Post('shipments/:id/cancel') @RequirePermissions('shipments:manage')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: CancelDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id);
      if (s.status !== 'planned') throw new ConflictException('Seule une expédition non chargée peut être annulée (sinon enregistrer un incident ou un retour de stock)');
      const r = (await c.query(`UPDATE shipments SET status = 'cancelled', cancel_reason = $2, updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id, b.reason])).rows[0];
      await this.log(req, 'shipment.cancel', 'shipment', id, { reason: b.reason }); return r;
    });
  }

  @Post('shipments/:id/incidents') @RequirePermissions('shipments:manage')
  async incident(@Param('id', ParseUUIDPipe) id: string, @Body() b: IncidentDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.ship(c, id, false);
      if (['planned', 'cancelled'].includes(s.status)) throw new ConflictException('Incident possible seulement après le chargement');
      const r = (await c.query(`INSERT INTO shipment_incidents(organization_id, shipment_id, kind, description, quantity_kg, handler_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.org.id, id, b.kind, b.description, b.quantity_kg ?? null, b.handler_id ?? null, req.user.id])).rows[0];
      await this.log(req, 'shipment.incident', 'shipment', id, { kind: b.kind }); return r;
    });
  }

  @Post('shipment-incidents/:id/resolve') @RequirePermissions('shipments:manage')
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`UPDATE shipment_incidents SET status = 'resolved', resolution = $2, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING *`, [id, b.resolution])).rows[0];
      if (!r) throw new NotFoundException('Incident introuvable ou déjà traité');
      await this.log(req, 'shipment.incident_resolve', 'shipment', r.shipment_id); return r;
    });
  }
}
