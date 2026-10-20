import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Length, Matches, ValidateNested,
} from 'class-validator';
import * as ExcelJS from 'exceljs';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { accountingCodeOf, EntryLine, postEntry, reverseEntry, today } from './accounting.helpers';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;

class LineDto {
  @Matches(/^[1-9][0-9]{1,7}$/) code: string;
  @IsOptional() @Matches(AMOUNT) debit?: string;
  @IsOptional() @Matches(AMOUNT) credit?: string;
  @IsOptional() @IsString() @Length(1, 200) label?: string;
}
class ManualEntryDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(['ACH', 'CAI', 'BQ', 'OD']) journal: string;
  @Matches(DATE) entry_date: string;
  @IsString() @Length(3, 300) label: string;
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
}
class AccountDto {
  @Matches(/^[1-9][0-9]{1,7}$/) code: string;
  @IsString() @Length(2, 200) label: string;
}
class ReverseDto { @IsString() @Length(3, 300) reason: string; }
class CloseDto { @Matches(DATE) closed_until: string; @IsOptional() @IsString() note?: string; }
class SetCodeDto { @Matches(/^[1-9][0-9]{1,7}$/) accounting_code: string; }
class SettleDto { @IsString() @Length(10, 300) justification: string; }

const range = (from?: string, to?: string) => {
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new BadRequestException('Dates attendues au format AAAA-MM-JJ');
  return [from ?? '0001-01-01', to ?? '9999-12-31'];
};

@ApiTags('comptabilité')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class AccountingController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  // ---- Plan comptable ----
  @Get('accounting/chart')
  @RequirePermissions('accounting:read')
  chart(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      await c.query('SELECT accounting_seed($1::uuid)', [req.org.id]);
      return {
        referential: 'SYSCOHADA révisé',
        notice: 'Plan de base à faire valider par un comptable compétent avant tout usage comptable officiel.',
        accounts: (await c.query(`SELECT code, label, class, is_active FROM accounting_accounts ORDER BY code`)).rows,
        journals: (await c.query(`SELECT code, label FROM journals ORDER BY code`)).rows,
      };
    });
  }

  @Post('accounting/accounts')
  @RequirePermissions('accounting:post')
  async addAccount(@Body() b: AccountDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      await c.query('SELECT accounting_seed($1::uuid)', [req.org.id]);
      const r = await c.query(
        `INSERT INTO accounting_accounts(organization_id, code, label) VALUES ($1,$2,$3) ON CONFLICT (organization_id, code) DO NOTHING RETURNING code, label`,
        [req.org.id, b.code, b.label]);
      if (!r.rowCount) throw new BadRequestException('Ce compte existe déjà');
      return r.rows[0];
    });
    await this.log(req, 'accounting.account.create', 'accounting_account', row.code);
    return row;
  }

  /** Associe un compte financier (banque, mobile money…) à un compte comptable. */
  @Post('financial-accounts/:id/accounting-code')
  @RequirePermissions('accounting:post')
  async setCode(@Param('id', ParseUUIDPipe) id: string, @Body() b: SetCodeDto, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      await c.query('SELECT accounting_seed($1::uuid)', [req.org.id]);
      if (!(await c.query(`SELECT 1 FROM accounting_accounts WHERE code = $1 AND is_active`, [b.accounting_code])).rowCount)
        throw new BadRequestException('Compte comptable inconnu');
      const r = await c.query(`UPDATE financial_accounts SET accounting_code = $2 WHERE id = $1`, [id, b.accounting_code]);
      if (!r.rowCount) throw new NotFoundException();
    });
    await this.log(req, 'financial_account.accounting_code', 'financial_account', id, { code: b.accounting_code });
    return { id, accounting_code: b.accounting_code };
  }

  // ---- Écritures ----
  @Post('accounting/entries')
  @RequirePermissions('accounting:post')
  async manualEntry(@Body() b: ManualEntryDto, @Req() req: any) {
    for (const l of b.lines) {
      const hasD = l.debit !== undefined && Number(l.debit) > 0, hasC = l.credit !== undefined && Number(l.credit) > 0;
      if (hasD === hasC) throw new BadRequestException('Chaque ligne porte soit un débit, soit un crédit (strictement positif)');
    }
    try {
      const r = await this.db.tx(req.org.id, (c) => postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: b.journal, date: b.entry_date, label: b.label,
        lines: b.lines as EntryLine[], idempotencyKey: b.idempotency_key, referenceType: 'manual',
      }));
      if (!r.replay) await this.log(req, 'accounting.entry.create', 'accounting_entry', r.id, { number: r.number });
      return { id: r.id, number: r.number, replayed: r.replay };
    } catch (e: any) {
      if (e.code === '23514') throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }

  @Post('accounting/entries/:id/reverse')
  @RequirePermissions('accounting:post')
  async reverse(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReverseDto, @Req() req: any) {
    try {
      const r = await this.db.tx(req.org.id, async (c) => {
        const o = await c.query(`SELECT reversal_of FROM accounting_entries WHERE id = $1`, [id]);
        if (!o.rowCount) throw new NotFoundException();
        if (o.rows[0].reversal_of) throw new BadRequestException("Une écriture d'annulation ne peut pas être annulée");
        return reverseEntry(c, req.org.id, req.user.id, id, `Annulation : ${b.reason}`, today());
      });
      await this.log(req, 'accounting.entry.reverse', 'accounting_entry', id, { reversal: r.number, reason: b.reason });
      return { id: r.id, number: r.number };
    } catch (e: any) {
      if (e.code === '23514') throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }

  @Get('accounting/entries')
  @RequirePermissions('accounting:read')
  entries(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('journal') journal?: string) {
    const [f, t] = range(from, to);
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT e.id, e.number, j.code AS journal, e.entry_date, e.label, e.reversal_of, e.reference_type, e.reference_id,
              (SELECT d.purchase_receipt_no FROM purchase_declarations d
                 WHERE (e.reference_type = 'purchase_declaration' AND d.id = e.reference_id)
                    OR (e.reference_type = 'payment' AND d.id = (SELECT p.reference_id FROM payments p WHERE p.id = e.reference_id AND p.reference_type = 'purchase_declaration')) LIMIT 1) AS purchase_receipt_no,
              (SELECT json_agg(json_build_object('account', a.code, 'debit', l.debit, 'credit', l.credit, 'label', l.label) ORDER BY l.line_no)
                 FROM accounting_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.entry_id = e.id) AS lines
         FROM accounting_entries e JOIN journals j ON j.id = e.journal_id
        WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR j.code = $3)
        ORDER BY e.entry_date, e.number LIMIT 1000`, [f, t, journal ?? null])).rows);
  }

  // ---- États ----
  private async trialBalance(orgId: string, from: string, to: string) {
    return this.db.tx(orgId, async (c) => (await c.query(
      `SELECT a.code, a.label, coalesce(sum(l.debit),0) AS debit, coalesce(sum(l.credit),0) AS credit,
              greatest(coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0), 0) AS balance_debit,
              greatest(coalesce(sum(l.credit),0) - coalesce(sum(l.debit),0), 0) AS balance_credit
         FROM accounting_lines l JOIN accounting_accounts a ON a.id = l.account_id JOIN accounting_entries e ON e.id = l.entry_id
        WHERE e.entry_date BETWEEN $1 AND $2 GROUP BY a.code, a.label ORDER BY a.code`, [from, to])).rows);
  }

  @Get('accounting/trial-balance')
  @RequirePermissions('accounting:read')
  async trial(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const [f, t] = range(from, to);
    const rows = await this.trialBalance(req.org.id, f, t);
    const sum = (k: string) => rows.reduce((s: number, r: any) => s + Number(r[k]), 0);
    return { from: f, to: t, rows, totals: { debit: sum('debit').toFixed(4), credit: sum('credit').toFixed(4) } };
  }

  @Get('accounting/ledger/:code')
  @RequirePermissions('accounting:read')
  async ledger(@Param('code') code: string, @Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const [f, t] = range(from, to);
    return this.db.tx(req.org.id, async (c) => {
      const a = await c.query(`SELECT id, code, label FROM accounting_accounts WHERE code = $1`, [code]);
      if (!a.rowCount) throw new NotFoundException('Compte inconnu');
      const rows = (await c.query(
        `SELECT e.entry_date, e.number, e.label, l.debit, l.credit,
                sum(l.debit - l.credit) OVER (ORDER BY e.entry_date, e.number, l.line_no) AS running_balance
           FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id
          WHERE l.account_id = $1 AND e.entry_date BETWEEN $2 AND $3 ORDER BY e.entry_date, e.number, l.line_no`, [a.rows[0].id, f, t])).rows;
      return { account: a.rows[0], rows };
    });
  }

  /** Exports Excel : journal (écritures) ou balance. */
  @Get('accounting/export/:kind')
  @RequirePermissions('accounting:read')
  async export(@Param('kind') kind: string, @Req() req: any, @Res() res: any, @Query('from') from?: string, @Query('to') to?: string) {
    if (!['journal', 'balance'].includes(kind)) throw new NotFoundException();
    const [f, t] = range(from, to);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind === 'journal' ? 'Journal' : 'Balance');
    if (kind === 'journal') {
      ws.columns = [
        { header: 'Date', key: 'd', width: 12 }, { header: 'N° écriture', key: 'n', width: 16 }, { header: 'Journal', key: 'j', width: 8 },
        { header: 'Compte', key: 'c', width: 10 }, { header: 'Libellé', key: 'l', width: 50 },
        { header: 'Débit', key: 'db', width: 16 }, { header: 'Crédit', key: 'cr', width: 16 }, { header: 'Reçu d\'achat', key: 'rc', width: 18 },
      ];
      const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
        `SELECT e.entry_date, e.number, j.code AS journal, a.code, coalesce(l.label, e.label) AS label, l.debit, l.credit,
              (SELECT d.purchase_receipt_no FROM purchase_declarations d
                 WHERE (e.reference_type = 'purchase_declaration' AND d.id = e.reference_id)
                    OR (e.reference_type = 'payment' AND d.id = (SELECT p.reference_id FROM payments p WHERE p.id = e.reference_id AND p.reference_type = 'purchase_declaration')) LIMIT 1) AS purchase_receipt_no
           FROM accounting_lines l JOIN accounting_entries e ON e.id = l.entry_id JOIN journals j ON j.id = e.journal_id JOIN accounting_accounts a ON a.id = l.account_id
          WHERE e.entry_date BETWEEN $1 AND $2 ORDER BY e.entry_date, e.number, l.line_no`, [f, t])).rows);
      for (const r of rows) ws.addRow({ d: r.entry_date, n: r.number, j: r.journal, c: r.code, l: r.label, db: Number(r.debit), cr: Number(r.credit), rc: r.purchase_receipt_no ?? '' });
    } else {
      ws.columns = [
        { header: 'Compte', key: 'c', width: 10 }, { header: 'Libellé', key: 'l', width: 50 }, { header: 'Débit', key: 'd', width: 16 },
        { header: 'Crédit', key: 'cr', width: 16 }, { header: 'Solde débiteur', key: 'sd', width: 16 }, { header: 'Solde créditeur', key: 'sc', width: 16 },
      ];
      for (const r of await this.trialBalance(req.org.id, f, t))
        ws.addRow({ c: r.code, l: r.label, d: Number(r.debit), cr: Number(r.credit), sd: Number(r.balance_debit), sc: Number(r.balance_credit) });
    }
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-${f}-${t}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }

  // ---- Clôture de période ----
  @Post('accounting/closures')
  @RequirePermissions('accounting:close')
  async close(@Body() b: CloseDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const last = await c.query(`SELECT max(closed_until) AS m FROM accounting_closures`);
      if (last.rows[0].m && b.closed_until <= last.rows[0].m.toISOString().slice(0, 10))
        throw new BadRequestException('La date doit être postérieure à la dernière clôture');
      if (b.closed_until >= today()) throw new BadRequestException("On ne clôture que des périodes entièrement écoulées");
      return (await c.query(
        `INSERT INTO accounting_closures(organization_id, closed_until, closed_by, note) VALUES ($1,$2,$3,$4) RETURNING id, closed_until`,
        [req.org.id, b.closed_until, req.user.id, b.note ?? null])).rows[0];
    });
    await this.log(req, 'accounting.close', 'accounting_closure', row.id, { closed_until: b.closed_until });
    return row;
  }

  /**
   * Contrôle de cohérence : pour chaque compte comptable de trésorerie, solde des comptes financiers vs solde comptable.
   * Un écart signale des opérations financières non comptabilisées (ex. fonds de caisse d'ouverture, opérations libres).
   */
  @Get('accounting/consistency')
  @RequirePermissions('accounting:read')
  consistency(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const rows = (await c.query(
        `WITH fin AS (
           SELECT coalesce(a.accounting_code, CASE a.owner_type WHEN 'cash_register' THEN '571' ELSE '521' END) AS code,
                  sum(CASE t.direction WHEN 'in' THEN t.amount ELSE -t.amount END) AS bal
             FROM financial_accounts a JOIN financial_transactions t ON t.account_id = a.id
            WHERE a.owner_type IN ('cash_register','other') GROUP BY 1),
         acc AS (
           SELECT a.code, sum(l.debit - l.credit) AS bal FROM accounting_lines l JOIN accounting_accounts a ON a.id = l.account_id GROUP BY a.code)
         SELECT fin.code AS accounting_code, fin.bal AS financial_balance, coalesce(acc.bal, 0) AS accounting_balance, fin.bal - coalesce(acc.bal, 0) AS difference
           FROM fin LEFT JOIN acc ON acc.code = fin.code ORDER BY fin.code`)).rows;
      return { rows, consistent: rows.every((r: any) => Number(r.difference) === 0),
        notice: "Un écart signale des opérations financières non encore comptabilisées (fonds de caisse d'ouverture, opérations libres) : à analyser avec le comptable." };
    });
  }

  // ---- Comptabilisation d'événements métier ----
  /** Achat à un producteur : débit 602 / crédit 401, pour une déclaration dont la réception est confirmée. */
  @Post('accounting/post-purchase/:declarationId')
  @RequirePermissions('accounting:post')
  async postPurchase(@Param('declarationId', ParseUUIDPipe) id: string, @Req() req: any) {
    try {
      const r = await this.db.tx(req.org.id, async (c) => {
        const d = (await c.query(`SELECT id, status, amount, operation_date FROM purchase_declarations WHERE id = $1`, [id])).rows[0];
        if (!d) throw new NotFoundException();
        if (d.status === 'partially_received')
          throw new UnprocessableEntityException('Réception partielle : saisir une écriture manuelle avec le montant exact reçu');
        if (d.status !== 'received_confirmed') throw new UnprocessableEntityException("Seule une réception confirmée peut être comptabilisée");
        if (d.amount === null || Number(d.amount) <= 0) throw new UnprocessableEntityException('Montant de la déclaration indisponible');
        return postEntry(c, {
          orgId: req.org.id, userId: req.user.id, journal: 'ACH', date: today(), label: `Achat producteur (déclaration ${id.slice(0, 8)})`,
          lines: [{ code: '602', debit: d.amount }, { code: '401', credit: d.amount }],
          idempotencyKey: `purchase:${id}`, referenceType: 'purchase_declaration', referenceId: id,
        });
      });
      if (!r.replay) await this.log(req, 'accounting.post_purchase', 'accounting_entry', r.id, { declaration: id });
      return { id: r.id, number: r.number, replayed: r.replay };
    } catch (e: any) {
      if (e.code === '23514') throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }

  /** Régularisation d'un écart de clôture de caisse : opération de caisse + écriture 571 / 658 ou 758. */
  @Post('cash-sessions/:id/settle-variance')
  @RequirePermissions('cash:manage')
  async settle(@Param('id', ParseUUIDPipe) id: string, @Body() b: SettleDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(
        `SELECT s.id, s.status, s.variance, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 FOR UPDATE OF s`, [id])).rows[0];
      if (!s) throw new NotFoundException();
      if (s.status !== 'closed') throw new BadRequestException('La session doit être clôturée');
      if (Number(s.variance) === 0) throw new BadRequestException('Aucun écart à régulariser');
      if ((await c.query(`SELECT 1 FROM financial_transactions WHERE idempotency_key = $1`, [`variance:${id}`])).rowCount)
        throw new BadRequestException('Écart déjà régularisé');
      const pos = Number(s.variance) > 0;
      const amount = (await c.query(`SELECT abs($1::numeric)::text AS a`, [s.variance])).rows[0].a;
      const acc = (await c.query(`SELECT owner_type, accounting_code, currency FROM financial_accounts WHERE id = $1 FOR UPDATE`, [s.account_id])).rows[0];
      // Insertion directe : la session est déjà clôturée, l'écart est rattaché à elle pour garder la piste d'audit.
      const tx = (await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cash_variance',$4,$9) RETURNING id`,
        [req.org.id, `variance:${id}`, s.account_id, id, pos ? 'in' : 'out', amount, acc.currency, `Régularisation d'écart de caisse : ${b.justification}`, req.user.id])).rows[0];
      const cash = accountingCodeOf(acc);
      const entry = await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'CAI', date: today(), label: `Écart de caisse : ${b.justification}`,
        lines: pos ? [{ code: cash, debit: amount }, { code: '758', credit: amount }] : [{ code: '658', debit: amount }, { code: cash, credit: amount }],
        idempotencyKey: `variance-entry:${id}`, referenceType: 'cash_session', referenceId: id,
      });
      return { transaction_id: tx.id, entry_number: entry.number, direction: pos ? 'in' : 'out', amount };
    });
    await this.log(req, 'cash_session.settle_variance', 'cash_session', id, out);
    return out;
  }
}
