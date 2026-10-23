import { effectiveBuyPrice } from '../products/price';
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe,
  Post, Put, Query, Req, StreamableFile, UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import * as ExcelJS from 'exceljs';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec, isUniqueViolation } from '../common/dto';
import { NotificationsService } from '../notifications/notifications.service';
import { DbService } from '../db/db.service';
import { canSubmit, canTransition, REASON_REQUIRED } from './declaration-states';
import { assignReceipt, matchesMask, normalizeReceipt, receiptConfig } from './receipt.helpers';

export class CreateDeclarationDto {
  @IsUUID() id: string;                       // identifiant local stable (généré sur l'appareil)
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsOptional() @IsUUID() collector_id?: string;
  @IsUUID() producer_id: string;
  @IsUUID() value_chain_id: string;
  @IsUUID() campaign_id: string;
  @IsDateString() operation_date: string;
  @IsOptional() @IsInt() @Min(0) bags?: number;
  @Dec(3) quantity: string;
  @IsString() @Length(1, 20) unit: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  /** Numéro du reçu d'achat saisi par le délégué dès la déclaration (mode « physique »). */
  @IsOptional() @IsString() @Length(0, 40) purchase_receipt_no?: string;
}
export class ReceiptSettingsDto {
  @IsIn(['physical', 'generated']) mode: 'physical' | 'generated';
  @Matches(/^[A-Z0-9]{1,10}$/) series: string;
  @IsBoolean() required: boolean;
  @IsOptional() @IsString() @Length(1, 40) mask?: string;
  @IsOptional() @Matches(/^[A-Z0-9-]{1,10}$/) prefix?: string;
}
class ReceiptCorrectionDto {
  @IsString() @Length(1, 40) purchase_receipt_no: string;
  @IsString() @Length(3, 500) reason: string;
}
class ReceiptOverrideDto { @IsString() @Length(3, 500) reason: string; }
class TransitionDto {
  @IsString() to: string;
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

@ApiTags('déclarations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('purchase-declarations')
export class DeclarationsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private async history(c: PoolClient, orgId: string, id: string, from: string | null, to: string, reason: string | undefined, actor: string) {
    await c.query(
      `INSERT INTO purchase_declaration_history(organization_id, declaration_id, from_status, to_status, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, id, from, to, reason ?? null, actor]);
  }

  /** Délégué de l'utilisateur courant dans cette organisation (null s'il n'en a pas). */
  private async myCollector(c: PoolClient, userId: string) {
    const r = await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [userId]);
    return r.rows[0]?.id as string | undefined;
  }

  @Post()
  @RequirePermissions('declarations:create')
  async create(@Body() b: CreateDeclarationDto, @Req() req: any) {
    const canValidate = req.org.permissions.has('declarations:validate');
    try {
      const { row, replay } = await this.db.tx(req.org.id, async (c) => {
        // Rejeu d'une opération déjà reçue : on renvoie le résultat existant, sans doublon.
        const prev = await c.query(`SELECT * FROM purchase_declarations WHERE idempotency_key = $1`, [b.idempotency_key]);
        if (prev.rowCount) return { row: prev.rows[0], replay: true };

        const mine = await this.myCollector(c, req.user.id);
        const collectorId = canValidate && b.collector_id ? b.collector_id : mine;
        if (!collectorId) throw new ForbiddenException("Aucun compte délégué actif pour cet utilisateur dans cette organisation");
        if (b.collector_id && b.collector_id !== collectorId) throw new ForbiddenException('Déclaration pour un autre délégué non autorisée');

        const checks = await c.query(
          `SELECT
             (SELECT status FROM collectors WHERE id = $1) AS collector_status,
             EXISTS (SELECT 1 FROM producers WHERE id = $2 AND status = 'active') AS producer_ok,
             (SELECT status FROM campaigns WHERE id = $3 AND value_chain_id = $4) AS campaign_status,
             EXISTS (SELECT 1 FROM collector_assignments WHERE collector_id = $1 AND (value_chain_id IS NULL OR value_chain_id = $4)) AS assigned`,
          [collectorId, b.producer_id, b.campaign_id, b.value_chain_id]);
        const k = checks.rows[0];
        if (k.collector_status !== 'active') throw new BadRequestException('Délégué inconnu ou inactif');
        if (!k.producer_ok) throw new BadRequestException('Producteur inconnu ou inactif');
        if (k.campaign_status !== 'open') throw new BadRequestException('Campagne inconnue, fermée ou étrangère à la filière');
        if (!k.assigned) throw new ForbiddenException("Délégué non affecté à cette filière");

        // Numéro de reçu d'achat : saisi (mode physique) ou attribué (mode généré). Un doublon n'est pas écrasé :
        // la déclaration est enregistrée « en conflit » et ne peut être soumise ni validée avant résolution (CDC §13.4, §27.5).
        const cfg = await receiptConfig(c);
        const rc = await assignReceipt(c, req.org.id, req.user.id, b.purchase_receipt_no, cfg);
        const insertSql = `INSERT INTO purchase_declarations(id, organization_id, idempotency_key, collector_id, producer_id, value_chain_id, campaign_id,
                                              operation_date, bags, quantity, unit, notes, created_by,
                                              purchase_receipt_series, purchase_receipt_no, purchase_receipt_entered, purchase_receipt_source, receipt_conflict_with)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`;
        const args = (conflict: string | null) => [b.id, req.org.id, b.idempotency_key, collectorId, b.producer_id, b.value_chain_id, b.campaign_id,
           b.operation_date, b.bags ?? null, b.quantity, b.unit, b.notes ?? null, req.user.id, rc.series, rc.no, rc.entered, rc.source, conflict];
        await c.query('SAVEPOINT ins');
        let ins;
        try { ins = await c.query(insertSql, args(rc.conflictWith)); }
        catch (e: any) {
          // Course entre deux appareils sur le même numéro : on retombe sur le cas « conflit »
          if (!(isUniqueViolation(e) && String(e.constraint).includes('uq_decl_purchase_receipt'))) throw e;
          await c.query('ROLLBACK TO SAVEPOINT ins');
          const other = (await c.query(`SELECT id FROM purchase_declarations WHERE purchase_receipt_series = $1 AND purchase_receipt_no = $2 AND receipt_conflict_with IS NULL`, [rc.series, rc.no])).rows[0];
          ins = await c.query(insertSql, args(other.id));
        }
        await this.history(c, req.org.id, b.id, null, 'draft', undefined, req.user.id);
        if (ins.rows[0].receipt_conflict_with)
          await this.notif.notifyPermission(c, req.org.id, 'receipts:override', { kind: 'receipt_duplicate', severity: 'warning', title: `Numéro de reçu en doublon : ${ins.rows[0].purchase_receipt_no}`,
            body: 'La déclaration reste en conflit jusqu\'à résolution', entityType: 'purchase_declaration', entityId: b.id, dedupe: `receipt_duplicate:${b.id}` });
        return { row: ins.rows[0], replay: false };
      });
      if (!replay)
        await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.create', entityType: 'purchase_declaration', entityId: row.id });
      return { ...row, replayed: replay };
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Identifiant de déclaration déjà utilisé avec une autre clé d\'idempotence');
      throw e;
    }
  }

  // ---- Paramètres de numérotation des reçus d'achat ----
  @Get('settings/receipts')
  @RequirePermissions('declarations:read')
  settings(@Req() req: any) { return this.db.tx(req.org.id, (c) => receiptConfig(c)); }

  @Put('settings/receipts')
  @RequirePermissions('settings:receipts')
  async putSettings(@Body() b: ReceiptSettingsDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await receiptConfig(c);
      const known = (await c.query(`SELECT mode FROM purchase_receipt_series WHERE series = $1`, [b.series])).rows[0];
      if (known && known.mode !== b.mode)
        throw new ConflictException(`La série « ${b.series} » existe en mode « ${known.mode} » : une série ne mélange pas les deux modes, choisir un autre nom de série.`);
      return (await c.query(
        `INSERT INTO org_settings(organization_id, purchase_receipt_mode, purchase_receipt_series, purchase_receipt_required, purchase_receipt_mask, purchase_receipt_prefix, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id) DO UPDATE SET purchase_receipt_mode = EXCLUDED.purchase_receipt_mode, purchase_receipt_series = EXCLUDED.purchase_receipt_series,
           purchase_receipt_required = EXCLUDED.purchase_receipt_required, purchase_receipt_mask = EXCLUDED.purchase_receipt_mask,
           purchase_receipt_prefix = EXCLUDED.purchase_receipt_prefix, updated_at = now(), updated_by = EXCLUDED.updated_by
         RETURNING purchase_receipt_mode AS mode, purchase_receipt_series AS series, purchase_receipt_required AS required, purchase_receipt_mask AS mask, purchase_receipt_prefix AS prefix`,
        [req.org.id, b.mode, b.series, b.required, b.mask ?? null, b.prefix ?? 'RA', req.user.id])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'settings.purchase_receipts', entityType: 'org_settings', entityId: req.org.id, details: out });
    return out;
  }

  /**
   * Recherche d'une opération à partir du numéro de reçu d'achat : déclaration, pesées, réceptions, lots, paiements,
   * mouvements de caisse et écritures comptables liés (CDC §13.8). Réservée aux rôles autorisés (magasinier, finances).
   */
  @Get('search/by-receipt')
  @RequirePermissions('receipts:search')
  async searchByReceipt(@Query('number') number: string, @Req() req: any) {
    if (!number || number.trim().length < 2) throw new BadRequestException('Numéro de reçu requis (2 caractères minimum)');
    const no = normalizeReceipt(number);
    return this.db.tx(req.org.id, async (c) => {
      const decls = (await c.query(
        `SELECT d.id, d.purchase_receipt_series, d.purchase_receipt_no, d.purchase_receipt_entered, d.receipt_conflict_with, d.receipt_override_by,
                d.status, d.operation_date, d.quantity, d.unit, d.amount, d.currency, d.producer_id,
                p.internal_code AS producer_code, p.last_name || ' ' || p.first_names AS producer_name, d.collector_id
           FROM purchase_declarations d JOIN producers p ON p.id = d.producer_id
          WHERE d.purchase_receipt_no = $1 ORDER BY d.created_at LIMIT 20`, [no])).rows;
      const ids = decls.map((d: any) => d.id);
      if (!ids.length) return { number: no, declarations: [] };
      const q = async (sql: string) => (await c.query(sql, [ids])).rows;
      const weighings = await q(`SELECT id, declaration_id, status, net_kg, declared_kg, variance_kg, variance_pct, warehouse_id, weighed_at FROM weighings WHERE declaration_id = ANY($1)`);
      const receipts = await q(`SELECT r.id, r.number, r.declaration_id, r.lot_id, l.code AS lot_code, r.created_at FROM receipts r JOIN lots l ON l.id = r.lot_id WHERE r.declaration_id = ANY($1)`);
      const payments = await q(`SELECT id, status, amount, currency, method, reference_id, tx_id, entry_id FROM payments WHERE reference_type = 'purchase_declaration' AND reference_id = ANY($1)`);
      const payIds = payments.map((p: any) => p.id);
      const txs = (await c.query(
        `SELECT id, direction, amount, currency, reason, reference_type, reference_id, created_at FROM financial_transactions
          WHERE (reference_type = 'purchase_declaration' AND reference_id = ANY($1)) OR (reference_type = 'payment' AND reference_id = ANY($2))
          ORDER BY created_at`, [ids, payIds])).rows;
      const entries = (await c.query(
        `SELECT id, number, entry_date, label, reference_type, reference_id FROM accounting_entries
          WHERE (reference_type = 'purchase_declaration' AND reference_id = ANY($1)) OR (reference_type = 'payment' AND reference_id = ANY($2))
          ORDER BY created_at`, [ids, payIds])).rows;
      return { number: no, declarations: decls, weighings, receipts, payments, financial_transactions: txs, accounting_entries: entries };
    });
  }

  /**
   * Export Excel des achats déclarés (une ligne par achat). Mêmes règles de visibilité que la liste :
   * l'export est réservé au personnel (pas aux délégués). La disposition des colonnes est définie par COLUMNS (à ajuster au modèle de la coopérative).
   */
  @Get('export/xlsx')
  @RequirePermissions('declarations:read')
  async exportXlsx(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string) {
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) throw new BadRequestException('Dates attendues au format AAAA-MM-JJ');
    // L'export Excel est réservé au personnel de la coopérative : les délégués consultent leurs achats à l'écran, sans exporter.
    if (!req.org.permissions.has('declarations:validate')) throw new ForbiddenException('L\'export Excel est réservé au personnel de la coopérative.');
    const all = true;
    const rows = await this.db.tx(req.org.id, async (c) => {
      const mine = null;
      if (!all && !mine) return [];
      return (await c.query(
        `SELECT d.operation_date, p.internal_code, p.last_name, p.first_names, p.village, p.section, cu.full_name AS collector, d.bags, d.quantity, d.unit,
                CASE WHEN d.unit = 'kg' THEN d.quantity ELSE round(d.quantity * coalesce(f.factor, 0), 3) END AS weight_kg,
                d.purchase_receipt_no, d.unit_price, d.amount, d.status
           FROM purchase_declarations d
           JOIN producers p ON p.id = d.producer_id
           JOIN collectors k ON k.id = d.collector_id JOIN users cu ON cu.id = k.user_id
           LEFT JOIN unit_conversions f ON f.value_chain_id = d.value_chain_id AND f.from_unit = d.unit AND f.to_unit = 'kg'
          WHERE d.status <> 'draft' AND ($1::uuid IS NULL OR d.collector_id = $1) AND ($2::date IS NULL OR d.operation_date >= $2) AND ($3::date IS NULL OR d.operation_date <= $3)
            AND ($4::text IS NULL OR d.status = $4)
          ORDER BY d.operation_date, d.created_at`, [mine ?? null, from ?? null, to ?? null, status ?? null])).rows;
    });
    // Disposition du modèle « Tableau de l'État des achats » de la coopérative (Feuil1, A:I ; « Village » = section dans la base de la coopérative).
    // Le prix unitaire est fixé par l'administration (barème) ; le montant = poids net × prix unitaire.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Feuil1');
    const KG = '#,###\\ \\K\\g\\ \\ ', FCFA = '#,###\\ \\F\\ \\C\\F\\A';
    const COLUMNS: [string, string, number, string | undefined][] = [
      ['Date', 'date', 10.7, 'mm-dd-yy'], ['Code Producteur', 'code', 16, undefined], ['Nom & Prénoms', 'name', 41.1, undefined], ['Village', 'village', 22, undefined], ['N° Reçu', 'receipt', 19.9, undefined],
      ['Nbre sacs', 'bags', 14, '#,##0'], ['Poids Net', 'weight', 14.1, KG], ['Prix Unitaire', 'price', 12.9, FCFA], ['Montant', 'amount', 14.1, FCFA],
    ];
    ws.columns = COLUMNS.map(([header, key, width]) => ({ header, key, width }));
    const thin = { style: 'thin' as const };
    ws.getRow(1).eachCell((cell) => { cell.font = { bold: true, name: 'Calibri', size: 11 }; cell.alignment = { horizontal: 'center' }; cell.border = { left: thin, right: thin, top: thin, bottom: thin }; });
    for (const [, key, , fmt] of COLUMNS) if (fmt) ws.getColumn(key).numFmt = fmt;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of rows) ws.addRow({
      date: r.operation_date instanceof Date ? r.operation_date : new Date(`${String(r.operation_date).slice(0, 10)}T00:00:00Z`),
      code: r.internal_code, name: `${r.last_name} ${r.first_names}`, village: r.section ?? r.village, receipt: r.purchase_receipt_no, bags: r.bags,
      weight: r.weight_kg === null ? null : Number(r.weight_kg), price: r.unit_price === null ? null : Number(r.unit_price), amount: r.amount === null ? null : Number(r.amount),
    });
    const n = ws.rowCount;
    ws.autoFilter = { from: 'A1', to: 'I1' };
    const tot = ws.addRow({ name: 'TOTAL', bags: { formula: `SUM(F2:F${n})` }, weight: { formula: `SUM(G2:G${n})` }, amount: { formula: `SUM(I2:I${n})` } });
    tot.font = { bold: true };
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="Tableau_de_lEtat_des_achats.xlsx"',
    });
  }

  @Get()
  @RequirePermissions('declarations:read')
  list(@Req() req: any, @Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string, @Query('receipt_no') receiptNo?: string) {
    const all = req.org.permissions.has('declarations:validate');
    return this.db.tx(req.org.id, async (c) => {
      const mine = all ? null : await this.myCollector(c, req.user.id);
      if (!all && !mine) return [];
      return (await c.query(
        `SELECT d.id, d.collector_id, d.producer_id, pr.last_name || ' ' || pr.first_names AS producer_name,
                pr.internal_code AS producer_code, pr.section AS producer_section, pr.village AS producer_village, pr.phone AS producer_phone,
                coalesce(pr.area_ha, (SELECT sum(pc.declared_area_ha) FROM parcels pc WHERE pc.producer_id = pr.id AND pc.status = 'active')) AS producer_area_ha,
                pr.estimated_kg AS producer_estimated_kg,
                d.value_chain_id, d.campaign_id, d.operation_date, d.bags, d.quantity, d.unit,
                d.unit_price, d.currency, d.amount, d.status, d.status_reason, d.updated_at,
                d.purchase_receipt_series, d.purchase_receipt_no, d.receipt_conflict_with, d.receipt_override_by
           FROM purchase_declarations d LEFT JOIN producers pr ON pr.id = d.producer_id
          WHERE ($1::text IS NULL OR d.status = $1) AND ($2::uuid IS NULL OR d.collector_id = $2)
            AND ($5::text IS NULL OR d.purchase_receipt_no LIKE $5 || '%')
          ORDER BY d.operation_date DESC, d.created_at DESC LIMIT $3 OFFSET $4`,
        [status ?? null, mine ?? null, Math.min(Number(limit) || 50, 200), Number(offset) || 0, receiptNo ? normalizeReceipt(receiptNo).replace(/[%_\\]/g, '') : null])).rows;
    });
  }

  private async load(c: PoolClient, id: string, req: any, lock = false) {
    const r = await c.query(`SELECT * FROM purchase_declarations WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
    if (!r.rowCount) throw new NotFoundException();
    const d = r.rows[0];
    if (!req.org.permissions.has('declarations:validate')) {
      const mine = await this.myCollector(c, req.user.id);
      if (d.collector_id !== mine) throw new NotFoundException(); // les déclarations des autres restent invisibles
    }
    return d;
  }

  @Get(':id')
  @RequirePermissions('declarations:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req);
      const h = await c.query(`SELECT from_status, to_status, reason, actor_user_id, created_at FROM purchase_declaration_history WHERE declaration_id = $1 ORDER BY id`, [id]);
      return { ...d, history: h.rows };
    });
  }

  /**
   * Soumission : le serveur retient le prix applicable à la date de l'opération et calcule le montant
   * (arithmétique décimale exacte en base). Ce prix reste attaché à la déclaration même si le barème change ensuite.
   */
  @Post(':id/submit')
  @RequirePermissions('declarations:create')
  async submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req, true);
      if (!canSubmit(d.status)) throw new BadRequestException(`Soumission impossible depuis l'état « ${d.status} »`);
      if (d.receipt_conflict_with && !d.receipt_override_by)
        throw new ConflictException(`Numéro de reçu ${d.purchase_receipt_no} déjà utilisé : corriger le numéro ou obtenir une exception autorisée avant de soumettre`);
      if (!d.purchase_receipt_no && (await receiptConfig(c)).required)
        throw new BadRequestException("Le numéro du reçu d'achat est obligatoire avant la soumission");

      // Prix officiel du produit rattaché à la filière (fixé par l'administrateur), s'il existe : prioritaire sur le barème.
      const prod = (await c.query(`SELECT id FROM products WHERE value_chain_id = $1 AND active ORDER BY created_at LIMIT 1`, [d.value_chain_id])).rows[0];
      const official = prod ? await effectiveBuyPrice(c, prod.id, d.campaign_id) : null;
      if (official != null && Number(official) > 0) {
        let f = '1';
        if (String(d.unit).toLowerCase() !== 'kg') {
          const cv = await c.query(`SELECT factor FROM unit_conversions WHERE value_chain_id = $1 AND from_unit = $2 AND to_unit = 'kg'`, [d.value_chain_id, d.unit]);
          f = cv.rowCount ? cv.rows[0].factor : '';
        }
        if (f !== '') {
          const upo = await c.query(
            `UPDATE purchase_declarations
                SET price_version_id = NULL, unit_price = $2, currency = 'XOF',
                    amount = round($3::numeric * $4::numeric * $2::numeric, 4),
                    status = 'received', status_reason = NULL, updated_at = now(), updated_by = $5, version = version + 1
              WHERE id = $1 RETURNING *`, [id, official, d.quantity, f, req.user.id]);
          await this.history(c, req.org.id, id, d.status, 'received', undefined, req.user.id);
          return upo.rows[0];
        }
      }
      const p = await c.query(
        `SELECT v.id AS version_id, v.unit_price, s.currency, s.unit AS price_unit
           FROM price_schedules s JOIN price_versions v ON v.schedule_id = s.id
          WHERE s.value_chain_id = $1 AND s.campaign_id = $2 AND s.status = 'active'
            AND v.valid_from <= $3 AND (v.valid_to IS NULL OR v.valid_to >= $3)
          ORDER BY (s.unit = $4) DESC, v.valid_from DESC, v.version_no DESC LIMIT 1`,
        [d.value_chain_id, d.campaign_id, d.operation_date, d.unit]);
      if (!p.rowCount) throw new UnprocessableEntityException('Aucun prix applicable à cette date pour cette filière et campagne');
      const price = p.rows[0];

      let factor = '1';
      if (price.price_unit !== d.unit) {
        const f = await c.query(
          `SELECT factor FROM unit_conversions WHERE value_chain_id = $1 AND from_unit = $2 AND to_unit = $3`,
          [d.value_chain_id, d.unit, price.price_unit]);
        if (!f.rowCount) throw new UnprocessableEntityException(`Conversion ${d.unit} → ${price.price_unit} non configurée`);
        factor = f.rows[0].factor;
      }
      const up = await c.query(
        `UPDATE purchase_declarations
            SET price_version_id = $2, unit_price = $3, currency = $4,
                amount = round($5::numeric * $6::numeric * $3::numeric, 4),
                status = 'received', status_reason = NULL, updated_at = now(), updated_by = $7, version = version + 1
          WHERE id = $1 RETURNING *`,
        [id, price.version_id, price.unit_price, price.currency, d.quantity, factor, req.user.id]);
      await this.history(c, req.org.id, id, d.status, 'received', undefined, req.user.id);
      return up.rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.submit', entityType: 'purchase_declaration', entityId: id, details: { amount: row.amount } });
    return row;
  }

  @Post(':id/transition')
  @RequirePermissions('declarations:validate')
  async transition(@Param('id', ParseUUIDPipe) id: string, @Body() b: TransitionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req, true);
      if (!canTransition(d.status, b.to)) throw new BadRequestException(`Transition « ${d.status} » → « ${b.to} » interdite`);
      if (REASON_REQUIRED.has(b.to) && !b.reason) throw new BadRequestException('Un motif est obligatoire');
      if (b.to === 'accepted' && d.receipt_conflict_with && !d.receipt_override_by)
        throw new ConflictException(`Validation bloquée : numéro de reçu ${d.purchase_receipt_no} en doublon, non résolu`);
      const up = await c.query(
        `UPDATE purchase_declarations SET status = $2, status_reason = $3, updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, b.to, b.reason ?? null, req.user.id]);
      await this.history(c, req.org.id, id, d.status, b.to, b.reason, req.user.id);
      return up.rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.transition', entityType: 'purchase_declaration', entityId: id, details: { to: b.to } });
    return row;
  }

  /** Correction du numéro saisi (valeur d'origine conservée ; auteur, date et motif consignés). */
  @Post(':id/receipt-number')
  @RequirePermissions('receipts:correct')
  async correctReceipt(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReceiptCorrectionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req, true);
      if (['cancelled', 'rejected'].includes(d.status)) throw new BadRequestException(`Correction impossible : déclaration « ${d.status} »`);
      if (d.purchase_receipt_source === 'generated') throw new BadRequestException('Un numéro généré par AgriTrace ne se corrige pas');
      const cfg = await receiptConfig(c);
      if (cfg.mode !== 'physical') throw new BadRequestException('La série courante est en mode « généré »');
      const no = normalizeReceipt(b.purchase_receipt_no);
      if (!matchesMask(no, cfg.mask)) throw new BadRequestException(`Format invalide : attendu « ${cfg.mask} »`);
      const other = (await c.query(
        `SELECT id FROM purchase_declarations WHERE purchase_receipt_series = $1 AND purchase_receipt_no = $2 AND receipt_conflict_with IS NULL AND id <> $3`, [cfg.series, no, id])).rows[0];
      if (other) throw new ConflictException({ message: `Numéro ${no} déjà utilisé`, conflicting_declaration_id: other.id });
      await c.query(
        `INSERT INTO purchase_receipt_corrections(organization_id, declaration_id, kind, old_series, old_no, new_series, new_no, reason, actor_user_id)
         VALUES ($1,$2,'correction',$3,$4,$5,$6,$7,$8)`, [req.org.id, id, d.purchase_receipt_series, d.purchase_receipt_no, cfg.series, no, b.reason, req.user.id]);
      return (await c.query(
        `UPDATE purchase_declarations SET purchase_receipt_series = $2, purchase_receipt_no = $3, purchase_receipt_source = 'physical',
                purchase_receipt_entered = coalesce(purchase_receipt_entered, $3), receipt_conflict_with = NULL, receipt_override_by = NULL, receipt_override_reason = NULL,
                updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1 RETURNING *`, [id, cfg.series, no, req.user.id])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.receipt_correct', entityType: 'purchase_declaration', entityId: id, details: { purchase_receipt_no: row.purchase_receipt_no, reason: b.reason } });
    return row;
  }

  /** Exception expresse et auditée : accepter un doublon de numéro (ex. reçu papier réellement émis deux fois). */
  @Post(':id/receipt-override')
  @RequirePermissions('receipts:override')
  async overrideReceipt(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReceiptOverrideDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req, true);
      if (!d.receipt_conflict_with) throw new BadRequestException('Aucun conflit de numéro sur cette déclaration');
      await c.query(
        `INSERT INTO purchase_receipt_corrections(organization_id, declaration_id, kind, old_series, old_no, new_series, new_no, reason, actor_user_id)
         VALUES ($1,$2,'duplicate_exception',$3,$4,$3,$4,$5,$6)`, [req.org.id, id, d.purchase_receipt_series, d.purchase_receipt_no, b.reason, req.user.id]);
      return (await c.query(
        `UPDATE purchase_declarations SET receipt_override_by = $2, receipt_override_reason = $3, updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, req.user.id, b.reason])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.receipt_override', entityType: 'purchase_declaration', entityId: id, details: { reason: b.reason } });
    return row;
  }
}
