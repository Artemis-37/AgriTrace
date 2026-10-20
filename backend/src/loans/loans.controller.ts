import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { accountingCodeOf, postEntry, reverseEntry, today } from '../accounting/accounting.helpers';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { postFinancialTx, reverseFinancialTx } from '../finance/finance.helpers';

class LoanDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(['prefinancing', 'advance', 'loan']) kind: string;
  @IsIn(['producer', 'collector']) borrower_type: string;
  @IsUUID() borrower_id: string;
  @Dec(4) amount: string;
  @IsString() @Length(3, 300) purpose: string;
}
class CommentDto { @IsOptional() @IsString() @Length(1, 500) comment?: string; }
class InstallmentDto { @Matches(/^\d{4}-\d{2}-\d{2}$/) due_date: string; @Dec(4) amount: string; }
class ApproveDto {
  @IsOptional() @Dec(4) approved_amount?: string;
  @IsOptional() @IsString() @Length(1, 500) comment?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InstallmentDto) installments: InstallmentDto[];
}
class DisburseDto { @IsUUID() source_account_id: string; }
class RepayDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(4) amount: string;
  @IsUUID() account_id: string;
}
class ReverseDto { @IsString() @Length(3, 300) reason: string; }

const units = (s: string) => { const [i, f = ''] = s.split('.'); return BigInt(i) * 10000n + BigInt((f + '0000').slice(0, 4)); };
const fmt = (u: bigint) => `${u / 10000n}.${String(u % 10000n).padStart(4, '0')}`;

/** Compte comptable de créance selon la nature du dossier : avances/préfinancements 409, prêts 271. */
const receivableCode = (kind: string) => (kind === 'loan' ? '271' : '409');

@ApiTags('prêts et préfinancements')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class LoansController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'loan', entityId: id, details });
  }

  private async lock(c: PoolClient, id: string) {
    const r = await c.query(`SELECT * FROM loans WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0];
  }
  private decide(c: PoolClient, orgId: string, loanId: string, decision: string, userId: string, comment?: string) {
    return c.query(`INSERT INTO loan_decisions(organization_id, loan_id, decision, comment, decided_by) VALUES ($1,$2,$3,$4,$5)`, [orgId, loanId, decision, comment ?? null, userId]);
  }
  private async setStatus(c: PoolClient, id: string, status: string) {
    await c.query(`UPDATE loans SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
  }
  private async repaidNet(c: PoolClient, id: string): Promise<string> {
    return (await c.query(
      `SELECT coalesce(sum(CASE WHEN reversal_of IS NULL THEN amount ELSE -amount END), 0)::text AS n FROM loan_repayments WHERE loan_id = $1`, [id])).rows[0].n;
  }

  @Post('loans')
  @RequirePermissions('loans:request')
  async create(@Body() b: LoanDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM loans WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) {
        const p = prev.rows[0];
        const eq = (await c.query(`SELECT $1::numeric = $2::numeric AS eq`, [p.requested_amount, b.amount])).rows[0].eq;
        if (p.borrower_id !== b.borrower_id || p.kind !== b.kind || !eq) throw new ConflictException("Cette clé d'idempotence a déjà servi pour une autre demande");
        return { row: p, replay: true };
      }
      const table = b.borrower_type === 'producer' ? 'producers' : 'collectors';
      if (!(await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [b.borrower_id])).rowCount) throw new BadRequestException('Emprunteur inconnu dans cette coopérative');
      const row = (await c.query(
        `INSERT INTO loans(organization_id, kind, borrower_type, borrower_id, requested_amount, purpose, idempotency_key, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.org.id, b.kind, b.borrower_type, b.borrower_id, b.amount, b.purpose, b.idempotency_key, req.user.id])).rows[0];
      await this.decide(c, req.org.id, row.id, 'request', req.user.id, b.purpose);
      return { row, replay: false };
    });
    if (!out.replay) await this.log(req, 'loan.request', out.row.id, { amount: b.amount, kind: b.kind });
    return { ...out.row, replayed: out.replay };
  }

  @Post('loans/:id/analyze')
  @RequirePermissions('loans:request')
  async analyze(@Param('id', ParseUUIDPipe) id: string, @Body() b: CommentDto, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const l = await this.lock(c, id);
      if (l.status !== 'requested') throw new BadRequestException(`Statut ${l.status} : analyse impossible`);
      await this.setStatus(c, id, 'in_analysis');
      await this.decide(c, req.org.id, id, 'analysis', req.user.id, b.comment);
    });
    await this.log(req, 'loan.analyze', id);
    return { id, status: 'in_analysis' };
  }

  /** Approbation : par un utilisateur distinct du demandeur ; l'échéancier doit totaliser exactement le montant approuvé. */
  @Post('loans/:id/approve')
  @RequirePermissions('loans:approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ApproveDto, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const l = await this.lock(c, id);
      if (!['requested', 'in_analysis'].includes(l.status)) throw new BadRequestException(`Statut ${l.status} : approbation impossible`);
      if (l.requested_by === req.user.id) throw new ForbiddenException("L'approbation doit être faite par un autre utilisateur que le demandeur");
      const amount = b.approved_amount ?? (await c.query(`SELECT requested_amount::text AS a FROM loans WHERE id = $1`, [id])).rows[0].a;
      if (units(amount) > units((await c.query(`SELECT requested_amount::text AS a FROM loans WHERE id = $1`, [id])).rows[0].a))
        throw new BadRequestException('Le montant approuvé ne peut pas dépasser le montant demandé');
      if (units(amount) <= 0n) throw new BadRequestException('Montant approuvé invalide');
      let total = 0n, prev = '';
      for (const i of b.installments) {
        if (i.due_date <= today()) throw new BadRequestException("Les échéances doivent être futures");
        if (prev && i.due_date <= prev) throw new BadRequestException('Les échéances doivent être strictement croissantes');
        if (units(i.amount) <= 0n) throw new BadRequestException("Montant d'échéance invalide");
        prev = i.due_date; total += units(i.amount);
      }
      if (total !== units(amount)) throw new UnprocessableEntityException(`L'échéancier (${fmt(total)}) doit totaliser le montant approuvé (${fmt(units(amount))})`);
      let seq = 1;
      for (const i of b.installments)
        await c.query(`INSERT INTO loan_installments(organization_id, loan_id, seq, due_date, amount) VALUES ($1,$2,$3,$4,$5)`, [req.org.id, id, seq++, i.due_date, i.amount]);
      await c.query(`UPDATE loans SET status = 'approved', approved_amount = $2, updated_at = now() WHERE id = $1`, [id, amount]);
      await this.decide(c, req.org.id, id, 'approve', req.user.id, b.comment);
    });
    await this.log(req, 'loan.approve', id);
    return { id, status: 'approved' };
  }

  @Post('loans/:id/reject')
  @RequirePermissions('loans:approve')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReverseDto & CommentDto, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const l = await this.lock(c, id);
      if (!['requested', 'in_analysis'].includes(l.status)) throw new BadRequestException(`Statut ${l.status} : rejet impossible`);
      await this.setStatus(c, id, 'rejected');
      await this.decide(c, req.org.id, id, 'reject', req.user.id, b.comment ?? (b as any).reason);
    });
    await this.log(req, 'loan.reject', id);
    return { id, status: 'rejected' };
  }

  @Post('loans/:id/cancel')
  @RequirePermissions('loans:request')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: CommentDto, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const l = await this.lock(c, id);
      if (!['requested', 'in_analysis', 'approved'].includes(l.status)) throw new BadRequestException(`Statut ${l.status} : annulation impossible (déjà décaissé ou clos)`);
      await this.setStatus(c, id, 'cancelled');
      await this.decide(c, req.org.id, id, 'cancel', req.user.id, b.comment);
    });
    await this.log(req, 'loan.cancel', id);
    return { id, status: 'cancelled' };
  }

  /** Décaissement : sortie du compte source + écriture (débit créance 409/271, crédit caisse/banque). */
  @Post('loans/:id/disburse')
  @RequirePermissions('loans:disburse')
  async disburse(@Param('id', ParseUUIDPipe) id: string, @Body() b: DisburseDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const l = await this.lock(c, id);
      if (l.status !== 'approved') throw new BadRequestException(`Statut ${l.status} : décaissement impossible`);
      const { tx, account } = await postFinancialTx(c, {
        orgId: req.org.id, userId: req.user.id, accountId: b.source_account_id, direction: 'out', amount: l.approved_amount,
        reason: `Décaissement ${l.kind} ${id.slice(0, 8)}`, idempotencyKey: `loan-disbursement:${id}`, referenceType: 'loan', referenceId: id,
      });
      const entry = await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: account.owner_type === 'cash_register' ? 'CAI' : 'BQ', date: today(),
        label: `Décaissement ${l.kind} (dossier ${id.slice(0, 8)})`,
        lines: [{ code: receivableCode(l.kind), debit: l.approved_amount }, { code: accountingCodeOf(account), credit: l.approved_amount }],
        idempotencyKey: `loan-disbursement-entry:${id}`, referenceType: 'loan', referenceId: id,
      });
      await c.query(`UPDATE loans SET status = 'disbursed', source_account_id = $2, disbursement_tx_id = $3, disbursement_entry_id = $4, updated_at = now() WHERE id = $1`,
        [id, b.source_account_id, tx.id, entry.id]);
      await this.decide(c, req.org.id, id, 'disburse', req.user.id);
      return { id, status: 'disbursed', transaction_id: tx.id, entry_number: entry.number };
    });
    await this.log(req, 'loan.disburse', id, { transaction_id: out.transaction_id });
    return out;
  }

  /** Remboursement encaissé sur un compte (caisse ou banque) : plafonné au solde restant dû. */
  @Post('loans/:id/repayments')
  @RequirePermissions('loans:repay')
  async repay(@Param('id', ParseUUIDPipe) id: string, @Body() b: RepayDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT id, loan_id, amount FROM loan_repayments WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) {
        const eq = (await c.query(`SELECT $1::numeric = $2::numeric AS eq`, [prev.rows[0].amount, b.amount])).rows[0].eq;
        if (prev.rows[0].loan_id !== id || !eq) throw new ConflictException("Cette clé d'idempotence a déjà servi pour un autre remboursement");
        return { id: prev.rows[0].id, replay: true };
      }
      const l = await this.lock(c, id);
      if (l.status !== 'disbursed') throw new BadRequestException(`Statut ${l.status} : remboursement impossible`);
      const remaining = units(l.approved_amount.toString()) - units(await this.repaidNet(c, id));
      if (units(b.amount) > remaining) throw new UnprocessableEntityException(`Le remboursement dépasse le solde restant dû (${fmt(remaining)})`);
      const { tx, account } = await postFinancialTx(c, {
        orgId: req.org.id, userId: req.user.id, accountId: b.account_id, direction: 'in', amount: b.amount,
        reason: `Remboursement ${l.kind} ${id.slice(0, 8)}`, idempotencyKey: `loan-repayment:${b.idempotency_key}`, referenceType: 'loan', referenceId: id,
      });
      const entry = await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: account.owner_type === 'cash_register' ? 'CAI' : 'BQ', date: today(),
        label: `Remboursement ${l.kind} (dossier ${id.slice(0, 8)})`,
        lines: [{ code: accountingCodeOf(account), debit: b.amount }, { code: receivableCode(l.kind), credit: b.amount }],
        idempotencyKey: `loan-repayment-entry:${b.idempotency_key}`, referenceType: 'loan', referenceId: id,
      });
      const rep = (await c.query(
        `INSERT INTO loan_repayments(organization_id, loan_id, idempotency_key, amount, tx_id, entry_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [req.org.id, id, b.idempotency_key, b.amount, tx.id, entry.id, req.user.id])).rows[0];
      const left = remaining - units(b.amount);
      if (left === 0n) await this.setStatus(c, id, 'repaid');
      return { id: rep.id, replay: false, remaining: fmt(left), status: left === 0n ? 'repaid' : 'disbursed' };
    });
    if (!out.replay) await this.log(req, 'loan.repay', id, { amount: b.amount });
    return { ...out, replayed: out.replay };
  }

  /** Correction d'un remboursement erroné : opération et écriture inverses, solde rétabli. */
  @Post('loan-repayments/:id/reverse')
  @RequirePermissions('finance:reverse')
  async reverseRepayment(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReverseDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT * FROM loan_repayments WHERE id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.reversal_of) throw new BadRequestException("Une annulation ne peut pas être annulée");
      const l = await this.lock(c, r.loan_id);
      try {
        await reverseFinancialTx(c, req.org.id, req.user.id, r.tx_id, b.reason);
        const e = await reverseEntry(c, req.org.id, req.user.id, r.entry_id, `Annulation remboursement : ${b.reason}`, today());
        await c.query(
          `INSERT INTO loan_repayments(organization_id, loan_id, idempotency_key, amount, reversal_of, tx_id, entry_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.org.id, r.loan_id, `repayment-reversal:${id}`, r.amount, id, r.tx_id, e.id, req.user.id]);
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('Ce remboursement a déjà été annulé');
        throw e;
      }
      if (l.status === 'repaid') await this.setStatus(c, r.loan_id, 'disbursed');
      return { loan_id: r.loan_id };
    });
    await this.log(req, 'loan.repayment.reverse', out.loan_id, { repayment: id, reason: b.reason });
    return { reversed: id };
  }

  @Get('loans')
  @RequirePermissions('loans:read')
  list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT l.id, l.kind, l.borrower_type, l.borrower_id, l.requested_amount, l.approved_amount, l.currency, l.status, l.requested_at,
              l.approved_amount - coalesce((SELECT sum(CASE WHEN r.reversal_of IS NULL THEN r.amount ELSE -r.amount END) FROM loan_repayments r WHERE r.loan_id = l.id), 0) AS remaining
         FROM loans l ORDER BY l.requested_at DESC LIMIT 500`)).rows);
  }

  @Get('loans/:id')
  @RequirePermissions('loans:read')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const loan = (await c.query(`SELECT * FROM loans WHERE id = $1`, [id])).rows[0];
      if (!loan) throw new NotFoundException();
      const decisions = (await c.query(`SELECT decision, comment, decided_by, decided_at FROM loan_decisions WHERE loan_id = $1 ORDER BY decided_at, id`, [id])).rows;
      const inst = (await c.query(`SELECT seq, due_date::text AS due_date, amount::text AS amount FROM loan_installments WHERE loan_id = $1 ORDER BY seq`, [id])).rows;
      const reps = (await c.query(`SELECT id, amount, reversal_of, created_at FROM loan_repayments WHERE loan_id = $1 ORDER BY created_at, id`, [id])).rows;
      let pool = units(await this.repaidNet(c, id));
      const t = today();
      const installments = inst.map((i: any) => {
        const due = units(i.amount); const paid = pool >= due ? due : pool; pool -= paid;
        const status = paid === due ? 'paid' : i.due_date < t ? 'overdue' : paid > 0n ? 'partial' : 'upcoming';
        return { seq: i.seq, due_date: i.due_date, amount: i.amount, paid: fmt(paid), status };
      });
      const remaining = loan.approved_amount ? fmt(units(loan.approved_amount.toString()) - units(await this.repaidNet(c, id))) : null;
      return { ...loan, remaining, decisions, installments, repayments: reps,
        notice: "Intérêts et pénalités : non calculés (à définir dans une spécification complémentaire)." };
    });
  }
}
