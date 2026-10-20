import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec, isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';
import { addLotEvent, addMovement } from './stock.helpers';

class WarehouseDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/) code: string;
  @IsString() @Length(2, 100) name: string;
}
class MovementDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() warehouse_id: string;
  @IsUUID() lot_id: string;
  @IsIn(['entry', 'exit', 'loss', 'adjustment_in', 'adjustment_out']) type: string;
  @Dec(3) quantity_kg: string;
  @IsString() @Length(3, 300) reason: string;
}
class TransferDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() from_warehouse_id: string;
  @IsUUID() to_warehouse_id: string;
  @IsUUID() lot_id: string;
  @Dec(3) quantity_kg: string;
  @IsString() @Length(3, 300) reason: string;
}

const DIRECTION: Record<string, 'in' | 'out'> = {
  entry: 'in', adjustment_in: 'in', exit: 'out', loss: 'out', adjustment_out: 'out',
};

@ApiTags('stocks')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class StockController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, entityType: string, entityId: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType, entityId, details });
  }

  @Get('warehouses')
  @RequirePermissions('warehouses:read')
  listWarehouses(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT id, code, name, status FROM warehouses ORDER BY name`)).rows);
  }

  @Post('warehouses')
  @RequirePermissions('warehouses:manage')
  async createWarehouse(@Body() b: WarehouseDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) =>
        (await c.query(`INSERT INTO warehouses(organization_id, code, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id, code, name, status`,
          [req.org.id, b.code, b.name, req.user.id])).rows[0]);
      await this.log(req, 'warehouse.create', 'warehouse', row.id);
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Code de magasin déjà utilisé');
      throw e;
    }
  }

  /** Soldes calculés depuis les mouvements, par magasin et par lot. */
  @Get('stocks')
  @RequirePermissions('warehouses:read')
  stocks(@Req() req: any, @Query('warehouse_id') wh?: string, @Query('lot_id') lot?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT m.warehouse_id, w.name AS warehouse_name, m.lot_id, l.code AS lot_code,
              sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) AS balance_kg
         FROM warehouse_movements m JOIN warehouses w ON w.id = m.warehouse_id JOIN lots l ON l.id = m.lot_id
        WHERE ($1::uuid IS NULL OR m.warehouse_id = $1) AND ($2::uuid IS NULL OR m.lot_id = $2)
        GROUP BY m.warehouse_id, w.name, m.lot_id, l.code
        HAVING sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) <> 0
        ORDER BY w.name, l.code`, [wh ?? null, lot ?? null])).rows);
  }

  @Get('warehouse-movements')
  @RequirePermissions('warehouses:read')
  movements(@Req() req: any, @Query('lot_id') lot?: string, @Query('warehouse_id') wh?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, reference, warehouse_id, lot_id, movement_type, direction, quantity_kg, reason, occurred_at, created_by
         FROM warehouse_movements WHERE ($1::uuid IS NULL OR lot_id = $1) AND ($2::uuid IS NULL OR warehouse_id = $2)
        ORDER BY occurred_at DESC, reference DESC LIMIT 300`, [lot ?? null, wh ?? null])).rows);
  }

  @Post('warehouse-movements')
  @RequirePermissions('stock:move')
  async createMovement(@Body() b: MovementDto, @Req() req: any) {
    if (['loss', 'adjustment_in', 'adjustment_out'].includes(b.type) && !req.org.permissions.has('stock:adjust'))
      throw new ForbiddenException('Les pertes et ajustements exigent la permission stock:adjust');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM warehouse_movements WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const wh = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!wh || wh.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');
      const lot = (await c.query(`SELECT status FROM lots WHERE id = $1`, [b.lot_id])).rows[0];
      if (!lot) throw new BadRequestException('Lot inconnu');
      const mv = await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.warehouse_id, lotId: b.lot_id,
        type: b.type, direction: DIRECTION[b.type], quantityKg: b.quantity_kg, idempotencyKey: b.idempotency_key, reason: b.reason });
      await addLotEvent(c, req.org.id, req.user.id, b.lot_id, b.type, b.quantity_kg, { type: 'movement', id: mv.id }, { reference: mv.reference, reason: b.reason });
      return { row: mv, replay: false };
    });
    if (!replay) await this.log(req, 'stock.movement', 'warehouse_movement', row.id, { type: b.type, quantity_kg: b.quantity_kg });
    return { ...row, replayed: replay };
  }

  @Post('warehouse-transfers')
  @RequirePermissions('stock:move')
  async transfer(@Body() b: TransferDto, @Req() req: any) {
    if (b.from_warehouse_id === b.to_warehouse_id) throw new BadRequestException('Magasins source et destination identiques');
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM warehouse_movements WHERE idempotency_key = $1`, [`${b.idempotency_key}:out`]);
      if (prev.rowCount) {
        const inn = await c.query(`SELECT * FROM warehouse_movements WHERE idempotency_key = $1`, [`${b.idempotency_key}:in`]);
        return { out: prev.rows[0], in: inn.rows[0], replayed: true };
      }
      const wh = await c.query(`SELECT id FROM warehouses WHERE id = ANY($1) AND status = 'active'`, [[b.from_warehouse_id, b.to_warehouse_id]]);
      if (wh.rowCount !== 2) throw new BadRequestException('Magasin inconnu ou fermé');
      if (!(await c.query(`SELECT 1 FROM lots WHERE id = $1`, [b.lot_id])).rowCount) throw new BadRequestException('Lot inconnu');
      const o = await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.from_warehouse_id, lotId: b.lot_id,
        type: 'transfer_out', direction: 'out', quantityKg: b.quantity_kg, idempotencyKey: `${b.idempotency_key}:out`, reason: b.reason });
      const i = await addMovement(c, { orgId: req.org.id, userId: req.user.id, warehouseId: b.to_warehouse_id, lotId: b.lot_id,
        type: 'transfer_in', direction: 'in', quantityKg: b.quantity_kg, idempotencyKey: `${b.idempotency_key}:in`, reason: b.reason, sourceType: 'movement', sourceId: o.id });
      await addLotEvent(c, req.org.id, req.user.id, b.lot_id, 'transfer', b.quantity_kg, { type: 'movement', id: o.id },
        { from: b.from_warehouse_id, to: b.to_warehouse_id, out: o.reference, in: i.reference });
      return { out: o, in: i, replayed: false };
    });
    if (!out.replayed) await this.log(req, 'stock.transfer', 'warehouse_movement', out.out.id, { quantity_kg: b.quantity_kg });
    return out;
  }
}
