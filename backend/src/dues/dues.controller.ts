import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec, isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';
import { postFinancialTx } from '../finance/finance.helpers';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['supplier_invoice', 'borrowing', 'service', 'other_sale', 'tax'] as const;
const DIRECTION: Record<string, 'payable' | 'receivable'> = { supplier_invoice: 'payable', borrowing: 'payable', tax: 'payable', service: 'receivable', other_sale: 'receivable' };
const cents = (v: string) => { const [i, f = ''] = v.split('.'); return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2)); };
const money = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
const round = (n: number) => Math.round(n * 100) / 100;

class PartnerDto {
  @IsIn(['supplier', 'partner', 'client', 'lender']) kind: string;
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsString() @Length(0, 30) phone?: string;
  @IsOptional() @IsString() @Length(0, 120) email?: string;
  @IsOptional() @IsString() @Length(0, 200) address?: string;
  @IsOptional() @IsString() @Length(0, 40) tax_id?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
class DueDto {
  @IsIn(KINDS as unknown as string[]) kind: string;
  @IsOptional() @IsUUID() partner_id?: string;
  @IsOptional() @IsString() @Length(1, 40) ref_no?: string;
  @IsString() @Length(1, 200) label: string;
  @Matches(DAY) due_date: string;
  @IsOptional() @Matches(DAY) issued_on?: string;
  @IsOptional() @Dec(3) quantity?: string;
  @IsOptional() @Dec(2) unit_price?: string;
  @IsOptional() @Dec(2) amount?: string;
  @IsOptional() @Dec(2) principal?: string;
  @IsOptional() @Dec(3) rate_pct?: string;
  @IsOptional() @Matches(/^\d{1,3}$/) term_months?: string;
  @IsOptional() @IsString() @Length(1, 40) tax_type?: string;
  @IsOptional() @IsString() @Length(1, 20) period?: string;
  /** Emprunt : compte qui reçoit les fonds (facultatif). */
  @IsOptional() @IsUUID() account_id?: string;
  @IsString() @Length(8, 100) idempotency_key: string;
}
class PayDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(2) amount: string;
  @IsUUID() account_id: string;
  @IsOptional() @Matches(DAY) paid_on?: string;
}

@ApiTags('partenaires et échéances')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class DuesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}
  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  // ---- Partenaires, fournisseurs, clients, prêteurs ----
  @Get('partners')
  @RequirePermissions('partners:read')
  partners(@Req() req: any, @Query('kind') kind?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, kind, name, phone, email, address, tax_id, notes, active FROM partners WHERE ($1::text IS NULL OR kind = $1) ORDER BY name`, [kind ?? null])).rows);
  }

  @Post('partners')
  @RequirePermissions('partners:manage')
  async createPartner(@Body() b: PartnerDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => (await c.query(
        `INSERT INTO partners(organization_id, kind, name, phone, email, address, tax_id, notes, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.org.id, b.kind, b.name.trim(), b.phone || null, b.email || null, b.address || null, b.tax_id || null, b.notes || null, b.active ?? true, req.user.id])).rows[0]);
      await this.log(req, 'partner.create', 'partner', row.id, { kind: row.kind, name: row.name });
      return row;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Ce nom existe déjà dans cette rubrique'); throw e; }
  }

  @Put('partners/:id')
  @RequirePermissions('partners:manage')
  async updatePartner(@Param('id', ParseUUIDPipe) id: string, @Body() b: PartnerDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => (await c.query(
        `UPDATE partners SET kind = $2, name = $3, phone = $4, email = $5, address = $6, tax_id = $7, notes = $8, active = coalesce($9, active), updated_at = now(), updated_by = $10 WHERE id = $1 RETURNING *`,
        [id, b.kind, b.name.trim(), b.phone || null, b.email || null, b.address || null, b.tax_id || null, b.notes || null, b.active ?? null, req.user.id])).rows[0]);
      if (!row) throw new NotFoundException();
      await this.log(req, 'partner.update', 'partner', id, { name: row.name, active: row.active });
      return row;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Ce nom existe déjà dans cette rubrique'); throw e; }
  }

  @Delete('partners/:id')
  @RequirePermissions('partners:manage')
  async deletePartner(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      if ((await c.query(`SELECT 1 FROM dues WHERE partner_id = $1 LIMIT 1`, [id])).rowCount) throw new ConflictException('Ce tiers a des échéances : désactivez-le plutôt');
      if (!(await c.query(`DELETE FROM partners WHERE id = $1`, [id])).rowCount) throw new NotFoundException();
    });
    await this.log(req, 'partner.delete', 'partner', id);
    return { id };
  }

  // ---- Échéances ----
  @Get('dues')
  @RequirePermissions('dues:read')
  async list(@Req() req: any, @Query('kind') kind?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('state') state?: string) {
    if (kind && !(KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Rubrique inconnue');
    const d = (v?: string) => (v && DAY.test(v) ? v : null);
    return this.db.tx(req.org.id, async (c) => {
      const rows = (await c.query(
        `SELECT * FROM (SELECT d.id, d.kind, d.direction, d.partner_id, p.name AS partner_name, d.ref_no, d.label, d.issued_on, d.due_date, d.quantity, d.unit_price, d.principal, d.rate_pct, d.term_months,
                d.tax_type, d.period, d.amount, d.status, d.created_at, coalesce((SELECT sum(amount) FROM due_payments WHERE due_id = d.id), 0) AS paid
           FROM dues d LEFT JOIN partners p ON p.id = d.partner_id
          WHERE d.status = 'open' AND ($1::text IS NULL OR d.kind = $1) AND ($2::date IS NULL OR d.issued_on >= $2) AND ($3::date IS NULL OR d.issued_on <= $3)) x
         WHERE ($4::text IS NULL OR $4 = 'all' OR ($4 = 'open' AND paid < amount) OR ($4 = 'settled' AND paid >= amount))
         ORDER BY due_date DESC, label LIMIT 500`, [kind ?? null, d(from), d(to), state ?? null])).rows;
      let amount = 0n, paid = 0n;
      for (const r of rows) { r.remaining = money(cents(r.amount) - cents(r.paid)); amount += cents(r.amount); paid += cents(r.paid); }
      return { rows, totals: { amount: money(amount), paid: money(paid), remaining: money(amount - paid) } };
    });
  }

  @Post('dues')
  @RequirePermissions('dues:manage')
  async create(@Body() b: DueDto, @Req() req: any) {
    let amount: string, principal: string | null = null, rate: string | null = null, term: number | null = null;
    if (b.kind === 'borrowing') {
      if (!b.principal || b.rate_pct === undefined || !b.term_months) throw new BadRequestException('Emprunt : capital, taux et durée (mois) obligatoires');
      principal = b.principal; rate = b.rate_pct; term = Number(b.term_months);
      amount = round(Number(b.principal) * (1 + (Number(b.rate_pct) / 100) * (term / 12))).toFixed(2);
    } else if (b.amount) amount = b.amount;
    else if (b.quantity && b.unit_price) amount = round(Number(b.quantity) * Number(b.unit_price)).toFixed(2);
    else throw new BadRequestException('Indiquez le montant, ou la quantité et le prix unitaire');
    if (Number(amount) <= 0) throw new BadRequestException('Le montant doit être supérieur à zéro');
    if (b.kind === 'tax' && !b.tax_type) throw new BadRequestException("Précisez la nature de l'impôt (BIC, TVA, patente…)");
    const row = await this.db.tx(req.org.id, async (c) => {
      const prev = (await c.query(`SELECT * FROM dues WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prev) return { ...prev, replay: true };
      if (b.partner_id && !(await c.query(`SELECT 1 FROM partners WHERE id = $1 AND active`, [b.partner_id])).rowCount) throw new BadRequestException('Tiers inconnu ou inactif');
      const ins = (await c.query(
        `INSERT INTO dues(organization_id, kind, direction, partner_id, ref_no, label, due_date, issued_on, quantity, unit_price, principal, rate_pct, term_months, tax_type, period, amount, created_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8, current_date),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [req.org.id, b.kind, DIRECTION[b.kind], b.partner_id ?? null, b.ref_no ?? null, b.label.trim(), b.due_date, b.issued_on ?? null, b.quantity ?? null, b.unit_price ?? null,
         principal, rate, term, b.tax_type ?? null, b.period ?? null, amount, req.user.id, b.idempotency_key])).rows[0];
      if (b.kind === 'borrowing' && b.account_id) {
        const { tx } = await postFinancialTx(c, { orgId: req.org.id, userId: req.user.id, accountId: b.account_id, direction: 'in', amount: principal!, reason: `Emprunt : ${b.label.trim()}`,
          idempotencyKey: `borrowing-in:${ins.id}`, referenceType: 'due', referenceId: ins.id });
        ins.funds_tx_id = tx.id;
      }
      return { ...ins, replay: false };
    });
    if (!row.replay) await this.log(req, 'due.create', 'due', row.id, { kind: row.kind, amount: row.amount });
    return row;
  }

  @Delete('dues/:id')
  @RequirePermissions('dues:manage')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      if ((await c.query(`SELECT 1 FROM due_payments WHERE due_id = $1 LIMIT 1`, [id])).rowCount) throw new ConflictException('Un règlement existe déjà : impossible d\'annuler cette échéance');
      if ((await c.query(`SELECT 1 FROM financial_transactions WHERE reference_type = 'due' AND reference_id = $1 LIMIT 1`, [id])).rowCount) throw new ConflictException('Les fonds de cet emprunt sont déjà en compte : impossible de l\'annuler');
      if (!(await c.query(`UPDATE dues SET status = 'cancelled' WHERE id = $1 AND status = 'open'`, [id])).rowCount) throw new NotFoundException();
    });
    await this.log(req, 'due.cancel', 'due', id);
    return { id };
  }

  /** Règlement (échéance à payer) ou encaissement (à recevoir) : une opération financière est passée sur le compte choisi. */
  @Post('dues/:id/payments')
  @RequirePermissions('dues:settle', 'finance:read')
  async pay(@Param('id', ParseUUIDPipe) id: string, @Body() b: PayDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = (await c.query(`SELECT * FROM due_payments WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prev) return { ...prev, replay: true };
      const d = (await c.query(`SELECT * FROM dues WHERE id = $1 AND status = 'open' FOR UPDATE`, [id])).rows[0];
      if (!d) throw new NotFoundException('Échéance introuvable');
      const paid = (await c.query(`SELECT coalesce(sum(amount),0) AS s FROM due_payments WHERE due_id = $1`, [id])).rows[0].s;
      const rest = cents(d.amount) - cents(paid);
      if (cents(b.amount) <= 0n) throw new BadRequestException('Le montant doit être supérieur à zéro');
      if (cents(b.amount) > rest) throw new BadRequestException(`Le montant dépasse le reste à ${d.direction === 'payable' ? 'payer' : 'encaisser'} (${money(rest)})`);
      const { tx } = await postFinancialTx(c, { orgId: req.org.id, userId: req.user.id, accountId: b.account_id, direction: d.direction === 'payable' ? 'out' : 'in', amount: b.amount,
        reason: `${d.direction === 'payable' ? 'Règlement' : 'Encaissement'} : ${d.label}`, idempotencyKey: `due:${b.idempotency_key}`, referenceType: 'due_payment', referenceId: id });
      const p = (await c.query(`INSERT INTO due_payments(organization_id, due_id, tx_id, amount, paid_on, idempotency_key, created_by) VALUES ($1,$2,$3,$4,coalesce($5, current_date),$6,$7) RETURNING *`,
        [req.org.id, id, tx.id, b.amount, b.paid_on ?? null, b.idempotency_key, req.user.id])).rows[0];
      return { ...p, remaining: money(rest - cents(b.amount)), replay: false };
    });
    if (!out.replay) await this.log(req, 'due.payment', 'due', id, { amount: out.amount });
    return out;
  }

  /** Estimation du BIC d'un exercice : produits (prestations, ventes d'autres produits, ventes de la filière) − charges (fournisseurs, intérêts d'emprunt) ; taux saisi par l'utilisateur. */
  @Get('dues/bic-estimate')
  @RequirePermissions('dues:read')
  async bic(@Req() req: any, @Query('year') year?: string, @Query('rate') rate?: string) {
    const y = Number(year) || new Date().getFullYear();
    const r = rate === undefined || rate === '' ? 25 : Number(rate);
    if (!(r >= 0 && r <= 100)) throw new BadRequestException('Taux invalide');
    return this.db.tx(req.org.id, async (c) => {
      const q = async (sql: string) => (await c.query(sql, [y])).rows[0].s as string;
      const services = await q(`SELECT coalesce(sum(amount),0) AS s FROM dues WHERE status='open' AND kind='service' AND extract(year FROM issued_on) = $1`);
      const other = await q(`SELECT coalesce(sum(amount),0) AS s FROM dues WHERE status='open' AND kind='other_sale' AND extract(year FROM issued_on) = $1`);
      const supplier = await q(`SELECT coalesce(sum(amount),0) AS s FROM dues WHERE status='open' AND kind='supplier_invoice' AND extract(year FROM issued_on) = $1`);
      const interest = await q(`SELECT coalesce(sum(amount - principal),0) AS s FROM dues WHERE status='open' AND kind='borrowing' AND extract(year FROM issued_on) = $1`);
      const produits = cents(services) + cents(other), charges = cents(supplier) + cents(interest);
      const result = produits - charges;
      const due = result > 0n ? (result * BigInt(Math.round(r * 100))) / 10000n : 0n;
      return { year: y, rate_pct: r, produits: money(produits), services, other_sales: other, charges: money(charges), supplier_invoices: supplier, interest, resultat: money(result), bic_estime: money(due),
        note: 'Estimation limitée aux opérations saisies dans ces rubriques ; à valider avec l\'expert-comptable.' };
    });
  }
}
