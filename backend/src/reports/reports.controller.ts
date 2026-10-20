import { BadRequestException, Controller, Get, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import * as ExcelJS from 'exceljs';
import { RequirePermissions } from '../access/decorators';
import { DbService } from '../db/db.service';

const GROUPS: Record<string, { sel: string; label: string }> = {
  section: { sel: `coalesce(nullif(p.section, ''), 'Sans section')`, label: 'Section' },
  collector: { sel: `cu.full_name`, label: 'Collecteur' },
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

  /** Achats déclarés (hors brouillons, rejets et annulations), regroupés selon `group`, filtrables par période, section, collecteur et filière. */
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

  /** Listes pour les filtres (sections, collecteurs, filières). */
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
}
