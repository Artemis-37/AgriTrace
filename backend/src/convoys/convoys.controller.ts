import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';

export class CreateConvoyDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  /** Numéro de connaissement intérieur du convoi : saisi par le collecteur. */
  @IsString() @Length(2, 60) convoy_no: string;
  @IsOptional() @IsUUID() collector_id?: string;
  @IsString() @Length(2, 120) driver_name: string;
  @IsString() @Length(2, 40) truck_no: string;
  @IsOptional() @IsInt() @Min(0) declared_bags?: number;
  @IsOptional() @Dec(3) declared_kg?: string;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
}
export class ReceiveConvoyDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() collector_id: string;
  @IsString() @Length(2, 60) convoy_no: string;
  @IsUUID() warehouse_id: string;
  @Dec(3) total_kg: string;
  @IsInt() @Min(1) bags: number;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
}
class SettleDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(4) unit_price: string;
}

@ApiTags('convois')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ConvoysController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'convoy', entityId: id, details });
  }

  @Post('convoys')
  @RequirePermissions('convoys:create')
  async create(@Body() b: CreateConvoyDto, @Req() req: any) {
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM convoys WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const own = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      const collectorId = own?.id ?? b.collector_id;
      if (!collectorId) throw new BadRequestException('Collecteur requis (le compte connecté n\'est pas un collecteur)');
      if (own && b.collector_id && b.collector_id !== own.id) throw new BadRequestException('Un collecteur ne peut déclarer que ses propres convois');
      if (!(await c.query(`SELECT 1 FROM collectors WHERE id = $1 AND status = 'active'`, [collectorId])).rowCount) throw new BadRequestException('Collecteur inconnu ou désactivé');
      if ((await c.query(`SELECT 1 FROM convoys WHERE convoy_no = $1`, [b.convoy_no.trim()])).rowCount)
        throw new ConflictException(`Le numéro de convoi « ${b.convoy_no.trim()} » existe déjà`);
      const ins = await c.query(
        `INSERT INTO convoys(organization_id, idempotency_key, convoy_no, collector_id, driver_name, truck_no, declared_bags, declared_kg, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.org.id, b.idempotency_key, b.convoy_no.trim(), collectorId, b.driver_name.trim(), b.truck_no.trim().toUpperCase(),
         b.declared_bags ?? null, b.declared_kg ?? null, b.notes ?? null, req.user.id]);
      return { row: ins.rows[0], replay: false };
    });
    if (!replay) await this.log(req, 'convoy.create', row.id, { convoy_no: row.convoy_no, truck_no: row.truck_no });
    return { ...row, replayed: replay };
  }

  @Get('convoys')
  @RequirePermissions('convoys:read')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.*, u.full_name AS collector_name, r.id AS reception_id, r.total_kg, r.bags, r.variance_kg, r.status AS reception_status, r.amount, r.unit_price
         FROM convoys v JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
         LEFT JOIN convoy_receptions r ON r.convoy_id = v.id
        WHERE ($1::text IS NULL OR v.status = $1)
          AND ($2::boolean OR k.user_id = $3)
        ORDER BY v.created_at DESC LIMIT 300`,
      [status ?? null, req.org.permissions.has('convoys:receive') || req.org.permissions.has('convoys:settle'), req.user.id])).rows);
  }

  /** Convois en route d'un collecteur donné : aide à la sélection par le magasinier. */
  @Get('convoys/expected')
  @RequirePermissions('convoys:receive')
  expected(@Req() req: any, @Query('collector_id') collectorId?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.id, v.convoy_no, v.collector_id, u.full_name AS collector_name, v.driver_name, v.truck_no, v.declared_bags, v.declared_kg, v.created_at
         FROM convoys v JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id WHERE v.status = 'in_transit' AND ($1::uuid IS NULL OR v.collector_id = $1) ORDER BY v.created_at`, [collectorId ?? null])).rows);
  }

  /** Stock acheté du collecteur connecté : achats déclarés, convois en route, livré au magasin central et solde du compte. */
  @Get('convoys/my-stock')
  @RequirePermissions('collector:stock')
  async myStock(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const k = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      if (!k) return { collector: false };
      const buy = (await c.query(
        `SELECT count(*)::int AS purchases,
                coalesce(sum(round(d.quantity * coalesce(CASE WHEN d.unit = 'kg' THEN 1 ELSE f.factor END, 0), 3)), 0) AS purchased_kg,
                coalesce(sum(d.bags), 0)::int AS purchased_bags,
                coalesce(sum(d.amount), 0) AS purchased_amount
           FROM purchase_declarations d LEFT JOIN unit_conversions f ON f.value_chain_id = d.value_chain_id AND f.from_unit = d.unit AND f.to_unit = 'kg'
          WHERE d.collector_id = $1 AND d.status IN ('received','in_review','accepted')`, [k.id])).rows[0];
      const cv = (await c.query(
        `SELECT coalesce(sum(v.declared_kg) FILTER (WHERE v.status = 'in_transit'), 0) AS in_transit_kg,
                count(*) FILTER (WHERE v.status = 'in_transit')::int AS in_transit_convoys,
                coalesce(sum(r.total_kg), 0) AS delivered_kg, coalesce(sum(r.bags), 0)::int AS delivered_bags,
                coalesce(sum(r.amount), 0) AS settled_amount,
                count(*) FILTER (WHERE r.status = 'pending_cashier')::int AS awaiting_cashier
           FROM convoys v LEFT JOIN convoy_receptions r ON r.convoy_id = v.id WHERE v.collector_id = $1`, [k.id])).rows[0];
      const bal = (await c.query(
        `SELECT coalesce(sum(CASE t.direction WHEN 'in' THEN t.amount ELSE -t.amount END), 0) AS balance
           FROM financial_accounts a JOIN financial_transactions t ON t.account_id = a.id WHERE a.owner_type = 'collector' AND a.owner_id = $1`, [k.id])).rows[0];
      const held = (await c.query(`SELECT greatest($1::numeric - $2::numeric, 0) AS kg`, [buy.purchased_kg, cv.delivered_kg])).rows[0].kg;
      return { collector: true, ...buy, ...cv, held_kg: held, balance: bal.balance };
    });
  }

  @Post('convoys/receive')
  @RequirePermissions('convoys:receive')
  async receive(@Body() b: ReceiveConvoyDto, @Req() req: any) {
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM convoy_receptions WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      if (Number(b.total_kg) <= 0) throw new BadRequestException('Poids total doit être supérieur à zéro');
      const v = (await c.query(`SELECT * FROM convoys WHERE collector_id = $1 AND convoy_no = $2 FOR UPDATE`, [b.collector_id, b.convoy_no.trim()])).rows[0];
      if (!v) throw new NotFoundException(`Aucun convoi « ${b.convoy_no.trim()} » pour ce collecteur`);
      if (v.status !== 'in_transit') throw new ConflictException('Ce convoi a déjà été réceptionné');
      const w = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!w || w.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');
      const variance = v.declared_kg == null ? null : (await c.query(`SELECT $1::numeric - $2::numeric AS d`, [b.total_kg, v.declared_kg])).rows[0].d;
      const ins = (await c.query(
        `INSERT INTO convoy_receptions(organization_id, idempotency_key, convoy_id, warehouse_id, total_kg, bags, variance_kg, received_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.org.id, b.idempotency_key, v.id, b.warehouse_id, b.total_kg, b.bags, variance, req.user.id, b.notes ?? null])).rows[0];
      await c.query(`UPDATE convoys SET status = 'received' WHERE id = $1`, [v.id]);
      return { row: ins, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.receive', row.convoy_id, { total_kg: row.total_kg, bags: row.bags, variance_kg: row.variance_kg });
    return { ...row, replayed: replay };
  }

  /** File d'attente de la caisse : réceptions en attente de traitement. */
  @Get('convoys/cashier-queue')
  @RequirePermissions('convoys:settle')
  queue(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.convoy_id, v.convoy_no, v.driver_name, v.truck_no, v.collector_id, u.full_name AS collector_name,
              r.total_kg, r.bags, r.variance_kg, r.received_at
         FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
        WHERE r.status = 'pending_cashier' ORDER BY r.received_at`)).rows);
  }

  /** La caisse traite la réception : calcule le montant (poids × prix) et crédite le compte du collecteur (écriture immuable). */
  @Post('convoy-receptions/:id/settle')
  @RequirePermissions('convoys:settle')
  async settle(@Param('id', ParseUUIDPipe) id: string, @Body() b: SettleDto, @Req() req: any) {
    if (Number(b.unit_price) <= 0) throw new BadRequestException('Prix unitaire doit être supérieur à zéro');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT * FROM convoy_receptions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.status === 'settled') return { row: r, replay: true };
      const v = (await c.query(`SELECT * FROM convoys WHERE id = $1`, [r.convoy_id])).rows[0];
      const u = (await c.query(`SELECT u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [v.collector_id])).rows[0];
      let acc = (await c.query(`SELECT id, currency FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [v.collector_id])).rows[0];
      if (!acc) acc = (await c.query(
        `INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, created_by) VALUES ($1,'collector',$2,$3,$4) RETURNING id, currency`,
        [req.org.id, v.collector_id, `Compte collecteur — ${u.full_name}`, req.user.id])).rows[0];
      const amt = (await c.query(`SELECT round($1::numeric * $2::numeric, 4) AS a`, [r.total_kg, b.unit_price])).rows[0].a;
      const tx = (await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,'in',$4,$5,$6,'convoy_reception',$7,$8) RETURNING id`,
        [req.org.id, 'convoy-' + b.idempotency_key, acc.id, amt, acc.currency, `Convoi ${v.convoy_no} : ${r.total_kg} kg × ${b.unit_price}`, r.id, req.user.id])).rows[0];
      const upd = (await c.query(
        `UPDATE convoy_receptions SET status = 'settled', unit_price = $2, amount = $3, tx_id = $4, settled_by = $5, settled_at = now() WHERE id = $1 RETURNING *`,
        [id, b.unit_price, amt, tx.id, req.user.id])).rows[0];
      await c.query(`UPDATE convoys SET status = 'settled' WHERE id = $1`, [v.id]);
      return { row: upd, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.settle', row.convoy_id, { amount: row.amount, tx_id: row.tx_id });
    return { ...row, replayed: replay };
  }
}
