import { BadRequestException, Controller, Get, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import * as ExcelJS from 'exceljs';
import { RequirePermissions } from '../access/decorators';
import { DbService } from '../db/db.service';

const GROUPS: Record<string, { sel: string; label: string }> = {
  section: { sel: `coalesce(nullif(p.section, ''), 'Sans section')`, label: 'Section' },
  collector: { sel: `cu.full_name`, label: 'Délégué' },
  chain: { sel: `vc.name`, label: 'Filière' },
  day: { sel: `to_char(d.operation_date, 'YYYY-MM-DD')`, label: 'Jour' },
  village: { sel: `coalesce(nullif(p.village, ''), 'Sans village')`, label: 'Village' },
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('reports')
export class ReportsController {
  constructor(private readonly db: DbService) {}

  /** Achats déclarés (hors brouillons, rejets et annulations), regroupés selon `group`, filtrables par période, section, délégué et filière. */
  private async purchases(orgId: string, q: Record<string, string | undefined>) {
    const g = GROUPS[q.group ?? 'section'];
    if (!g) throw new BadRequestException('Regroupement inconnu');
    for (const k of ['from', 'to']) if (q[k] && !DATE.test(q[k]!)) throw new BadRequestException('Dates attendues au format AAAA-MM-JJ');
    const rows = await this.db.tx(orgId, async (c) => (await c.query(
      `SELECT ${g.sel} AS key, count(*)::int AS declarations, coalesce(sum(d.bags),0)::int AS bags,
              coalesce(sum(CASE WHEN d.unit = 'kg' THEN d.quantity ELSE d.quantity * coalesce(f.factor, 0) END),0)::numeric(18,3) AS kg,
              coalesce(sum(d.amount),0)::numeric(18,2) AS amount
         FROM purchase_declarations d
         JOIN producers p ON p.id = d.producer_id
         JOIN collectors k ON k.id = d.collector_id JOIN users cu ON cu.id = k.user_id
         JOIN value_chains vc ON vc.id = d.value_chain_id
         LEFT JOIN unit_conversions f ON f.value_chain_id = d.value_chain_id AND f.from_unit = d.unit AND f.to_unit = 'kg'
        WHERE d.status NOT IN ('draft','rejected','cancelled')
          AND ($1::date IS NULL OR d.operation_date >= $1) AND ($2::date IS NULL OR d.operation_date <= $2)
          AND ($3::text IS NULL OR coalesce(nullif(p.section,''),'Sans section') = $3)
          AND ($4::uuid IS NULL OR d.collector_id = $4) AND ($5::uuid IS NULL OR d.value_chain_id = $5)
        GROUP BY 1 ORDER BY 1`,
      [q.from ?? null, q.to ?? null, q.section || null, q.collector_id || null, q.chain_id || null])).rows);
    const total = rows.reduce((a, r) => ({ declarations: a.declarations + r.declarations, bags: a.bags + r.bags, kg: a.kg + Number(r.kg), amount: a.amount + Number(r.amount) }), { declarations: 0, bags: 0, kg: 0, amount: 0 });
    return { group: q.group ?? 'section', group_label: g.label, rows: rows.map((r) => ({ ...r, kg: Number(r.kg), amount: Number(r.amount) })), total };
  }

  @Get('purchases')
  @RequirePermissions('reports:read')
  list(@Req() req: any, @Query() q: Record<string, string>) { return this.purchases(req.org.id, q); }

  /** Listes pour les filtres (sections, délégués, filières). */
  @Get('filters')
  @RequirePermissions('reports:read')
  async filters(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => ({
      sections: (await c.query(`SELECT DISTINCT section FROM producers WHERE section IS NOT NULL AND section <> '' ORDER BY 1`)).rows.map((r) => r.section),
      collectors: (await c.query(`SELECT k.id, cu.full_name AS name FROM collectors k JOIN users cu ON cu.id = k.user_id ORDER BY 2`)).rows,
      chains: (await c.query(`SELECT id, name FROM value_chains ORDER BY name`)).rows,
    }));
  }

  @Get('purchases/xlsx')
  @RequirePermissions('reports:read')
  async xlsx(@Req() req: any, @Query() q: Record<string, string>) {
    const r = await this.purchases(req.org.id, q);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Rapport');
    ws.columns = [{ header: r.group_label, key: 'key', width: 30 }, { header: 'Achats', key: 'declarations', width: 10 }, { header: 'Nbre sacs', key: 'bags', width: 12 }, { header: 'Poids Net', key: 'kg', width: 16 }, { header: 'Montant', key: 'amount', width: 18 }];
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const x of r.rows) ws.addRow(x);
    const n = ws.rowCount;
    ws.addRow({ key: 'TOTAL', declarations: { formula: `SUM(B2:B${n})` }, bags: { formula: `SUM(C2:C${n})` }, kg: { formula: `SUM(D2:D${n})` }, amount: { formula: `SUM(E2:E${n})` } }).font = { bold: true };
    ws.getColumn('kg').numFmt = '#,##0.000" Kg"'; ws.getColumn('amount').numFmt = '#,##0" F CFA"';
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="Rapport_des_achats.xlsx"' });
  }

  /** Fichier Excel d'un rapport (même contenu que les routes `…/xlsx`), pour l'envoi programmé. */
  async buildXlsx(kind: 'purchases' | 'finance' | 'stock' | 'quality', orgId: string, q: Record<string, string>): Promise<{ filename: string; buffer: Buffer }> {
    const req = { org: { id: orgId } };
    const f = kind === 'purchases' ? await this.xlsx(req, q) : kind === 'finance' ? await this.financeXlsx(req, q) : kind === 'stock' ? await this.stockXlsx(req, q) : await this.qualityXlsx(req, q);
    const chunks: Buffer[] = [];
    for await (const ch of f.getStream()) chunks.push(Buffer.from(ch as any));
    const name = /filename="([^"]+)"/.exec(String(f.getHeaders().disposition ?? ''))?.[1] ?? `Rapport_${kind}.xlsx`;
    return { filename: name, buffer: Buffer.concat(chunks) };
  }

  // ---------- Rapports unifiés : finance, stock, qualité (CDC §26) ----------
  private period(q: Record<string, string | undefined>) {
    for (const k of ['from', 'to']) if (q[k] && !DATE.test(q[k]!)) throw new BadRequestException('Dates attendues au format AAAA-MM-JJ');
    return [q.from || null, q.to || null] as const;
  }

  /** Finance : mouvements par compte sur la période, créances clients, dettes envers les délégués, préfinancements à rembourser. */
  private async finance(orgId: string, q: Record<string, string | undefined>) {
    const [f, t] = this.period(q);
    return this.db.tx(orgId, async (c) => {
      const accounts = (await c.query(
        `SELECT a.name, a.owner_type, a.currency,
                coalesce(sum(CASE WHEN x.direction = 'in' AND ($1::date IS NULL OR x.created_at >= $1) AND ($2::date IS NULL OR x.created_at < $2::date + 1) THEN x.amount END), 0)::numeric(18,2) AS inflow,
                coalesce(sum(CASE WHEN x.direction = 'out' AND ($1::date IS NULL OR x.created_at >= $1) AND ($2::date IS NULL OR x.created_at < $2::date + 1) THEN x.amount END), 0)::numeric(18,2) AS outflow,
                coalesce(sum(CASE x.direction WHEN 'in' THEN x.amount ELSE -x.amount END), 0)::numeric(18,2) AS balance
           FROM financial_accounts a LEFT JOIN financial_transactions x ON x.account_id = a.id
          WHERE a.owner_type IN ('cash_register','other') AND a.status = 'active' GROUP BY a.id ORDER BY a.name`, [f, t])).rows;
      const sales = (await c.query(
        `SELECT coalesce(sum(i.total) FILTER (WHERE i.status <> 'cancelled' AND ($1::date IS NULL OR i.issue_date >= $1) AND ($2::date IS NULL OR i.issue_date <= $2)), 0)::numeric(18,2) AS invoiced,
                coalesce(sum(i.total - coalesce(p.paid,0) - coalesce(n.credited,0)) FILTER (WHERE i.status IN ('issued','partially_paid')), 0)::numeric(18,2) AS receivable,
                coalesce(sum(i.total - coalesce(p.paid,0) - coalesce(n.credited,0)) FILTER (WHERE i.status IN ('issued','partially_paid') AND i.due_date < current_date), 0)::numeric(18,2) AS overdue
           FROM invoices i
           LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM invoice_payments GROUP BY 1) p ON p.invoice_id = i.id
           LEFT JOIN (SELECT invoice_id, sum(amount) AS credited FROM credit_notes GROUP BY 1) n ON n.invoice_id = i.id`, [f, t])).rows[0];
      const credited = (await c.query(`SELECT coalesce(sum(amount),0)::numeric(18,2) AS v FROM credit_notes WHERE ($1::date IS NULL OR issued_on >= $1) AND ($2::date IS NULL OR issued_on <= $2)`, [f, t])).rows[0].v;
      const collectors = (await c.query(
        `SELECT cu.full_name AS name,
                coalesce(sum(CASE x.direction WHEN 'in' THEN x.amount ELSE -x.amount END), 0)::numeric(18,2) AS owed_to_collector
           FROM collectors k JOIN users cu ON cu.id = k.user_id
           JOIN financial_accounts a ON a.owner_type = 'collector' AND a.owner_id = k.id
           LEFT JOIN financial_transactions x ON x.account_id = a.id GROUP BY cu.full_name ORDER BY cu.full_name`)).rows;
      const pref = (await c.query(
        `SELECT p.currency, coalesce(sum(p.amount - coalesce(r.v,0)),0)::numeric(18,2) AS outstanding
           FROM prefinancings p LEFT JOIN (SELECT prefinancing_id, sum(amount) AS v FROM prefinancing_repayments GROUP BY 1) r ON r.prefinancing_id = p.id
          WHERE p.status = 'active' GROUP BY p.currency`)).rows;
      return { period: { from: f, to: t }, accounts, sales: { ...sales, credited }, collectors, prefinancing: pref,
        totals: { treasury: accounts.reduce((a: number, r: any) => a + Number(r.balance), 0).toFixed(2), owed_to_collectors: collectors.reduce((a: number, r: any) => a + Math.max(0, Number(r.owed_to_collector)), 0).toFixed(2) } };
    });
  }

  /** Stock : solde par entrepôt et filière, flux de la période par type de mouvement. */
  private async stock(orgId: string, q: Record<string, string | undefined>) {
    const [f, t] = this.period(q);
    return this.db.tx(orgId, async (c) => {
      const balances = (await c.query(
        `SELECT w.name AS warehouse, vc.name AS chain, count(DISTINCT m.lot_id)::int AS lots,
                coalesce(sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END), 0)::numeric(18,3) AS kg
           FROM warehouse_movements m JOIN warehouses w ON w.id = m.warehouse_id JOIN lots l ON l.id = m.lot_id JOIN value_chains vc ON vc.id = l.value_chain_id
          GROUP BY w.name, vc.name HAVING sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) <> 0 ORDER BY 1, 2`)).rows;
      const flows = (await c.query(
        `SELECT m.movement_type AS type, m.direction, count(*)::int AS movements, sum(m.quantity_kg)::numeric(18,3) AS kg
           FROM warehouse_movements m WHERE ($1::date IS NULL OR m.occurred_at >= $1) AND ($2::date IS NULL OR m.occurred_at < $2::date + 1)
          GROUP BY 1, 2 ORDER BY 2 DESC, 1`, [f, t])).rows;
      const losses = (await c.query(
        `SELECT coalesce(sum(quantity_kg) FILTER (WHERE movement_type = 'loss'), 0)::numeric(18,3) AS loss_kg FROM warehouse_movements
          WHERE ($1::date IS NULL OR occurred_at >= $1) AND ($2::date IS NULL OR occurred_at < $2::date + 1)`, [f, t])).rows[0];
      return { period: { from: f, to: t }, balances, flows, totals: { kg: balances.reduce((a: number, r: any) => a + Number(r.kg), 0), loss_kg: Number(losses.loss_kg) } };
    });
  }

  /** Qualité : inspections de la période par nature et résultat, règles les plus souvent en échec. */
  private async quality(orgId: string, q: Record<string, string | undefined>) {
    const [f, t] = this.period(q);
    return this.db.tx(orgId, async (c) => {
      const inspections = (await c.query(
        `SELECT i.kind, coalesce(i.outcome, 'pending') AS outcome, count(*)::int AS n
           FROM inspections i WHERE i.status <> 'cancelled' AND ($1::date IS NULL OR coalesce(i.completed_at, i.created_at) >= $1) AND ($2::date IS NULL OR coalesce(i.completed_at, i.created_at) < $2::date + 1)
          GROUP BY 1, 2 ORDER BY 1, 2`, [f, t])).rows;
      const failing = (await c.query(
        `SELECT r.rule_code AS code, r.rule_label AS label, bool_or(r.blocking) AS blocking, count(*)::int AS failures
           FROM inspection_results r JOIN inspections i ON i.id = r.inspection_id
          WHERE r.passed = false AND ($1::date IS NULL OR r.recorded_at >= $1) AND ($2::date IS NULL OR r.recorded_at < $2::date + 1)
          GROUP BY 1, 2 ORDER BY failures DESC, 1 LIMIT 20`, [f, t])).rows;
      const total = inspections.reduce((a: number, r: any) => a + r.n, 0);
      const ok = inspections.filter((r: any) => r.outcome === 'compliant').reduce((a: number, r: any) => a + r.n, 0);
      return { period: { from: f, to: t }, inspections, failing_rules: failing, totals: { inspections: total, compliant: ok, rate: total ? Math.round((ok / total) * 1000) / 10 : null } };
    });
  }

  /** Journal d'approvisionnement : réceptions au magasin sur la période, par délégué, avec totaux (poids net, sacs, montants, retenues par type de prélèvement). */
  private async supply(orgId: string, q: Record<string, string | undefined>) {
    for (const k of ['from', 'to']) if (q[k] && !DATE.test(q[k]!)) throw new BadRequestException('Dates attendues au format AAAA-MM-JJ');
    const rows = (await this.db.tx(orgId, async (c) => (await c.query(
      `SELECT r.id, r.bulletin_no, v.convoy_no, r.received_at::date AS date, u.full_name AS collector, (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS collector_code,
              coalesce(p.name, '') AS product, r.bags, r.total_kg::numeric(18,3) AS kg, r.unit_price, r.gross_amount, r.transport_total, r.retention_amount,
              coalesce(r.retention_type, k.retention_type) AS retention_type, r.amount AS net_paid, r.status
         FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
         LEFT JOIN products p ON p.id = r.product_id
        WHERE ($1::date IS NULL OR r.received_at::date >= $1) AND ($2::date IS NULL OR r.received_at::date <= $2)
          AND ($3::uuid IS NULL OR v.collector_id = $3)
        ORDER BY r.received_at, r.bulletin_no`, [q.from ?? null, q.to ?? null, q.collector_id || null])).rows)).map((r: any) => ({
      ...r, kg: Number(r.kg), unit_price: r.unit_price == null ? null : Number(r.unit_price), gross_amount: Number(r.gross_amount ?? 0), transport_total: Number(r.transport_total ?? 0),
      retention_amount: Number(r.retention_amount ?? 0), net_paid: r.status === 'settled' ? Number(r.net_paid ?? 0) : 0 }));
    const sum = (xs: any[]) => ({ receptions: xs.length, bags: xs.reduce((a, r) => a + (r.bags ?? 0), 0), kg: xs.reduce((a, r) => a + r.kg, 0), gross: xs.reduce((a, r) => a + r.gross_amount, 0),
      transport: xs.reduce((a, r) => a + r.transport_total, 0), retention: xs.reduce((a, r) => a + r.retention_amount, 0), net_paid: xs.reduce((a, r) => a + r.net_paid, 0) });
    const byCollector = [...new Set(rows.map((r: any) => r.collector))].map((name) => ({ collector: name, ...sum(rows.filter((r: any) => r.collector === name)) }));
    const byType: Record<string, number> = {};
    for (const r of rows) if (r.retention_amount) byType[r.retention_type ?? 'mise_en_compte'] = (byType[r.retention_type ?? 'mise_en_compte'] ?? 0) + r.retention_amount;
    return { period: { from: q.from ?? null, to: q.to ?? null }, rows, by_collector: byCollector, retention_by_type: byType, total: sum(rows) };
  }
  @Get('supply') @RequirePermissions('reports:read', 'convoys:read')
  supplyReport(@Req() req: any, @Query() q: Record<string, string>) { return this.supply(req.org.id, q); }
  @Get('supply/xlsx') @RequirePermissions('reports:read', 'convoys:read')
  async supplyXlsx(@Req() req: any, @Query() q: Record<string, string>) {
    const r = await this.supply(req.org.id, q);
    return this.sheet([
      { title: 'Journal', cols: [['Date', 'date'], ['Bulletin', 'bulletin_no', 20], ['Connaissement', 'convoy_no', 22], ['Délégué', 'collector', 28], ['Produit', 'product'], ['Sacs', 'bags'], ['Poids net (kg)', 'kg'], ['P.U.', 'unit_price'], ['Montant brut', 'gross_amount'], ['Transport', 'transport_total'], ['Retenue', 'retention_amount'], ['Type de prélèvement', 'retention_type', 22], ['Net payé', 'net_paid']], rows: r.rows },
      { title: 'Par délégué', cols: [['Délégué', 'collector', 28], ['Réceptions', 'receptions'], ['Sacs', 'bags'], ['Poids net (kg)', 'kg'], ['Montant brut', 'gross'], ['Transport', 'transport'], ['Retenue', 'retention'], ['Net payé', 'net_paid']], rows: r.by_collector },
    ], 'Journal_approvisionnement.xlsx');
  }

  @Get('finance') @RequirePermissions('reports:read', 'finance:read')
  financeReport(@Req() req: any, @Query() q: Record<string, string>) { return this.finance(req.org.id, q); }
  @Get('stock') @RequirePermissions('reports:read', 'warehouses:read')
  stockReport(@Req() req: any, @Query() q: Record<string, string>) { return this.stock(req.org.id, q); }
  @Get('quality') @RequirePermissions('reports:read', 'quality:read')
  qualityReport(@Req() req: any, @Query() q: Record<string, string>) { return this.quality(req.org.id, q); }

  private async sheet(parts: { title: string; cols: [string, string, number?][]; rows: any[] }[], name: string) {
    const wb = new ExcelJS.Workbook();
    for (const p of parts) {
      const ws = wb.addWorksheet(p.title);
      ws.columns = p.cols.map(([header, key, width]) => ({ header, key, width: width ?? 18 }));
      ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const r of p.rows) ws.addRow(r);
    }
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="${name}"` });
  }
  @Get('finance/xlsx') @RequirePermissions('reports:read', 'finance:read')
  async financeXlsx(@Req() req: any, @Query() q: Record<string, string>) {
    const r = await this.finance(req.org.id, q);
    return this.sheet([
      { title: 'Comptes', cols: [['Compte', 'name', 32], ['Type', 'owner_type'], ['Entrées', 'inflow'], ['Sorties', 'outflow'], ['Solde', 'balance']], rows: r.accounts },
      { title: 'Ventes', cols: [['Facturé (période)', 'invoiced'], ['Créances à encaisser', 'receivable'], ['Dont échues', 'overdue'], ['Avoirs (période)', 'credited']], rows: [r.sales] },
      { title: 'Délégués', cols: [['Délégué', 'name', 32], ['Dû au délégué (net des avances)', 'owed_to_collector', 34]], rows: r.collectors },
      { title: 'Préfinancement', cols: [['Devise', 'currency'], ['Reste à rembourser', 'outstanding']], rows: r.prefinancing },
    ], 'Rapport_financier.xlsx');
  }
  @Get('stock/xlsx') @RequirePermissions('reports:read', 'warehouses:read')
  async stockXlsx(@Req() req: any, @Query() q: Record<string, string>) {
    const r = await this.stock(req.org.id, q);
    return this.sheet([
      { title: 'Soldes', cols: [['Entrepôt', 'warehouse', 28], ['Filière', 'chain', 22], ['Lots', 'lots', 10], ['Stock (kg)', 'kg']], rows: r.balances },
      { title: 'Flux', cols: [['Type', 'type', 22], ['Sens', 'direction', 10], ['Mouvements', 'movements'], ['Quantité (kg)', 'kg']], rows: r.flows },
    ], 'Rapport_stock.xlsx');
  }
  @Get('quality/xlsx') @RequirePermissions('reports:read', 'quality:read')
  async qualityXlsx(@Req() req: any, @Query() q: Record<string, string>) {
    const r = await this.quality(req.org.id, q);
    return this.sheet([
      { title: 'Inspections', cols: [['Nature', 'kind'], ['Résultat', 'outcome'], ['Nombre', 'n']], rows: r.inspections },
      { title: 'Règles en échec', cols: [['Code', 'code'], ['Règle', 'label', 36], ['Bloquante', 'blocking'], ['Échecs', 'failures']], rows: r.failing_rules },
    ], 'Rapport_qualite.xlsx');
  }
}
