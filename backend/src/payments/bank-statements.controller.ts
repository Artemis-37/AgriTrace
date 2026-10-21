import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { parseAmount, parseCsv, parseDate } from './statement-csv';

class MatchDto { @IsUUID() tx_id: string; }
class IgnoreDto { @IsOptional() @IsString() @Length(0, 300) note?: string; }
const MAX_LINES = 5000;
const WINDOW_DAYS = 3;

/** Colonnes du relevé : nom d'en-tête (ou numéro de colonne à partir de 1). `amount` seul, ou `debit` et `credit`. */
interface Mapping { date: string; label: string; reference?: string; amount?: string; debit?: string; credit?: string }

function colIndex(header: string[], ref: string | undefined, what: string, required: boolean): number {
  if (!ref) { if (required) throw new BadRequestException(`Colonne « ${what} » non indiquée`); return -1; }
  if (/^\d+$/.test(ref)) { const i = Number(ref) - 1; if (i < 0 || i >= header.length) throw new BadRequestException(`Colonne « ${what} » : numéro hors du fichier`); return i; }
  const i = header.findIndex((h) => h.trim().toLowerCase() === ref.trim().toLowerCase());
  if (i < 0) throw new BadRequestException(`Colonne « ${ref} » introuvable dans l'en-tête (${header.join(' | ')})`);
  return i;
}

/** Rapprochement bancaire (CDC §21.1) : import d'un relevé CSV, pointage automatique puis manuel avec les opérations du compte. */
@ApiTags('rapprochement')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class BankStatementsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'bank_statement', entityId: id, details });
  }

  /** Opérations du compte pouvant correspondre à une ligne (même sens, même montant, dates proches), non encore pointées. */
  private async candidates(c: PoolClient, accountId: string, amount: number, opDate: string, window = WINDOW_DAYS) {
    return (await c.query(
      `SELECT t.id, t.created_at, t.direction, t.amount, t.reason FROM financial_transactions t
        WHERE t.account_id = $1 AND t.direction = $2 AND t.amount = $3
          AND abs(t.created_at::date - $4::date) <= $5
          AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.match_tx_id = t.id)
        ORDER BY abs(t.created_at::date - $4::date), t.created_at`,
      [accountId, amount > 0 ? 'in' : 'out', Math.abs(amount).toFixed(4), opDate, window])).rows;
  }

  @Post('bank-statements/import')
  @RequirePermissions('reconciliation:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async import(@UploadedFile() file: Express.Multer.File, @Body() b: { account_id?: string; mapping?: string; dry_run?: string }, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ « file », CSV)');
    if (!b.account_id || !/^[0-9a-f-]{36}$/i.test(b.account_id)) throw new BadRequestException('Compte financier manquant');
    let map: Mapping;
    try { map = JSON.parse(b.mapping ?? ''); } catch { throw new BadRequestException('Correspondance des colonnes manquante ou illisible (JSON : date, label, amount ou debit/credit, reference)'); }
    const rows = parseCsv(file.buffer.toString('utf8'));
    if (rows.length < 2) throw new BadRequestException('Le fichier ne contient pas de lignes');
    const header = rows[0];
    const iDate = colIndex(header, map.date, 'date', true), iLabel = colIndex(header, map.label, 'libellé', true), iRef = colIndex(header, map.reference, 'référence', false);
    const iAmt = colIndex(header, map.amount, 'montant', false), iDeb = colIndex(header, map.debit, 'débit', false), iCre = colIndex(header, map.credit, 'crédit', false);
    if (iAmt < 0 && iDeb < 0 && iCre < 0) throw new BadRequestException('Indiquez la colonne « amount » (montant signé) ou « debit » et « credit »');
    if (rows.length - 1 > MAX_LINES) throw new BadRequestException(`Trop de lignes (${rows.length - 1} ; maximum ${MAX_LINES}) : découpez le relevé`);

    const lines: { line_no: number; op_date: string; label: string; reference: string | null; amount: number }[] = [];
    const errors: { line: number; error: string }[] = [];
    rows.slice(1).forEach((r, k) => {
      const n = k + 2;
      const date = parseDate(r[iDate] ?? '');
      if (!date) return errors.push({ line: n, error: `Date illisible « ${r[iDate] ?? ''} »` });
      let amount: number | null;
      if (iAmt >= 0) amount = parseAmount(r[iAmt] ?? '');
      else { const d = parseAmount(r[iDeb] ?? ''), cr = parseAmount(r[iCre] ?? ''); amount = d == null || cr == null ? null : Math.abs(cr) - Math.abs(d); }
      if (amount == null) return errors.push({ line: n, error: 'Montant illisible' });
      if (amount === 0) return; // ligne sans mouvement (solde, total…)
      lines.push({ line_no: n, op_date: date, label: (r[iLabel] ?? '').slice(0, 300) || '(sans libellé)', reference: iRef >= 0 ? (r[iRef] ?? '').slice(0, 100) || null : null, amount });
    });
    if (!lines.length) throw new BadRequestException(`Aucune ligne exploitable${errors.length ? ` (${errors[0].error}, ligne ${errors[0].line})` : ''}`);
    if (errors.length > Math.max(5, lines.length / 10)) throw new BadRequestException(`Trop d'erreurs de lecture (${errors.length}) : vérifiez la correspondance des colonnes. Première : ligne ${errors[0].line}, ${errors[0].error}`);
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const dry = b.dry_run === '1' || b.dry_run === 'true';

    const out = await this.db.tx(req.org.id, async (c) => {
      const acc = (await c.query(`SELECT id, status FROM financial_accounts WHERE id = $1`, [b.account_id])).rows[0];
      if (!acc) throw new BadRequestException('Compte financier inconnu');
      if ((await c.query(`SELECT 1 FROM bank_statements WHERE account_id = $1 AND file_sha256 = $2`, [b.account_id, sha])).rowCount)
        throw new ConflictException('Ce relevé a déjà été importé pour ce compte');
      const dates = lines.map((l) => l.op_date).sort();
      let stId: string | null = null;
      if (!dry) stId = (await c.query(
        `INSERT INTO bank_statements(organization_id, account_id, filename, file_sha256, period_from, period_to, line_count, imported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [req.org.id, b.account_id, file.originalname.slice(0, 200), sha, dates[0], dates[dates.length - 1], lines.length, req.user.id])).rows[0].id;
      // Pointage automatique : une seule opération candidate ; plusieurs candidates = ambiguïté laissée à l'humain.
      const used = new Set<string>();
      let auto = 0, ambiguous = 0;
      const preview: any[] = [];
      for (const l of lines) {
        const cands = (await this.candidates(c, b.account_id!, l.amount, l.op_date)).filter((x: any) => !used.has(x.id));
        let tx: string | null = null;
        if (cands.length === 1) { tx = cands[0].id; used.add(tx!); auto++; } else if (cands.length > 1) ambiguous++;
        if (stId) await c.query(
          `INSERT INTO bank_statement_lines(organization_id, statement_id, line_no, op_date, label, reference, amount, status, match_tx_id, matched_at, auto_matched)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END,$9::uuid IS NOT NULL)`,
          [req.org.id, stId, l.line_no, l.op_date, l.label, l.reference, l.amount.toFixed(4), tx ? 'matched' : 'unmatched', tx]);
        else if (preview.length < 10) preview.push({ ...l, matched: !!tx });
      }
      return { statement_id: stId, dry_run: dry, lines: lines.length, auto_matched: auto, ambiguous, unmatched: lines.length - auto, skipped_errors: errors, period: { from: dates[0], to: dates[dates.length - 1] }, preview: dry ? preview : undefined };
    });
    if (!dry) await this.log(req, 'bank_statement.import', out.statement_id!, { lines: out.lines, auto_matched: out.auto_matched, filename: file.originalname });
    return out;
  }

  @Get('bank-statements')
  @RequirePermissions('reconciliation:manage')
  list(@Query('account_id') accountId: string | undefined, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.id, s.account_id, a.name AS account_name, s.filename, s.period_from, s.period_to, s.line_count, s.imported_at, u.full_name AS imported_by_name,
              count(*) FILTER (WHERE l.status = 'matched')::int AS matched, count(*) FILTER (WHERE l.status = 'unmatched')::int AS unmatched, count(*) FILTER (WHERE l.status = 'ignored')::int AS ignored
         FROM bank_statements s JOIN financial_accounts a ON a.id = s.account_id JOIN users u ON u.id = s.imported_by LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
        WHERE ($1::uuid IS NULL OR s.account_id = $1::uuid) GROUP BY s.id, a.name, u.full_name ORDER BY s.imported_at DESC LIMIT 100`, [accountId ?? null])).rows);
  }

  @Get('bank-statements/:id')
  @RequirePermissions('reconciliation:manage')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`SELECT s.*, a.name AS account_name FROM bank_statements s JOIN financial_accounts a ON a.id = s.account_id WHERE s.id = $1`, [id])).rows[0];
      if (!s) throw new NotFoundException('Relevé introuvable');
      const lines = (await c.query(
        `SELECT l.id, l.line_no, l.op_date, l.label, l.reference, l.amount, l.status, l.match_tx_id, l.auto_matched, l.note, t.reason AS tx_reason, t.created_at AS tx_at
           FROM bank_statement_lines l LEFT JOIN financial_transactions t ON t.id = l.match_tx_id WHERE l.statement_id = $1 ORDER BY l.line_no`, [id])).rows;
      const sum = (st: string) => lines.filter((l: any) => l.status === st).reduce((a: number, l: any) => a + Number(l.amount), 0).toFixed(2);
      // Opérations du compte sur la période, sans ligne de relevé : à expliquer (chèque non encaissé, erreur de saisie…).
      const unmatchedBook = (await c.query(
        `SELECT t.id, t.created_at, t.direction, t.amount, t.reason FROM financial_transactions t
          WHERE t.account_id = $1 AND t.created_at::date BETWEEN $2::date - $4::int AND $3::date + $4::int
            AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.match_tx_id = t.id) ORDER BY t.created_at`, [s.account_id, s.period_from, s.period_to, WINDOW_DAYS])).rows;
      return { ...s, lines, summary: { matched_total: sum('matched'), unmatched_total: sum('unmatched'), ignored_total: sum('ignored') }, unmatched_book_transactions: unmatchedBook };
    });
  }

  @Get('bank-statement-lines/:id/candidates')
  @RequirePermissions('reconciliation:manage')
  async lineCandidates(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const l = (await c.query(`SELECT l.amount, l.op_date::text AS op_date, s.account_id FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id WHERE l.id = $1`, [id])).rows[0];
      if (!l) throw new NotFoundException('Ligne introuvable');
      return this.candidates(c, l.account_id, Number(l.amount), l.op_date, 30);
    });
  }

  @Post('bank-statement-lines/:id/match')
  @RequirePermissions('reconciliation:manage')
  async match(@Param('id', ParseUUIDPipe) id: string, @Body() b: MatchDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const l = (await c.query(`SELECT l.*, s.account_id FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id WHERE l.id = $1 FOR UPDATE`, [id])).rows[0];
      if (!l) throw new NotFoundException('Ligne introuvable');
      if (l.status === 'matched') throw new ConflictException('Ligne déjà pointée');
      const t = (await c.query(`SELECT * FROM financial_transactions WHERE id = $1`, [b.tx_id])).rows[0];
      if (!t || t.account_id !== l.account_id) throw new BadRequestException("Cette opération n'appartient pas au compte du relevé");
      if (t.direction !== (Number(l.amount) > 0 ? 'in' : 'out') || Number(t.amount) !== Math.abs(Number(l.amount)))
        throw new BadRequestException(`Sens ou montant différents (relevé ${l.amount}, opération ${t.direction === 'in' ? '+' : '-'}${t.amount}) : pointage refusé`);
      try {
        await c.query(`UPDATE bank_statement_lines SET status = 'matched', match_tx_id = $2, matched_by = $3, matched_at = now(), auto_matched = false WHERE id = $1`, [id, b.tx_id, req.user.id]);
      } catch (e: any) { if (e.code === '23505') throw new ConflictException('Cette opération est déjà pointée avec une autre ligne'); throw e; }
      return { id, status: 'matched', statement_id: l.statement_id };
    });
    await this.log(req, 'bank_statement.match', r.statement_id, { line_id: id, tx_id: b.tx_id });
    return r;
  }

  @Post('bank-statement-lines/:id/unmatch')
  @RequirePermissions('reconciliation:manage')
  async unmatch(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const l = (await c.query(`UPDATE bank_statement_lines SET status = 'unmatched', match_tx_id = NULL, matched_by = NULL, matched_at = NULL, auto_matched = false, note = NULL
                                 WHERE id = $1 AND status <> 'unmatched' RETURNING statement_id`, [id])).rows[0];
      if (!l) throw new NotFoundException('Ligne introuvable ou déjà non pointée');
      return { id, status: 'unmatched', statement_id: l.statement_id };
    });
    await this.log(req, 'bank_statement.unmatch', r.statement_id, { line_id: id });
    return r;
  }

  @Post('bank-statement-lines/:id/ignore')
  @RequirePermissions('reconciliation:manage')
  async ignore(@Param('id', ParseUUIDPipe) id: string, @Body() b: IgnoreDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const l = (await c.query(`UPDATE bank_statement_lines SET status = 'ignored', matched_by = $2, matched_at = now(), note = $3 WHERE id = $1 AND status = 'unmatched' RETURNING statement_id`, [id, req.user.id, b.note ?? null])).rows[0];
      if (!l) throw new ConflictException('Seule une ligne non pointée peut être ignorée');
      return { id, status: 'ignored', statement_id: l.statement_id };
    });
    await this.log(req, 'bank_statement.ignore', r.statement_id, { line_id: id, note: b.note });
    return r;
  }
}
