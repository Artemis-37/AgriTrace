import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { accountingCodeOf, postEntry, today } from '../accounting/accounting.helpers';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';

class RegisterDto {
  @IsString() @Length(2, 100) name: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}
class AccountDto {
  @IsIn(['producer', 'collector', 'other']) owner_type: string;
  @IsOptional() @IsUUID() owner_id?: string;
  @IsString() @Length(2, 150) name: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}
class OpenSessionDto { @Dec(4) opening_amount: string; }
class CloseSessionDto { @Dec(4) counted_amount: string; }
export class TransactionDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() account_id: string;
  @IsOptional() @IsUUID() cash_session_id?: string;
  @IsIn(['in', 'out']) direction: string;
  @Dec(4) amount: string;
  @IsString() @Length(3, 300) reason: string;
  @IsOptional() @IsString() reference_type?: string;
  @IsOptional() @IsUUID() reference_id?: string;
}
class ReverseDto { @IsString() @Length(3, 300) reason: string; }

const BALANCE_SQL = `SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
                       FROM financial_transactions WHERE account_id = $1`;

@ApiTags('finances')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class FinanceController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, entityType: string, entityId: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType, entityId, details });
  }

  // ---- Comptes ----
  @Get('financial-accounts')
  @RequirePermissions('finance:read')
  accounts(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT a.id, a.owner_type, a.owner_id, a.name, a.currency, a.status,
              coalesce((SELECT sum(CASE direction WHEN 'in' THEN amount ELSE -amount END) FROM financial_transactions t WHERE t.account_id = a.id), 0) AS balance
         FROM financial_accounts a ORDER BY a.name`)).rows);
  }

  @Post('financial-accounts')
  @RequirePermissions('cash:manage')
  async createAccount(@Body() b: AccountDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) =>
      (await c.query(`INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, currency, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, owner_type, owner_id, name, currency`,
        [req.org.id, b.owner_type, b.owner_id ?? null, b.name, b.currency ?? 'XOF', req.user.id])).rows[0]);
    await this.log(req, 'account.create', 'financial_account', row.id);
    return row;
  }

  @Get('financial-accounts/:id/transactions')
  @RequirePermissions('finance:read')
  txs(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Query('limit') limit?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, direction, amount, currency, reason, reference_type, reference_id, reversal_of, cash_session_id, created_at, created_by
         FROM financial_transactions WHERE account_id = $1 ORDER BY created_at DESC, id LIMIT $2`, [id, Math.min(Number(limit) || 100, 500)])).rows);
  }

  // ---- Caisses ----
  @Get('cash-registers')
  @RequirePermissions('cash:read')
  registers(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.name, r.currency, r.status, r.account_id,
              (SELECT id FROM cash_sessions s WHERE s.register_id = r.id AND s.status = 'open') AS open_session_id
         FROM cash_registers r ORDER BY r.name`)).rows);
  }

  @Post('cash-registers')
  @RequirePermissions('cash:manage')
  async createRegister(@Body() b: RegisterDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const cur = b.currency ?? 'XOF';
      const acc = await c.query(`INSERT INTO financial_accounts(organization_id, owner_type, name, currency, created_by) VALUES ($1,'cash_register',$2,$3,$4) RETURNING id`,
        [req.org.id, `Caisse ${b.name}`, cur, req.user.id]);
      try {
        return (await c.query(`INSERT INTO cash_registers(organization_id, name, currency, account_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, currency, account_id`,
          [req.org.id, b.name, cur, acc.rows[0].id, req.user.id])).rows[0];
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('Nom de caisse déjà utilisé');
        throw e;
      }
    });
    await this.log(req, 'cash_register.create', 'cash_register', row.id);
    return row;
  }

  @Post('cash-registers/:id/sessions')
  @RequirePermissions('cash:operate')
  async openSession(@Param('id', ParseUUIDPipe) id: string, @Body() b: OpenSessionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const r = await c.query(`SELECT id, name, account_id, status FROM cash_registers WHERE id = $1 FOR UPDATE`, [id]);
      if (!r.rowCount) throw new NotFoundException();
      if (r.rows[0].status !== 'active') throw new BadRequestException('Caisse fermée');
      if ((await c.query(`SELECT 1 FROM cash_sessions WHERE register_id = $1 AND status = 'open'`, [id])).rowCount)
        throw new ConflictException('Une session est déjà ouverte sur cette caisse');
      const s = (await c.query(
        `INSERT INTO cash_sessions(organization_id, register_id, opened_by, opening_amount) VALUES ($1,$2,$3,$4) RETURNING id, register_id, opening_amount, opened_at, status`,
        [req.org.id, id, req.user.id, b.opening_amount])).rows[0];
      // Le fonds de caisse d'ouverture est une entrée tracée du compte de la caisse
      if (Number(b.opening_amount) > 0)
        await c.query(
          `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, created_by)
           SELECT $1::uuid, $2::text, a.id, $3::uuid, 'in', $4::numeric, a.currency, 'Fonds de caisse à l''ouverture', $5::uuid FROM financial_accounts a WHERE a.id = $6::uuid`,
          [req.org.id, `opening:${s.id}`, s.id, b.opening_amount, req.user.id, r.rows[0].account_id]);
      // Écriture comptable correspondante : débit caisse, crédit 585 « Virements de fonds » (compte de passage, à affecter par le comptable)
      if (Number(b.opening_amount) > 0) {
        const acc = (await c.query(`SELECT owner_type, accounting_code FROM financial_accounts WHERE id = $1`, [r.rows[0].account_id])).rows[0];
        await postEntry(c, {
          orgId: req.org.id, userId: req.user.id, journal: 'CAI', date: today(), label: `Fonds de caisse à l'ouverture (${r.rows[0].name ?? 'caisse'})`,
          lines: [{ code: accountingCodeOf(acc), debit: b.opening_amount }, { code: '585', credit: b.opening_amount }],
          idempotencyKey: `opening-entry:${s.id}`, referenceType: 'cash_session', referenceId: s.id,
        });
      }
      return s;
    });
    await this.log(req, 'cash_session.open', 'cash_session', row.id, { opening_amount: b.opening_amount });
    return row;
  }

  /** Clôture : montant attendu = solde du compte de la caisse ; l'écart compté − attendu est conservé. */
  @Post('cash-sessions/:id/close')
  @RequirePermissions('cash:operate')
  async closeSession(@Param('id', ParseUUIDPipe) id: string, @Body() b: CloseSessionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const s = await c.query(
        `SELECT s.id, s.status, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 FOR UPDATE OF s`, [id]);
      if (!s.rowCount) throw new NotFoundException();
      if (s.rows[0].status !== 'open') throw new BadRequestException('Session déjà clôturée');
      await c.query(`SELECT 1 FROM financial_accounts WHERE id = $1 FOR UPDATE`, [s.rows[0].account_id]);
      const exp = (await c.query(BALANCE_SQL, [s.rows[0].account_id])).rows[0].balance;
      return (await c.query(
        `UPDATE cash_sessions SET status = 'closed', closed_by = $2, closed_at = now(), counted_amount = $3, expected_amount = $4, variance = $3::numeric - $4::numeric
          WHERE id = $1 RETURNING id, status, counted_amount, expected_amount, variance, closed_at`,
        [id, req.user.id, b.counted_amount, exp])).rows[0];
    });
    await this.log(req, 'cash_session.close', 'cash_session', id, { variance: row.variance });
    return row;
  }

  // ---- Transactions ----
  @Post('financial-transactions')
  @RequirePermissions('cash:operate')
  async createTx(@Body() b: TransactionDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM financial_transactions WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) {
        const p = prev.rows[0];
        const same = await c.query(`SELECT $1::numeric = $2::numeric AS eq`, [p.amount, b.amount]);
        if (p.account_id !== b.account_id || p.direction !== b.direction || !same.rows[0].eq)
          throw new ConflictException("Cette clé d'idempotence a déjà servi pour une autre opération");
        return { row: p, replay: true };
      }
      // Verrou du compte : sérialise les opérations et empêche deux dépenses simultanées de dépasser le solde
      const a = await c.query(`SELECT id, owner_type, currency, status FROM financial_accounts WHERE id = $1 FOR UPDATE`, [b.account_id]);
      if (!a.rowCount) throw new BadRequestException('Compte inconnu');
      if (a.rows[0].status !== 'active') throw new BadRequestException('Compte clôturé');
      if (b.cash_session_id) {
        const s = await c.query(
          `SELECT 1 FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 AND s.status = 'open' AND r.account_id = $2`,
          [b.cash_session_id, b.account_id]);
        if (!s.rowCount) throw new BadRequestException("Session de caisse inconnue, clôturée, ou étrangère à ce compte");
      } else if (a.rows[0].owner_type === 'cash_register') {
        throw new BadRequestException('Une opération de caisse exige une session ouverte');
      }
      if (b.direction === 'out' && a.rows[0].owner_type === 'cash_register') {
        // Comparaison exacte en base (numeric), sans passer par des flottants
        const chk = (await c.query(
          `SELECT $2::numeric <= b.balance AS ok, b.balance
             FROM (SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
                     FROM financial_transactions WHERE account_id = $1) b`, [b.account_id, b.amount])).rows[0];
        if (!chk.ok) throw new UnprocessableEntityException(`Solde de caisse insuffisant (${chk.balance})`);
      }
      const ins = await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.org.id, b.idempotency_key, b.account_id, b.cash_session_id ?? null, b.direction, b.amount, a.rows[0].currency,
         b.reason, b.reference_type ?? null, b.reference_id ?? null, req.user.id]);
      return { row: ins.rows[0], replay: false };
    });
    if (!replay) await this.log(req, 'transaction.create', 'financial_transaction', row.id, { direction: b.direction, amount: b.amount });
    return { ...row, replayed: replay };
  }

  /** Correction : jamais de modification ; une écriture inverse référence l'originale. */
  @Post('financial-transactions/:id/reverse')
  @RequirePermissions('finance:reverse')
  async reverse(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReverseDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const o = await c.query(`SELECT * FROM financial_transactions WHERE id = $1`, [id]);
      if (!o.rowCount) throw new NotFoundException();
      const t = o.rows[0];
      if (t.reversal_of) throw new BadRequestException("Une écriture compensatoire ne peut pas être annulée");
      await c.query(`SELECT 1 FROM financial_accounts WHERE id = $1 FOR UPDATE`, [t.account_id]);
      try {
        return (await c.query(
          `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reversal_of, created_by)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [req.org.id, `reversal:${id}`, t.account_id, t.direction === 'in' ? 'out' : 'in', t.amount, t.currency,
           `Annulation : ${b.reason}`, id, req.user.id])).rows[0];
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('Cette opération a déjà été compensée');
        throw e;
      }
    });
    await this.log(req, 'transaction.reverse', 'financial_transaction', id, { reversal_id: row.id, reason: b.reason });
    return row;
  }
}
