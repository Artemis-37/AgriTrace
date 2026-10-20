import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { accountingCodeOf, postEntry, reverseEntry, today } from '../accounting/accounting.helpers';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { postFinancialTx, reverseFinancialTx } from '../finance/finance.helpers';

class PaymentDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() source_account_id: string;
  @IsIn(['producer', 'collector', 'other']) payee_type: string;
  @IsOptional() @IsUUID() payee_id?: string;
  @IsOptional() @IsString() @Length(2, 150) payee_label?: string;
  @Dec(4) amount: string;
  @IsIn(['cash', 'bank_transfer', 'mobile_money', 'cheque']) method: string;
  @IsOptional() @IsString() reference_type?: string;
  @IsOptional() @IsUUID() reference_id?: string;
}
class TransitionDto {
  @IsIn(['initiated', 'pending', 'failed', 'cancelled']) to: string;
  @IsOptional() @IsString() @Length(1, 300) note?: string;
  @IsOptional() @IsString() @Length(1, 100) external_ref?: string;
}
class ConfirmDto {
  @IsIn(['manual', 'provider']) confirmation_source: string;
  @IsString() @Length(5, 300) note: string;
  @IsOptional() @IsString() @Length(1, 100) external_ref?: string;
}
class RefundDto { @IsString() @Length(3, 300) reason: string; }
class ReconcileDto {
  @IsUUID() account_id: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) statement_date: string;
  @Matches(/^-?\d{1,14}(\.\d{1,4})?$/) statement_balance: string;
  @IsOptional() @IsString() @Length(10, 500) note?: string;
}

const NEXT: Record<string, string[]> = {
  planned: ['initiated', 'cancelled'],
  initiated: ['pending', 'failed', 'cancelled'],
  pending: ['failed', 'cancelled'],
};
export const MANUAL_LABEL = "Enregistrement manuel — non confirmé par la banque ou l'opérateur de paiement";

@ApiTags('paiements et rapprochements')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class PaymentsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }
  private event(c: PoolClient, orgId: string, paymentId: string, from: string | null, to: string, actor: string, note?: string) {
    return c.query(`INSERT INTO payment_events(organization_id, payment_id, from_status, to_status, note, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`, [orgId, paymentId, from, to, note ?? null, actor]);
  }
  private async lock(c: PoolClient, id: string) {
    const r = await c.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0];
  }
  private present(p: any) {
    return { ...p, confirmation_label: p.status === 'confirmed' || p.status === 'refunded'
      ? (p.confirmation_source === 'manual' ? MANUAL_LABEL : 'Confirmé par le prestataire') : null };
  }

  @Post('payments')
  @RequirePermissions('payments:manage')
  async create(@Body() b: PaymentDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    if (!b.payee_id && !b.payee_label) throw new BadRequestException('Bénéficiaire requis (identifiant ou libellé)');
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM payments WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) {
        const p = prev.rows[0];
        const eq = (await c.query(`SELECT $1::numeric = $2::numeric AS eq`, [p.amount, b.amount])).rows[0].eq;
        if (p.source_account_id !== b.source_account_id || p.payee_id !== (b.payee_id ?? null) || !eq)
          throw new ConflictException("Cette clé d'idempotence a déjà servi pour un autre paiement");
        return { row: p, replay: true };
      }
      const a = await c.query(`SELECT currency, status FROM financial_accounts WHERE id = $1`, [b.source_account_id]);
      if (!a.rowCount || a.rows[0].status !== 'active') throw new BadRequestException('Compte source inconnu ou clôturé');
      const row = (await c.query(
        `INSERT INTO payments(organization_id, idempotency_key, source_account_id, payee_type, payee_id, payee_label, amount, currency, method, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, b.idempotency_key, b.source_account_id, b.payee_type, b.payee_id ?? null, b.payee_label ?? null, b.amount, a.rows[0].currency, b.method,
         b.reference_type ?? null, b.reference_id ?? null, req.user.id])).rows[0];
      await this.event(c, req.org.id, row.id, null, 'planned', req.user.id);
      return { row, replay: false };
    });
    if (!out.replay) await this.log(req, 'payment.create', 'payment', out.row.id, { amount: b.amount });
    return { ...this.present(out.row), replayed: out.replay };
  }

  @Post('payments/:id/transition')
  @RequirePermissions('payments:manage')
  async transition(@Param('id', ParseUUIDPipe) id: string, @Body() b: TransitionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (!(NEXT[p.status] ?? []).includes(b.to)) throw new BadRequestException(`Transition ${p.status} → ${b.to} impossible`);
      const r = await c.query(`UPDATE payments SET status = $2, external_ref = coalesce($3, external_ref), updated_at = now() WHERE id = $1 RETURNING *`, [id, b.to, b.external_ref ?? null]);
      await this.event(c, req.org.id, id, p.status, b.to, req.user.id, b.note);
      return r.rows[0];
    });
    await this.log(req, 'payment.transition', 'payment', id, { to: b.to });
    return this.present(row);
  }

  /**
   * Confirmation. Sans connecteur bancaire/Mobile Money, seule une confirmation MANUELLE est possible :
   * elle est tracée comme telle et ne peut jamais être présentée comme une confirmation bancaire.
   */
  @Post('payments/:id/confirm')
  @RequirePermissions('payments:confirm')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() b: ConfirmDto, @Req() req: any) {
    if (b.confirmation_source === 'provider')
      throw new UnprocessableEntityException("Aucun connecteur bancaire ou Mobile Money n'est configuré : seule la confirmation manuelle est possible");
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (!['initiated', 'pending'].includes(p.status)) throw new BadRequestException(`Statut ${p.status} : confirmation impossible (le paiement doit être initié)`);
      const { tx, account } = await postFinancialTx(c, {
        orgId: req.org.id, userId: req.user.id, accountId: p.source_account_id, direction: 'out', amount: p.amount,
        reason: `Paiement ${id.slice(0, 8)} (${p.method})`, idempotencyKey: `payment:${id}`, referenceType: 'payment', referenceId: id,
      });
      const entry = await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: account.owner_type === 'cash_register' ? 'CAI' : 'BQ', date: today(),
        label: `Paiement ${p.payee_label ?? p.payee_type} (${p.method})`,
        lines: [{ code: '401', debit: p.amount }, { code: accountingCodeOf(account), credit: p.amount }],
        idempotencyKey: `payment-entry:${id}`, referenceType: 'payment', referenceId: id,
      });
      const r = await c.query(
        `UPDATE payments SET status = 'confirmed', confirmation_source = 'manual', confirmation_note = $2, external_ref = coalesce($3, external_ref),
                tx_id = $4, entry_id = $5, cash_session_id = $6, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, b.note, b.external_ref ?? null, tx.id, entry.id, tx.cash_session_id]);
      await this.event(c, req.org.id, id, p.status, 'confirmed', req.user.id, `[manuel] ${b.note}`);
      return r.rows[0];
    });
    await this.log(req, 'payment.confirm', 'payment', id, { source: 'manual' });
    return this.present(row);
  }

  @Post('payments/:id/refund')
  @RequirePermissions('payments:confirm')
  async refund(@Param('id', ParseUUIDPipe) id: string, @Body() b: RefundDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (p.status !== 'confirmed') throw new BadRequestException('Seul un paiement confirmé peut être remboursé');
      await reverseFinancialTx(c, req.org.id, req.user.id, p.tx_id, b.reason);
      await reverseEntry(c, req.org.id, req.user.id, p.entry_id, `Remboursement paiement : ${b.reason}`, today());
      const r = await c.query(`UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1 RETURNING *`, [id]);
      await this.event(c, req.org.id, id, 'confirmed', 'refunded', req.user.id, b.reason);
      return r.rows[0];
    });
    await this.log(req, 'payment.refund', 'payment', id, { reason: b.reason });
    return this.present(row);
  }

  @Get('payments')
  @RequirePermissions('payments:read')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT * FROM payments WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 500`, [status ?? null])).rows.map((p: any) => this.present(p)));
  }

  @Get('payments/:id')
  @RequirePermissions('payments:read')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const p = (await c.query(`SELECT * FROM payments WHERE id = $1`, [id])).rows[0];
      if (!p) throw new NotFoundException();
      const events = (await c.query(`SELECT from_status, to_status, note, actor_id, at FROM payment_events WHERE payment_id = $1 ORDER BY at, id`, [id])).rows;
      return { ...this.present(p), events };
    });
  }

  // ---- Rapprochements ----
  /** Compare le relevé (banque, ou comptage pour une caisse) au solde du livre à la date donnée ; l'historique est conservé. */
  @Post('reconciliations')
  @RequirePermissions('reconciliation:manage')
  async reconcile(@Body() b: ReconcileDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      if (!(await c.query(`SELECT 1 FROM financial_accounts WHERE id = $1`, [b.account_id])).rowCount) throw new BadRequestException('Compte inconnu');
      const book = (await c.query(
        `SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0)::text AS b FROM financial_transactions
          WHERE account_id = $1 AND created_at::date <= $2::date`, [b.account_id, b.statement_date])).rows[0].b;
      const diff = (await c.query(`SELECT ($1::numeric - $2::numeric)::text AS d`, [b.statement_balance, book])).rows[0].d;
      const zero = Number(diff) === 0;
      if (!zero && !b.note) throw new UnprocessableEntityException(`Écart de ${diff} : une explication (10 caractères minimum) est obligatoire`);
      return (await c.query(
        `INSERT INTO reconciliations(organization_id, account_id, statement_date, statement_balance, book_balance, difference, status, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.org.id, b.account_id, b.statement_date, b.statement_balance, book, diff, zero ? 'balanced' : 'difference_explained', b.note ?? null, req.user.id])).rows[0];
    });
    await this.log(req, 'reconciliation.create', 'reconciliation', row.id, { difference: row.difference });
    return row;
  }

  @Get('reconciliations')
  @RequirePermissions('reconciliation:manage')
  listReconciliations(@Req() req: any, @Query('account_id') accountId?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT * FROM reconciliations WHERE ($1::uuid IS NULL OR account_id = $1::uuid) ORDER BY created_at DESC LIMIT 200`, [accountId ?? null])).rows);
  }
}
