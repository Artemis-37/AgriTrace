import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { accountingCodeOf, postEntry, reverseEntry, today } from '../accounting/accounting.helpers';
import { Dec, isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';
import { effectiveSellPrice } from '../products/price';
import { addLotEvent, nextNumber, pad } from '../stock/stock.helpers';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CUR = /^[A-Z]{3}$/;

class BuyerDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/) code: string;
  @IsString() @Length(2, 200) name: string;
  @IsOptional() @IsString() @Length(2, 150) contact_name?: string;
  @IsOptional() @IsString() @Length(3, 30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Length(2, 80) country?: string;
  @IsOptional() @IsString() @Length(2, 300) address?: string;
  @IsOptional() @IsString() @Length(2, 60) tax_id?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) payment_terms_days?: number;
}
class BuyerStatusDto { @IsIn(['active', 'suspended', 'closed']) status: string; @IsString() @Length(3, 300) reason: string; }
class ContractDto {
  @IsString() @Length(3, 40) number: string;
  @IsUUID() buyer_id: string;
  @IsOptional() @IsUUID() value_chain_id?: string;
  @Matches(DATE) starts_on: string;
  @Matches(DATE) ends_on: string;
  @IsOptional() @Dec(3) quantity_kg?: string;
  @IsOptional() @Dec(4) unit_price?: string;
  @IsOptional() @Matches(CUR) currency?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) payment_terms_days?: number;
}
class LineDto { @IsOptional() @IsUUID() product_id?: string; @IsOptional() @IsString() @Length(1, 200) description?: string; @Dec(3) quantity_kg: string; @Dec(4) unit_price: string; }
class OrderDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() buyer_id: string;
  @IsOptional() @IsUUID() contract_id?: string;
  @IsUUID() value_chain_id: string;
  @IsOptional() @IsUUID() campaign_id?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) payment_terms_days?: number;
  @IsOptional() @IsString() @Length(1, 1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
}
class AllocDto { @IsUUID() line_id: string; @IsUUID() lot_id: string; @IsUUID() warehouse_id: string; @Dec(3) quantity_kg: string; }
class CreditNoteDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(2) amount: string;
  @IsString() @Length(3, 500) reason: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) issued_on?: string;
}
class ReasonDto { @IsString() @Length(3, 300) reason: string; }
class InvLineDto { @IsUUID() shipment_item_id: string; @Dec(3) quantity_kg: string; }
class InvoiceDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() order_id: string;
  @IsOptional() @Matches(DATE) issue_date?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InvLineDto) lines: InvLineDto[];
}
class PaymentDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(2) amount: string;
  @Matches(DATE) received_on: string;
  @IsIn(['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other']) method: string;
  @IsOptional() @IsString() @Length(1, 100) reference?: string;
  /** Compte financier qui reçoit l'argent (caisse ou banque) : comptabilise l'encaissement. */
  @IsOptional() @IsUUID() account_id?: string;
  @IsOptional() @IsUUID() cash_session_id?: string;
}
class ClaimDto {
  @IsUUID() buyer_id: string;
  @IsOptional() @IsUUID() order_id?: string;
  @IsOptional() @IsUUID() shipment_id?: string;
  @IsOptional() @IsUUID() invoice_id?: string;
  @IsString() @Length(5, 2000) description: string;
  @IsOptional() @Dec(2) amount_claimed?: string;
}
class ClaimResolveDto { @IsIn(['resolved', 'rejected']) outcome: string; @IsString() @Length(3, 1000) resolution: string; }

@ApiTags('ventes et acheteurs')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class SalesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}
  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  // ---- Acheteurs et contrats ----
  @Post('buyers') @RequirePermissions('buyers:manage')
  async buyer(@Body() b: BuyerDto, @Req() req: any) {
    try {
      const r = await this.db.tx(req.org.id, async (c) => (await c.query(
        `INSERT INTO buyers(organization_id, code, name, contact_name, phone, email, country, address, tax_id, currency, payment_terms_days, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, b.code, b.name, b.contact_name ?? null, b.phone ?? null, b.email ?? null, b.country ?? null, b.address ?? null, b.tax_id ?? null,
         b.currency ?? 'XOF', b.payment_terms_days ?? 30, req.user.id])).rows[0]);
      await this.log(req, 'buyer.create', 'buyer', r.id); return r;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Code acheteur déjà utilisé'); throw e; }
  }
  @Get('buyers') @RequirePermissions('buyers:read')
  buyers(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM buyers ORDER BY code`)).rows); }

  @Post('buyers/:id/status') @RequirePermissions('buyers:manage')
  async buyerStatus(@Param('id', ParseUUIDPipe) id: string, @Body() b: BuyerStatusDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE buyers SET status = $2 WHERE id = $1 RETURNING *`, [id, b.status])).rows[0]);
    if (!r) throw new NotFoundException();
    await this.log(req, 'buyer.status', 'buyer', id, { status: b.status, reason: b.reason }); return r;
  }

  /** Transactions d'un exportateur (acheteur) : factures (débit), encaissements et avoirs (crédit), avec solde cumulé et solde d'ouverture de la période. */
  @Get('buyers/:id/transactions') @RequirePermissions('invoices:read')
  async buyerTransactions(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    for (const d of [from, to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('Dates attendues au format AAAA-MM-JJ');
    return this.db.tx(req.org.id, async (c) => {
      const b = (await c.query(`SELECT id, code, name, currency FROM buyers WHERE id = $1`, [id])).rows[0];
      if (!b) throw new NotFoundException();
      const all = (await c.query(
        `SELECT * FROM (
           SELECT i.issue_date AS date, 'invoice' AS type, i.number AS piece, o.number AS order_no, 'Facture ' || i.number AS label, i.total AS debit, 0::numeric AS credit, i.created_at
             FROM invoices i JOIN sales_orders o ON o.id = i.order_id WHERE i.buyer_id = $1 AND i.status <> 'cancelled'
           UNION ALL
           SELECT p.received_on, 'payment', coalesce(p.reference, '—'), o.number, 'Encaissement facture ' || i.number, 0, p.amount, p.created_at
             FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN sales_orders o ON o.id = i.order_id WHERE i.buyer_id = $1 AND i.status <> 'cancelled'
           UNION ALL
           SELECT n.issued_on, 'credit_note', n.number, o.number, 'Avoir ' || n.number || ' (' || n.reason || ')', 0, n.amount, n.created_at
             FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id JOIN sales_orders o ON o.id = i.order_id WHERE n.buyer_id = $1
         ) t ORDER BY date, created_at`, [id])).rows;
      let bal = 0, opening = 0; const rows: any[] = [];
      for (const r of all) {
        const d = String(r.date instanceof Date ? r.date.toISOString() : r.date).slice(0, 10);
        bal += Number(r.debit) - Number(r.credit);
        if (from && d < from) { opening = bal; continue; }
        if (to && d > to) continue;
        rows.push({ date: d, type: r.type, piece: r.piece, order_no: r.order_no, label: r.label, debit: Number(r.debit), credit: Number(r.credit), balance: bal });
      }
      const debit = rows.reduce((a, r) => a + r.debit, 0), credit = rows.reduce((a, r) => a + r.credit, 0);
      return { buyer: b, period: { from: from ?? null, to: to ?? null }, opening, rows, totals: { debit, credit, balance: opening + debit - credit } };
    });
  }

  /** Situation d'un acheteur : facturé, encaissé, solde, échéances dépassées. */
  @Get('buyers/:id/statement') @RequirePermissions('invoices:read')
  async statement(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const b = (await c.query(`SELECT * FROM buyers WHERE id = $1`, [id])).rows[0];
      if (!b) throw new NotFoundException();
      const invoices = (await c.query(this.invoiceSql(`WHERE i.buyer_id = $1 AND i.status <> 'cancelled'`), [id])).rows;
      const sum = (f: (x: any) => number) => invoices.reduce((s, x) => s + f(x), 0);
      return { buyer: b, invoices,
        totals: { invoiced: sum((x) => Number(x.total)).toFixed(2), paid: sum((x) => Number(x.paid)).toFixed(2), balance: sum((x) => Number(x.balance)).toFixed(2),
                  overdue: sum((x) => (x.overdue ? Number(x.balance) : 0)).toFixed(2) } };
    });
  }

  @Post('sales-contracts') @RequirePermissions('buyers:manage')
  async contract(@Body() b: ContractDto, @Req() req: any) {
    try {
      const r = await this.db.tx(req.org.id, async (c) => {
        const by = (await c.query(`SELECT currency, payment_terms_days FROM buyers WHERE id = $1`, [b.buyer_id])).rows[0];
        if (!by) throw new BadRequestException('Acheteur inconnu');
        return (await c.query(
          `INSERT INTO sales_contracts(organization_id, number, buyer_id, value_chain_id, starts_on, ends_on, quantity_kg, unit_price, currency, payment_terms_days, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) RETURNING *`,
          [req.org.id, b.number, b.buyer_id, b.value_chain_id ?? null, b.starts_on, b.ends_on, b.quantity_kg ?? null, b.unit_price ?? null,
           b.currency ?? by.currency, b.payment_terms_days ?? by.payment_terms_days, req.user.id])).rows[0];
      });
      await this.log(req, 'contract.create', 'sales_contract', r.id); return r;
    } catch (e: any) {
      if (isUniqueViolation(e)) throw new ConflictException('Numéro de contrat déjà utilisé');
      if (e.code === '23514') throw new BadRequestException('Dates de contrat incohérentes');
      throw e;
    }
  }
  @Get('sales-contracts') @RequirePermissions('buyers:read')
  contracts(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM sales_contracts ORDER BY starts_on DESC`)).rows); }

  // ---- Commandes ----
  private async order(c: PoolClient, id: string, lock = true) {
    const o = (await c.query(`SELECT * FROM sales_orders WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!o) throw new NotFoundException();
    return o;
  }

  @Post('sales-orders') @RequirePermissions('orders:manage')
  async createOrder(@Body() b: OrderDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM sales_orders WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      const by = (await c.query(`SELECT * FROM buyers WHERE id = $1`, [b.buyer_id])).rows[0];
      if (!by) throw new BadRequestException('Acheteur inconnu');
      if (by.status !== 'active') throw new ConflictException('Acheteur suspendu ou clôturé');
      if (!(await c.query(`SELECT 1 FROM value_chains WHERE id = $1`, [b.value_chain_id])).rowCount) throw new BadRequestException('Filière inconnue');
      // Ligne liée à un produit : le prix de vente au kilo est celui fixé par l'administrateur de la coopérative.
      const mayPrice = req.org.permissions.has('products:manage') || req.org.permissions.has('prices:manage');
      for (const l of b.lines) {
        if (!l.product_id) continue;
        const prod = (await c.query(`SELECT name FROM products WHERE id = $1`, [l.product_id])).rows[0];
        if (!prod) throw new BadRequestException('Produit inconnu');
        const official = await effectiveSellPrice(c, l.product_id, b.campaign_id ?? null);
        if (!mayPrice && official == null) throw new ConflictException("Prix de vente non fixé pour ce produit : l'administrateur doit le renseigner dans Paramètres");
        if (!mayPrice && Number(l.unit_price) !== Number(official)) throw new ForbiddenException("Le prix de vente au kilo est fixé par l'administrateur de la coopérative");
        l.description = l.description ?? prod.name;
      }
      let currency = by.currency, terms = b.payment_terms_days ?? by.payment_terms_days;
      if (b.contract_id) {
        const k = (await c.query(`SELECT * FROM sales_contracts WHERE id = $1`, [b.contract_id])).rows[0];
        if (!k || k.buyer_id !== b.buyer_id) throw new BadRequestException('Contrat inconnu pour cet acheteur');
        if (k.status !== 'active' || new Date(k.ends_on) < new Date(new Date().toISOString().slice(0, 10))) throw new ConflictException('Contrat expiré ou inactif');
        if (k.value_chain_id && k.value_chain_id !== b.value_chain_id) throw new BadRequestException('Filière différente de celle du contrat');
        currency = k.currency; terms = b.payment_terms_days ?? k.payment_terms_days;
        if (k.quantity_kg) {
          const used = (await c.query(`SELECT coalesce(sum(l.quantity_kg),0) AS q FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id WHERE o.contract_id = $1 AND o.status <> 'cancelled'`, [k.id])).rows[0].q;
          const asked = b.lines.reduce((s, l) => s + Number(l.quantity_kg), 0);
          if (Number(used) + asked > Number(k.quantity_kg)) throw new ConflictException(`Quantité supérieure au solde du contrat (${Number(k.quantity_kg) - Number(used)} kg restants)`);
        }
      }
      const n = await nextNumber(c, req.org.id, 'sales_order');
      const number = `CMD-${new Date().getUTCFullYear()}-${pad(n, 5)}`;
      let o;
      try {
        o = (await c.query(
          `INSERT INTO sales_orders(organization_id, idempotency_key, number, buyer_id, contract_id, value_chain_id, campaign_id, currency, payment_terms_days, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [req.org.id, b.idempotency_key, number, b.buyer_id, b.contract_id ?? null, b.value_chain_id, b.campaign_id ?? null, currency, terms, b.notes ?? null, req.user.id])).rows[0];
      } catch (e: any) { if (e.code === '23503') throw new BadRequestException('Campagne inconnue'); throw e; }
      for (const l of b.lines)
        await c.query(`INSERT INTO sales_order_lines(organization_id, order_id, description, quantity_kg, unit_price) VALUES ($1,$2,$3,$4,$5)`, [req.org.id, o.id, l.description ?? null, l.quantity_kg, l.unit_price]);
      await this.log(req, 'order.create', 'sales_order', o.id, { number });
      return o;
    });
  }

  @Get('sales-orders') @RequirePermissions('buyers:read')
  orders(@Req() req: any, @Query('status') status?: string, @Query('buyer_id') buyer?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT o.*, (SELECT coalesce(sum(quantity_kg),0) FROM sales_order_lines WHERE order_id = o.id) AS ordered_kg,
              (SELECT coalesce(sum(quantity_kg*unit_price),0)::numeric(18,2) FROM sales_order_lines WHERE order_id = o.id) AS amount
         FROM sales_orders o WHERE ($1::text IS NULL OR o.status = $1) AND ($2::uuid IS NULL OR o.buyer_id = $2) ORDER BY o.created_at DESC LIMIT 300`, [status ?? null, buyer ?? null])).rows);
  }

  @Get('sales-orders/:id') @RequirePermissions('buyers:read')
  async getOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const o = await this.order(c, id, false);
      const lines = (await c.query(`SELECT *, (quantity_kg*unit_price)::numeric(18,2) AS amount FROM sales_order_lines WHERE order_id = $1 ORDER BY id`, [id])).rows;
      const allocations = (await c.query(
        `SELECT a.*, l.code AS lot_code, w.code AS warehouse_code, (a.quantity_kg - a.loaded_kg) AS remaining_kg FROM order_allocations a JOIN lots l ON l.id = a.lot_id JOIN warehouses w ON w.id = a.warehouse_id
          WHERE a.order_id = $1 ORDER BY a.created_at`, [id])).rows;
      const shipments = (await c.query(`SELECT id, reference, status, departed_at, arrived_at FROM shipments WHERE order_id = $1 ORDER BY created_at`, [id])).rows;
      const invoices = (await c.query(this.invoiceSql(`WHERE i.order_id = $1`), [id])).rows;
      const buyer = (await c.query(`SELECT id, code, name FROM buyers WHERE id = $1`, [o.buyer_id])).rows[0];
      return { ...o, buyer, lines, allocations, shipments, invoices };
    });
  }

  @Post('sales-orders/:id/confirm') @RequirePermissions('orders:manage')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const o = await this.order(c, id);
      if (o.status === 'confirmed') return o;
      if (o.status !== 'draft') throw new ConflictException('Seule une commande en brouillon peut être confirmée');
      const by = (await c.query(`SELECT status FROM buyers WHERE id = $1`, [o.buyer_id])).rows[0];
      if (by.status !== 'active') throw new ConflictException('Acheteur suspendu ou clôturé');
      const r = (await c.query(`UPDATE sales_orders SET status = 'confirmed', updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id])).rows[0];
      await this.log(req, 'order.confirm', 'sales_order', id); return r;
    });
  }

  @Post('sales-orders/:id/cancel') @RequirePermissions('orders:manage')
  async cancelOrder(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const o = await this.order(c, id);
      if (!['draft', 'confirmed'].includes(o.status)) throw new ConflictException('Commande déjà expédiée, livrée ou clôturée : annulation impossible');
      if ((await c.query(`SELECT 1 FROM shipments WHERE order_id = $1 AND status <> 'cancelled'`, [id])).rowCount) throw new ConflictException('Annuler d\'abord les expéditions de cette commande');
      await c.query(`UPDATE order_allocations SET released = true WHERE order_id = $1`, [id]);
      const r = (await c.query(`UPDATE sales_orders SET status = 'cancelled', cancel_reason = $2, updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id, b.reason])).rows[0];
      await this.log(req, 'order.cancel', 'sales_order', id, { reason: b.reason }); return r;
    });
  }

  @Post('sales-orders/:id/close') @RequirePermissions('orders:manage')
  async closeOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const o = await this.order(c, id);
      if (o.status === 'closed') return o;
      if (o.status !== 'delivered') throw new ConflictException('La commande doit être livrée (livraisons validées) avant clôture');
      const unpaid = (await c.query(`SELECT count(*)::int AS n FROM invoices WHERE order_id = $1 AND status IN ('issued','partially_paid')`, [id])).rows[0].n;
      if (unpaid) throw new ConflictException(`${unpaid} facture(s) non soldée(s)`);
      const r = (await c.query(`UPDATE sales_orders SET status = 'closed', updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id])).rows[0];
      await this.log(req, 'order.close', 'sales_order', id); return r;
    });
  }

  /** Affectation d'un lot à une ligne de commande : réservation du stock disponible. */
  @Post('sales-orders/:id/allocations') @RequirePermissions('orders:manage')
  async allocate(@Param('id', ParseUUIDPipe) id: string, @Body() b: AllocDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const o = await this.order(c, id);
      if (!['draft', 'confirmed', 'partially_shipped'].includes(o.status)) throw new ConflictException('Commande non modifiable à ce stade');
      const line = (await c.query(`SELECT * FROM sales_order_lines WHERE id = $1 AND order_id = $2`, [b.line_id, id])).rows[0];
      if (!line) throw new BadRequestException('Ligne de commande inconnue');
      await c.query(`SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, [b.lot_id]);
      const lot = (await c.query(`SELECT value_chain_id, code, status FROM lots WHERE id = $1`, [b.lot_id])).rows[0];
      if (!lot) throw new BadRequestException('Lot inconnu');
      if (lot.value_chain_id !== o.value_chain_id) throw new BadRequestException('Le lot appartient à une autre filière que la commande');
      const wh = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!wh || wh.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');
      const st = (await c.query(
        `SELECT coalesce((SELECT sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END) FROM warehouse_movements WHERE lot_id = $1 AND warehouse_id = $2), 0) AS balance,
                coalesce((SELECT sum(quantity_kg - loaded_kg) FROM order_allocations WHERE lot_id = $1 AND warehouse_id = $2 AND NOT released), 0) AS reserved`, [b.lot_id, b.warehouse_id])).rows[0];
      const avail = Number(st.balance) - Number(st.reserved);
      if (Number(b.quantity_kg) > avail) throw new BadRequestException(`Stock disponible insuffisant pour le lot ${lot.code} (disponible hors réservations : ${avail} kg)`);
      const already = (await c.query(`SELECT coalesce(sum(quantity_kg),0) AS q FROM order_allocations WHERE line_id = $1 AND NOT released`, [b.line_id])).rows[0].q;
      if (Number(already) + Number(b.quantity_kg) > Number(line.quantity_kg)) throw new BadRequestException(`Affectation supérieure à la quantité commandée sur cette ligne (${Number(line.quantity_kg) - Number(already)} kg restants)`);
      const a = (await c.query(`INSERT INTO order_allocations(organization_id, order_id, line_id, lot_id, warehouse_id, quantity_kg, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.org.id, id, b.line_id, b.lot_id, b.warehouse_id, b.quantity_kg, req.user.id])).rows[0];
      await addLotEvent(c, req.org.id, req.user.id, b.lot_id, 'allocated_to_order', b.quantity_kg, { type: 'sales_order', id }, { order: o.number });
      await this.log(req, 'order.allocate', 'sales_order', id, { lot: lot.code, quantity_kg: b.quantity_kg });
      return a;
    });
  }

  @Post('sales-orders/:id/allocations/:aid/release') @RequirePermissions('orders:manage')
  async release(@Param('id', ParseUUIDPipe) id: string, @Param('aid', ParseUUIDPipe) aid: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      await this.order(c, id);
      const a = (await c.query(`SELECT * FROM order_allocations WHERE id = $1 AND order_id = $2 FOR UPDATE`, [aid, id])).rows[0];
      if (!a) throw new NotFoundException();
      if (Number(a.loaded_kg) > 0) throw new ConflictException('Lot déjà (en partie) chargé : affectation non libérable');
      if ((await c.query(`SELECT 1 FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id WHERE i.allocation_id = $1 AND s.status <> 'cancelled'`, [aid])).rowCount) throw new ConflictException('Affectation utilisée par une expédition');
      const r = (await c.query(`UPDATE order_allocations SET released = true WHERE id = $1 RETURNING *`, [aid])).rows[0];
      await this.log(req, 'order.release', 'sales_order', id, { allocation: aid }); return r;
    });
  }

  // ---- Factures et paiements reçus ----
  /** Écriture de vente (Dr 411 clients / Cr 701 ventes), idempotente ; rattrape aussi les factures émises avant son introduction. */
  private async saleEntry(c: PoolClient, req: any, inv: any) {
    await c.query(`SELECT accounting_seed($1::uuid)`, [req.org.id]);
    await c.query(`INSERT INTO journals(organization_id, code, label) VALUES ($1,'VTE','Journal des ventes') ON CONFLICT DO NOTHING`, [req.org.id]);
    if (Number(inv.total) <= 0) return null;
    const day = (await c.query(`SELECT issue_date::text AS d FROM invoices WHERE id = $1`, [inv.id])).rows[0].d;
    return postEntry(c, {
      orgId: req.org.id, userId: req.user.id, journal: 'VTE', date: day, label: `Facture ${inv.number}`,
      lines: [{ code: '411', debit: inv.total }, { code: '701', credit: inv.total }],
      idempotencyKey: 'sale-entry:' + inv.id, referenceType: 'invoice', referenceId: inv.id,
    });
  }

  private invoiceSql(where: string) {
    return `SELECT i.*, b.code AS buyer_code, b.name AS buyer_name,
                   coalesce((SELECT sum(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)::numeric(18,2) AS paid,
                   coalesce((SELECT sum(amount) FROM credit_notes n WHERE n.invoice_id = i.id), 0)::numeric(18,2) AS credited,
                   (i.total - coalesce((SELECT sum(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)
                            - coalesce((SELECT sum(amount) FROM credit_notes n WHERE n.invoice_id = i.id), 0))::numeric(18,2) AS balance,
                   (i.status IN ('issued','partially_paid') AND i.due_date < current_date) AS overdue
              FROM invoices i JOIN buyers b ON b.id = i.buyer_id ${where} ORDER BY i.issue_date DESC, i.number DESC LIMIT 500`;
  }

  @Post('invoices') @RequirePermissions('invoices:issue')
  async issue(@Body() b: InvoiceDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM invoices WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      const o = await this.order(c, b.order_id);
      if (['draft', 'cancelled'].includes(o.status)) throw new ConflictException('Commande non facturable');
      const issue = b.issue_date ?? new Date().toISOString().slice(0, 10);
      const seen = new Set<string>();
      const lines: { item: any; qty: string; price: string; amount: string }[] = [];
      for (const l of b.lines) {
        if (seen.has(l.shipment_item_id)) throw new BadRequestException('Ligne d\'expédition en double');
        seen.add(l.shipment_item_id);
        const it = (await c.query(
          `SELECT i.*, s.status AS ship_status, s.order_id, a.line_id FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id LEFT JOIN order_allocations a ON a.id = i.allocation_id
            WHERE i.id = $1 FOR UPDATE OF i`, [l.shipment_item_id])).rows[0];
        if (!it || it.order_id !== o.id) throw new BadRequestException('Ligne d\'expédition inconnue pour cette commande');
        if (it.ship_status !== 'validated') throw new ConflictException('Seules les livraisons validées sont facturables');
        const left = (await c.query(`SELECT ($1::numeric - $2::numeric) AS l`, [it.delivered_kg, it.invoiced_kg])).rows[0].l;
        if (Number(l.quantity_kg) > Number(left)) throw new BadRequestException(`Quantité supérieure au livré non encore facturé (${left} kg)`);
        const price = (await c.query(`SELECT unit_price FROM sales_order_lines WHERE id = $1`, [it.line_id])).rows[0]?.unit_price;
        if (price === undefined) throw new UnprocessableEntityException('Prix de la ligne de commande introuvable');
        const amount = (await c.query(`SELECT round($1::numeric * $2::numeric, 2) AS a`, [l.quantity_kg, price])).rows[0].a;
        lines.push({ item: it, qty: l.quantity_kg, price, amount });
      }
      const total = (await c.query(`SELECT coalesce(sum(x),0)::numeric(18,2) AS t FROM unnest($1::numeric[]) x`, [lines.map((l) => l.amount)])).rows[0].t;
      const n = await nextNumber(c, req.org.id, 'invoice');
      const number = `FA-${new Date().getUTCFullYear()}-${pad(n, 5)}`;
      const inv = (await c.query(
        `INSERT INTO invoices(organization_id, idempotency_key, number, order_id, buyer_id, currency, issue_date, due_date, total, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$7::date + $8::int,$9,$10) RETURNING *`,
        [req.org.id, b.idempotency_key, number, o.id, o.buyer_id, o.currency, issue, o.payment_terms_days, total, req.user.id])).rows[0];
      for (const l of lines) {
        await c.query(`INSERT INTO invoice_lines(organization_id, invoice_id, shipment_item_id, lot_id, quantity_kg, unit_price, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.org.id, inv.id, l.item.id, l.item.lot_id, l.qty, l.price, l.amount]);
        await c.query(`UPDATE shipment_items SET invoiced_kg = invoiced_kg + $2 WHERE id = $1`, [l.item.id, l.qty]);
        await addLotEvent(c, req.org.id, req.user.id, l.item.lot_id, 'invoiced', l.qty, { type: 'invoice', id: inv.id }, { invoice: number });
      }
      await this.saleEntry(c, req, inv);
      await this.log(req, 'invoice.issue', 'invoice', inv.id, { number, total });
      return inv;
    });
  }

  @Get('invoices') @RequirePermissions('invoices:read')
  invoices(@Req() req: any, @Query('status') status?: string, @Query('buyer_id') buyer?: string, @Query('overdue') overdue?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(this.invoiceSql(
      `WHERE ($1::text IS NULL OR i.status = $1) AND ($2::uuid IS NULL OR i.buyer_id = $2)
         AND ($3::boolean IS NOT TRUE OR (i.status IN ('issued','partially_paid') AND i.due_date < current_date))`), [status ?? null, buyer ?? null, overdue === 'true' ? true : null])).rows);
  }

  @Get('invoices/:id') @RequirePermissions('invoices:read')
  async invoice(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const i = (await c.query(this.invoiceSql(`WHERE i.id = $1`), [id])).rows[0];
      if (!i) throw new NotFoundException();
      const lines = (await c.query(`SELECT l.*, lt.code AS lot_code FROM invoice_lines l JOIN lots lt ON lt.id = l.lot_id WHERE l.invoice_id = $1`, [id])).rows;
      const payments = (await c.query(`SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY received_on, created_at`, [id])).rows;
      const credit_notes = (await c.query(`SELECT * FROM credit_notes WHERE invoice_id = $1 ORDER BY issued_on, created_at`, [id])).rows;
      return { ...i, lines, payments, credit_notes };
    });
  }

  @Post('invoices/:id/cancel') @RequirePermissions('invoices:issue')
  async cancelInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const i = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!i) throw new NotFoundException();
      if (i.status === 'cancelled') return i;
      if ((await c.query(`SELECT 1 FROM invoice_payments WHERE invoice_id = $1`, [id])).rowCount) throw new ConflictException('Des paiements sont enregistrés : annulation impossible');
      if ((await c.query(`SELECT 1 FROM credit_notes WHERE invoice_id = $1`, [id])).rowCount) throw new ConflictException('Des avoirs sont émis sur cette facture : annulation impossible');
      const sale = (await c.query(`SELECT id FROM accounting_entries WHERE idempotency_key = $1`, ['sale-entry:' + id])).rows[0];
      if (sale) await reverseEntry(c, req.org.id, req.user.id, sale.id, `Annulation facture ${i.number}`, today());
      for (const l of (await c.query(`SELECT * FROM invoice_lines WHERE invoice_id = $1`, [id])).rows)
        await c.query(`UPDATE shipment_items SET invoiced_kg = invoiced_kg - $2 WHERE id = $1`, [l.shipment_item_id, l.quantity_kg]);
      const r = (await c.query(`UPDATE invoices SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = now() WHERE id = $1 RETURNING *`, [id, b.reason, req.user.id])).rows[0];
      await this.log(req, 'invoice.cancel', 'invoice', id, { reason: b.reason }); return r;
    });
  }

  /** Avoir : réduit le solde à encaisser (jamais en dessous de zéro) ; écriture Dr 701 / Cr 411 ; non modifiable. */
  @Post('invoices/:id/credit-notes') @RequirePermissions('invoices:issue')
  async creditNote(@Param('id', ParseUUIDPipe) id: string, @Body() b: CreditNoteDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    const out = await this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM credit_notes WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) return prior;
      const i = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!i) throw new NotFoundException();
      if (i.status === 'cancelled') throw new ConflictException('Facture annulée');
      const paid = (await c.query(`SELECT coalesce(sum(amount),0) AS p FROM invoice_payments WHERE invoice_id = $1`, [id])).rows[0].p;
      const credited = (await c.query(`SELECT coalesce(sum(amount),0) AS n FROM credit_notes WHERE invoice_id = $1`, [id])).rows[0].n;
      const left = (await c.query(`SELECT ($1::numeric - $2::numeric - $3::numeric) AS l`, [i.total, paid, credited])).rows[0].l;
      if (Number(b.amount) > Number(left)) throw new BadRequestException(`Avoir supérieur au solde non encaissé de la facture (${left}) : un remboursement n'est pas géré`);
      const issued = b.issued_on ?? today();
      if (issued > today()) throw new BadRequestException("Date d'avoir dans le futur");
      await this.saleEntry(c, req, i);
      const n = await nextNumber(c, req.org.id, 'credit_note');
      const number = `AV-${new Date().getUTCFullYear()}-${pad(n, 5)}`;
      const entry = await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'VTE', date: issued, label: `Avoir ${number} sur facture ${i.number} : ${b.reason}`,
        lines: [{ code: '701', debit: b.amount }, { code: '411', credit: b.amount }],
        idempotencyKey: 'credit-entry:' + b.idempotency_key, referenceType: 'credit_note', referenceId: id,
      });
      const cn = (await c.query(
        `INSERT INTO credit_notes(organization_id, idempotency_key, number, invoice_id, buyer_id, amount, currency, reason, issued_on, entry_number, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.org.id, b.idempotency_key, number, id, i.buyer_id, b.amount, i.currency, b.reason, issued, entry.number, req.user.id])).rows[0];
      const rest = (await c.query(`SELECT ($1::numeric - $2::numeric - $3::numeric - $4::numeric) AS r`, [i.total, paid, credited, b.amount])).rows[0].r;
      if (Number(rest) === 0) await c.query(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [id]);
      await this.log(req, 'invoice.credit_note', 'invoice', id, { number, amount: b.amount, reason: b.reason });
      return { ...cn, balance: rest };
    });
    return out;
  }

  @Post('invoices/:id/payments') @RequirePermissions('invoices:payments')
  async pay(@Param('id', ParseUUIDPipe) id: string, @Body() b: PaymentDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM invoice_payments WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) return prior;
      const i = (await c.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!i) throw new NotFoundException();
      if (i.status === 'cancelled') throw new ConflictException('Facture annulée');
      const paid = (await c.query(`SELECT coalesce(sum(amount),0) AS p FROM invoice_payments WHERE invoice_id = $1`, [id])).rows[0].p;
      const credited = (await c.query(`SELECT coalesce(sum(amount),0) AS n FROM credit_notes WHERE invoice_id = $1`, [id])).rows[0].n;
      const balance = (await c.query(`SELECT ($1::numeric - $2::numeric - $3::numeric) AS b`, [i.total, paid, credited])).rows[0].b;
      if (Number(b.amount) > Number(balance)) throw new BadRequestException(`Montant supérieur au solde de la facture (${balance})`);
      if (b.received_on > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Date d\'encaissement dans le futur');
      const p = (await c.query(`INSERT INTO invoice_payments(organization_id, idempotency_key, invoice_id, amount, received_on, method, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.org.id, b.idempotency_key, id, b.amount, b.received_on, b.method, b.reference ?? null, req.user.id])).rows[0];
      const rest = (await c.query(`SELECT ($1::numeric - $2::numeric - $3::numeric - $4::numeric) AS r`, [i.total, paid, b.amount, credited])).rows[0].r;
      await c.query(`UPDATE invoices SET status = $2 WHERE id = $1`, [id, Number(rest) === 0 ? 'paid' : 'partially_paid']);
      if (b.account_id) {
        if (!req.org.permissions.has('cash:operate')) throw new ForbiddenException('Comptabiliser un encaissement exige le droit « cash:operate »');
        const a = (await c.query(`SELECT * FROM financial_accounts WHERE id = $1 AND status = 'active' FOR UPDATE`, [b.account_id])).rows[0];
        if (!a) throw new BadRequestException('Compte de réception inconnu ou clôturé');
        const isCash = a.owner_type === 'cash_register';
        if (isCash) {
          const ok = b.cash_session_id && (await c.query(`SELECT 1 FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 AND s.status = 'open' AND r.account_id = $2`, [b.cash_session_id, a.id])).rowCount;
          if (!ok) throw new BadRequestException('Un encaissement en caisse exige que le caissier soit connecté à cette caisse');
        }
        const reason = `Encaissement facture ${i.number}`;
        const tx = (await c.query(
          `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
           VALUES ($1,$2,$3,$4,'in',$5,$6,$7,'invoice_payment',$8,$9) RETURNING id`,
          [req.org.id, 'invpay:' + b.idempotency_key, a.id, isCash ? b.cash_session_id : null, b.amount, a.currency, reason, p.id, req.user.id])).rows[0];
        await postEntry(c, {
          orgId: req.org.id, userId: req.user.id, journal: isCash ? 'CAI' : 'BQ', date: b.received_on || today(), label: reason,
          lines: [{ code: accountingCodeOf(a), debit: b.amount }, { code: '411', credit: b.amount }],
          idempotencyKey: 'invpay-entry:' + b.idempotency_key, referenceType: 'invoice_payment', referenceId: tx.id,
        });
      }
      await this.log(req, 'invoice.payment', 'invoice', id, { amount: b.amount, method: b.method });
      return { ...p, balance: rest };
    });
  }

  // ---- Réclamations ----
  @Post('sales-claims') @RequirePermissions('claims:manage')
  async claim(@Body() b: ClaimDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      if (!(await c.query(`SELECT 1 FROM buyers WHERE id = $1`, [b.buyer_id])).rowCount) throw new BadRequestException('Acheteur inconnu');
      for (const [tbl, id] of [['sales_orders', b.order_id], ['shipments', b.shipment_id], ['invoices', b.invoice_id]] as const)
        if (id && !(await c.query(`SELECT 1 FROM ${tbl} WHERE id = $1 ${tbl === 'sales_orders' ? '' : ''}`, [id])).rowCount) throw new BadRequestException('Référence de la réclamation inconnue');
      const r = (await c.query(`INSERT INTO sales_claims(organization_id, buyer_id, order_id, shipment_id, invoice_id, description, amount_claimed, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.org.id, b.buyer_id, b.order_id ?? null, b.shipment_id ?? null, b.invoice_id ?? null, b.description, b.amount_claimed ?? null, req.user.id])).rows[0];
      await this.log(req, 'claim.create', 'sales_claim', r.id); return r;
    });
  }
  @Get('sales-claims') @RequirePermissions('claims:manage')
  claims(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT * FROM sales_claims WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 300`, [status ?? null])).rows);
  }
  @Post('sales-claims/:id/resolve') @RequirePermissions('claims:manage')
  async resolveClaim(@Param('id', ParseUUIDPipe) id: string, @Body() b: ClaimResolveDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`UPDATE sales_claims SET status = $2, resolution = $3, resolved_at = now(), resolved_by = $4 WHERE id = $1 AND status = 'open' RETURNING *`, [id, b.outcome, b.resolution, req.user.id])).rows[0];
      if (!r) throw new NotFoundException('Réclamation introuvable ou déjà traitée');
      await this.log(req, 'claim.resolve', 'sales_claim', id, { outcome: b.outcome }); return r;
    });
  }

  // ---- Traçabilité descendante (CDC §16.3) ----
  @Get('traceability/forward') @RequirePermissions('lots:read', 'buyers:read')
  async forward(@Req() req: any, @Query('producer_id') producerId?: string, @Query('parcel_id') parcelId?: string, @Query('lot_id') lotId?: string, @Query('declaration_id') declId?: string) {
    const given = [producerId, parcelId, lotId, declId].filter(Boolean);
    if (given.length !== 1) throw new BadRequestException('Indiquer exactement un critère : producer_id, parcel_id, lot_id ou declaration_id');
    return this.db.tx(req.org.id, async (c) => {
      const notes: string[] = [];
      let startLots: string[] = [];
      let producer: string | null = producerId ?? null;
      if (parcelId) {
        const p = (await c.query(`SELECT producer_id FROM parcels WHERE id = $1`, [parcelId])).rows[0];
        if (!p) throw new NotFoundException('Parcelle inconnue');
        producer = p.producer_id;
        notes.push('Lien indirect : les achats ne sont pas rattachés à une parcelle précise, la recherche porte sur tous les achats du producteur propriétaire de la parcelle.');
      }
      if (lotId) startLots = [lotId];
      else if (declId) startLots = (await c.query(`SELECT DISTINCT lot_id FROM receipts WHERE declaration_id = $1 AND lot_id IS NOT NULL`, [declId])).rows.map((r) => r.lot_id);
      else startLots = (await c.query(`SELECT DISTINCT r.lot_id FROM receipts r JOIN purchase_declarations d ON d.id = r.declaration_id WHERE d.producer_id = $1 AND r.lot_id IS NOT NULL`, [producer])).rows.map((r) => r.lot_id);
      if (!startLots.length) return { lots: [], shipments: [], orders: [], invoices: [], buyers: [], notes: [...notes, 'Aucun lot reçu enregistré pour ce critère.'] };
      const lots = (await c.query(
        `WITH RECURSIVE down AS (
           SELECT id AS lot_id, 0 AS depth FROM lots WHERE id = ANY($1)
           UNION
           SELECT r.child_lot_id, down.depth + 1 FROM lot_relationships r JOIN down ON r.parent_lot_id = down.lot_id WHERE down.depth < 20)
         SELECT l.id, l.code, l.kind, l.status, min(down.depth) AS depth FROM down JOIN lots l ON l.id = down.lot_id GROUP BY l.id ORDER BY min(down.depth), l.code`, [startLots])).rows;
      const ids = lots.map((l: any) => l.id);
      const shipments = (await c.query(
        `SELECT DISTINCT s.id, s.reference, s.status, s.destination, s.departed_at, s.arrived_at, s.order_id, i.lot_id, i.loaded_kg, i.delivered_kg
           FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id WHERE i.lot_id = ANY($1) AND s.status <> 'cancelled' ORDER BY s.departed_at NULLS LAST`, [ids])).rows;
      const orders = (await c.query(
        `SELECT DISTINCT o.id, o.number, o.status, o.buyer_id FROM sales_orders o WHERE o.id = ANY($1) OR o.id IN (SELECT order_id FROM order_allocations WHERE lot_id = ANY($2) AND NOT released)`,
        [shipments.map((s: any) => s.order_id).filter(Boolean), ids])).rows;
      const invoices = (await c.query(
        `SELECT DISTINCT i.id, i.number, i.status, i.total, i.currency, i.buyer_id, l.lot_id FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE l.lot_id = ANY($1) AND i.status <> 'cancelled'`, [ids])).rows;
      const buyers = (await c.query(`SELECT id, code, name, country FROM buyers WHERE id = ANY($1)`, [[...orders.map((o: any) => o.buyer_id), ...invoices.map((i: any) => i.buyer_id)]])).rows;
      if (!shipments.length) notes.push('Aucune expédition enregistrée pour ces lots : les produits sont encore en stock ou la vente n\'est pas saisie.');
      return { start_lots: startLots, lots, shipments, orders, invoices, buyers, notes };
    });
  }
}
