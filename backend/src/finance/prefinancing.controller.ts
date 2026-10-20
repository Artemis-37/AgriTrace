import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, UnprocessableEntityException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { nextNumber, pad } from '../stock/stock.helpers';
import { accountingCodeOf, postEntry } from '../accounting/accounting.helpers';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
class PrefinDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsString() @Length(2, 200) funder: string;
  @Dec(2) amount: string;
  @Matches(/^[A-Z]{3}$/) currency: string;
  /** Compte financier (banque ou caisse) qui reçoit les fonds. */
  @IsUUID() account_id: string;
  @Matches(DATE) received_on: string;
  @IsOptional() @IsString() @Length(1, 2000) conditions?: string;
  @IsOptional() @IsUUID() campaign_id?: string;
  @IsOptional() @IsUUID() value_chain_id?: string;
  @IsOptional() @Matches(DATE) due_date?: string;
}
class UseDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(['purchase', 'expense', 'advance', 'other']) kind: string;
  @Dec(2) amount: string;
  @Matches(DATE) used_on: string;
  @IsString() @Length(3, 300) purpose: string;
  @IsOptional() @IsUUID() declaration_id?: string;
  @IsOptional() @IsString() @Length(1, 100) document_ref?: string;
}
class RepayDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(2) amount: string;
  @Matches(DATE) paid_on: string;
  @IsOptional() @IsString() @Length(1, 100) reference?: string;
}

/** Préfinancement reçu par la coopérative : fonds, conditions, utilisation, justificatifs, remboursements, soldes (CDC §20.3). */
@ApiTags('préfinancement')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('prefinancings')
export class PrefinancingController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}
  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'prefinancing', entityId: id, details });
  }
  private static SUMMARY = `SELECT p.*, coalesce((SELECT sum(amount) FROM prefinancing_uses u WHERE u.prefinancing_id = p.id),0)::numeric(18,2) AS used,
      (p.amount - coalesce((SELECT sum(amount) FROM prefinancing_uses u WHERE u.prefinancing_id = p.id),0))::numeric(18,2) AS available,
      coalesce((SELECT sum(amount) FROM prefinancing_repayments r WHERE r.prefinancing_id = p.id),0)::numeric(18,2) AS repaid,
      (p.amount - coalesce((SELECT sum(amount) FROM prefinancing_repayments r WHERE r.prefinancing_id = p.id),0))::numeric(18,2) AS outstanding,
      coalesce((SELECT sum(amount) FROM prefinancing_uses u WHERE u.prefinancing_id = p.id AND u.kind = 'purchase'),0)::numeric(18,2) AS purchases_financed,
      (p.status = 'active' AND p.due_date < current_date) AS overdue,
      (SELECT name FROM financial_accounts fa WHERE fa.id = p.account_id) AS account_name
    FROM prefinancings p`;
  private async lock(c: PoolClient, id: string) {
    const p = (await c.query(`SELECT * FROM prefinancings WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!p) throw new NotFoundException();
    return p;
  }

  /** Compte financier (banque/caisse) du préfinancement, verrouillé ; devise identique. */
  private async fundAccount(c: PoolClient, id: string, currency: string) {
    const a = (await c.query(`SELECT * FROM financial_accounts WHERE id = $1 AND status = 'active' FOR UPDATE`, [id])).rows[0];
    if (!a || !['cash_register', 'other'].includes(a.owner_type)) throw new BadRequestException('Compte financier inconnu (banque ou caisse requis)');
    if (a.currency !== currency) throw new BadRequestException(`Devise du compte (${a.currency}) différente de celle du préfinancement (${currency})`);
    return a;
  }
  /** Mouvement sur le compte + écriture comptable équilibrée (journal BQ pour une banque, CAI pour une caisse). */
  private async book(c: PoolClient, req: any, acc: any, dir: 'in' | 'out', amount: string, date: string, label: string, key: string, refId: string,
                     other: { code: string; label?: string }) {
    if (dir === 'out') {
      const bal = (await c.query(`SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END),0) AS b FROM financial_transactions WHERE account_id = $1`, [acc.id])).rows[0].b;
      if (Number(amount) > Number(bal)) throw new UnprocessableEntityException(`Solde du compte insuffisant (${Number(bal)})`);
    }
    const tx = (await c.query(
      `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'prefinancing',$8,$9) RETURNING id`,
      [req.org.id, `pf-tx:${key}`, acc.id, dir, amount, acc.currency, label, refId, req.user.id])).rows[0];
    await c.query(`SELECT accounting_seed($1::uuid)`, [req.org.id]);
    await c.query(`INSERT INTO accounting_accounts(organization_id, code, label) VALUES ($1,'168','Préfinancements reçus (dettes)') ON CONFLICT DO NOTHING`, [req.org.id]);
    const cash = { code: accountingCodeOf(acc) };
    const entry = await postEntry(c, {
      orgId: req.org.id, userId: req.user.id, journal: acc.owner_type === 'cash_register' ? 'CAI' : 'BQ', date, label,
      lines: dir === 'in' ? [{ code: cash.code, debit: amount }, { code: other.code, credit: amount, label: other.label }]
                          : [{ code: other.code, debit: amount, label: other.label }, { code: cash.code, credit: amount }],
      idempotencyKey: `pf-entry:${key}`, referenceType: 'prefinancing', referenceId: refId,
    });
    return { tx_id: tx.id, entry_number: entry.number };
  }

  @Post()
  @RequirePermissions('prefinancing:manage')
  async create(@Body() b: PrefinDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM prefinancings WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      if (b.due_date && b.due_date < b.received_on) throw new BadRequestException('Échéance antérieure à la date de réception');
      for (const [tbl, id, label] of [['campaigns', b.campaign_id, 'Campagne'], ['value_chains', b.value_chain_id, 'Filière']] as const)
        if (id && !(await c.query(`SELECT 1 FROM ${tbl} WHERE id = $1`, [id])).rowCount) throw new BadRequestException(`${label} inconnue`);
      const n = await nextNumber(c, req.org.id, 'prefinancing');
      const r = (await c.query(
        `INSERT INTO prefinancings(organization_id, idempotency_key, number, funder, amount, currency, received_on, conditions, campaign_id, value_chain_id, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, b.idempotency_key, `PF-${new Date().getUTCFullYear()}-${pad(n, 4)}`, b.funder, b.amount, b.currency, b.received_on, b.conditions ?? null, b.campaign_id ?? null, b.value_chain_id ?? null, b.due_date ?? null, req.user.id])).rows[0];
      const acc = await this.fundAccount(c, b.account_id, b.currency);
      const bk = await this.book(c, req, acc, 'in', b.amount, b.received_on, `Préfinancement ${r.number} reçu de ${b.funder}`, `create:${r.id}`, r.id, { code: '168', label: b.funder });
      const upd = (await c.query(`UPDATE prefinancings SET account_id = $2, receipt_tx_id = $3, receipt_entry_number = $4 WHERE id = $1 RETURNING *`, [r.id, acc.id, bk.tx_id, bk.entry_number])).rows[0];
      await this.log(req, 'prefinancing.create', r.id, { number: r.number, amount: b.amount, account_id: acc.id, entry: bk.entry_number });
      return upd;
    });
  }

  @Get()
  @RequirePermissions('prefinancing:read')
  list(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`${PrefinancingController.SUMMARY} ORDER BY p.received_on DESC LIMIT 200`)).rows); }

  /** Rapport de suivi : totaux, solde disponible, reste à rembourser, retards. */
  @Get('report')
  @RequirePermissions('prefinancing:read')
  async report(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const rows = (await c.query(`${PrefinancingController.SUMMARY} WHERE p.status <> 'cancelled'`)).rows;
      const sum = (k: string, cur: string) => rows.filter((r) => r.currency === cur).reduce((s, r) => s + Number(r[k]), 0).toFixed(2);
      const byCurrency = [...new Set(rows.map((r) => r.currency))].map((cur) => ({ currency: cur, received: sum('amount', cur), used: sum('used', cur), available: sum('available', cur),
        repaid: sum('repaid', cur), outstanding: sum('outstanding', cur), purchases_financed: sum('purchases_financed', cur) }));
      return { by_currency: byCurrency, overdue: rows.filter((r) => r.overdue).map((r) => ({ id: r.id, number: r.number, funder: r.funder, due_date: r.due_date, outstanding: r.outstanding })) };
    });
  }

  @Get(':id')
  @RequirePermissions('prefinancing:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const p = (await c.query(`${PrefinancingController.SUMMARY} WHERE p.id = $1`, [id])).rows[0];
      if (!p) throw new NotFoundException();
      const uses = (await c.query(`SELECT * FROM prefinancing_uses WHERE prefinancing_id = $1 ORDER BY used_on, created_at`, [id])).rows;
      const repayments = (await c.query(`SELECT * FROM prefinancing_repayments WHERE prefinancing_id = $1 ORDER BY paid_on, created_at`, [id])).rows;
      return { ...p, uses, repayments };
    });
  }

  @Post(':id/uses')
  @RequirePermissions('prefinancing:manage')
  async use(@Param('id', ParseUUIDPipe) id: string, @Body() b: UseDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM prefinancing_uses WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) return prior;
      const p = await this.lock(c, id);
      if (p.status !== 'active') throw new ConflictException('Préfinancement clos ou annulé');
      if (b.kind === 'purchase' && !b.declaration_id) throw new BadRequestException('Un achat financé doit référencer sa déclaration d\'achat');
      if (b.declaration_id && !(await c.query(`SELECT 1 FROM purchase_declarations WHERE id = $1`, [b.declaration_id])).rowCount) throw new BadRequestException('Déclaration d\'achat inconnue');
      if (!b.document_ref) throw new BadRequestException('Justificatif obligatoire (référence de la pièce)');
      const used = (await c.query(`SELECT coalesce(sum(amount),0) AS u FROM prefinancing_uses WHERE prefinancing_id = $1`, [id])).rows[0].u;
      const left = (await c.query(`SELECT ($1::numeric - $2::numeric) AS l`, [p.amount, used])).rows[0].l;
      if (Number(b.amount) > Number(left)) throw new BadRequestException(`Montant supérieur aux fonds disponibles (${left})`);
      if (b.used_on > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Date d\'utilisation dans le futur');
      const uid = randomUUID();
      const counter = { purchase: '601', expense: '605', advance: '409', other: '471' }[b.kind] as string;
      let bk: { tx_id: string; entry_number: string } | null = null;
      if (p.account_id) bk = await this.book(c, req, await this.fundAccount(c, p.account_id, p.currency), 'out', b.amount, b.used_on,
        `Utilisation ${p.number} (${b.kind}) : ${b.purpose}`, `use:${b.idempotency_key}`, uid, { code: counter });
      const r = (await c.query(`INSERT INTO prefinancing_uses(id, organization_id, idempotency_key, prefinancing_id, kind, amount, used_on, purpose, declaration_id, document_ref, created_by, tx_id, entry_number)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [uid, req.org.id, b.idempotency_key, id, b.kind, b.amount, b.used_on, b.purpose, b.declaration_id ?? null, b.document_ref, req.user.id, bk?.tx_id ?? null, bk?.entry_number ?? null])).rows[0];
      await this.log(req, 'prefinancing.use', id, { amount: b.amount, kind: b.kind });
      return r;
    });
  }

  @Post(':id/repayments')
  @RequirePermissions('prefinancing:manage')
  async repay(@Param('id', ParseUUIDPipe) id: string, @Body() b: RepayDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM prefinancing_repayments WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) return prior;
      const p = await this.lock(c, id);
      if (p.status === 'cancelled') throw new ConflictException('Préfinancement annulé');
      const repaid = (await c.query(`SELECT coalesce(sum(amount),0) AS r FROM prefinancing_repayments WHERE prefinancing_id = $1`, [id])).rows[0].r;
      const out = (await c.query(`SELECT ($1::numeric - $2::numeric) AS o`, [p.amount, repaid])).rows[0].o;
      if (Number(b.amount) > Number(out)) throw new BadRequestException(`Montant supérieur au reste à rembourser (${out})`);
      if (b.paid_on > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Date de remboursement dans le futur');
      const rid = randomUUID();
      let bk: { tx_id: string; entry_number: string } | null = null;
      if (p.account_id) bk = await this.book(c, req, await this.fundAccount(c, p.account_id, p.currency), 'out', b.amount, b.paid_on,
        `Remboursement ${p.number}${b.reference ? ' — ' + b.reference : ''}`, `repay:${b.idempotency_key}`, rid, { code: '168', label: p.funder });
      const r = (await c.query(`INSERT INTO prefinancing_repayments(id, organization_id, idempotency_key, prefinancing_id, amount, paid_on, reference, created_by, tx_id, entry_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [rid, req.org.id, b.idempotency_key, id, b.amount, b.paid_on, b.reference ?? null, req.user.id, bk?.tx_id ?? null, bk?.entry_number ?? null])).rows[0];
      const rest = (await c.query(`SELECT ($1::numeric - $2::numeric - $3::numeric) AS r`, [p.amount, repaid, b.amount])).rows[0].r;
      if (Number(rest) === 0) await c.query(`UPDATE prefinancings SET status = 'repaid' WHERE id = $1`, [id]);
      await this.log(req, 'prefinancing.repayment', id, { amount: b.amount });
      return { ...r, outstanding: rest };
    });
  }
}
