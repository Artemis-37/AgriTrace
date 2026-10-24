import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, StreamableFile, UnprocessableEntityException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { createHash } from 'node:crypto';
import ExcelJS = require('exceljs');
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FICHE_TEMPLATE_B64 } from './template';
import { nextDeliveryNumber } from '../deliveries/deliveries.controller';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const FIRST_ROW = 18, LAST_ROW = 343, TOTAL_ROW = 344;           // capacité du modèle : 326 producteurs par fiche
export const CERTIFICATIONS = ['Cocoa Life', 'Ferrero', 'UTZ', 'Fairtrade', 'FT USA', 'Rainforest Alliance', 'COCOA PRACTICES', 'Atsource +', 'SASSANDRA']; // lignes 5 à 13 du modèle

export interface SheetLine { n: number; name: string; gender: string; section: string; code: string; delivered_on: string | null; kg: number; bags: number; receipt: string; convoy_no?: string }

export class CreateSheetDto {
  @IsArray() @IsUUID('4', { each: true }) convoy_ids: string[];
  @IsOptional() @IsString() @Length(0, 120) driver_name?: string;
  @IsOptional() @IsString() @Length(0, 40) truck_no?: string;
  @IsOptional() @IsString() @Length(0, 40) trailer_no?: string;
  @IsOptional() @IsString() @Length(0, 80) lot_id_dse?: string;
  @IsOptional() @IsString() @Length(0, 80) bl_no?: string;
  @IsOptional() @IsISO8601({ strict: true }) departure_date?: string;
  @IsOptional() @IsIn(['ordinaire', 'certifie']) cocoa_type?: string;
  @IsOptional() @IsArray() @IsIn(CERTIFICATIONS, { each: true }) certifications?: string[];
  @IsOptional() @IsString() @Length(0, 120) other_certification?: string;
  @IsOptional() @IsString() @Length(0, 120) adg_name?: string;
  @IsOptional() @IsString() @Length(0, 120) warehouse_keeper_name?: string;
}
export class TransmitDto { @IsOptional() @IsUUID() exporter_user_id?: string; @IsOptional() @IsUUID() destination_org_id?: string; }

/** Lignes (un producteur par achat) d'un ou plusieurs convois reçus. Le poids net livré répartit le poids net pesé au magasin au prorata des quantités déclarées. */
async function convoyLines(c: PoolClient, ids: string[]) {
  if (!ids.length) throw new BadRequestException('Choisissez au moins un convoi');
  const cv = (await c.query(
    `SELECT v.id, v.convoy_no, v.driver_name, v.truck_no, v.trailer_no, v.declared_kg, v.declared_bags, v.status,
            r.total_kg AS net_kg, r.bags AS recv_bags, r.received_at::date::text AS delivered_on
       FROM convoys v LEFT JOIN convoy_receptions r ON r.convoy_id = v.id WHERE v.id = ANY($1::uuid[]) ORDER BY r.received_at, v.convoy_no`, [ids])).rows;
  if (cv.length !== new Set(ids).size) throw new NotFoundException('Convoi introuvable');
  const open = cv.filter((v) => v.net_kg == null);
  if (open.length) throw new UnprocessableEntityException(`Convoi non réceptionné au magasin : ${open.map((v) => v.convoy_no).join(', ')}. Une fiche d'accompagnement ne porte que sur des convois pesés.`);
  const lines: SheetLine[] = [];
  for (const v of cv) {
    const d = (await c.query(
      `SELECT x.kg, x.bags, p.last_name, p.first_names, p.gender, p.section, p.internal_code,
              nullif(concat_ws('-', nullif(d.purchase_receipt_series, ''), d.purchase_receipt_no), '') AS receipt
         FROM convoy_declarations x JOIN purchase_declarations d ON d.id = x.declaration_id JOIN producers p ON p.id = d.producer_id
        WHERE x.convoy_id = $1 ORDER BY p.last_name, p.first_names, d.operation_date`, [v.id])).rows;
    if (!d.length) throw new UnprocessableEntityException(`Le convoi ${v.convoy_no} n'est lié à aucune déclaration d'achat : aucun producteur à lister.`);
    const sum = d.reduce((s, x) => s + Number(x.kg), 0);
    let left = Math.round(Number(v.net_kg) * 1000);
    d.forEach((x, i) => {
      const part = i === d.length - 1 ? left : Math.round(Number(v.net_kg) * 1000 * Number(x.kg) / (sum || 1));
      left -= part;
      lines.push({ n: 0, name: `${x.last_name} ${x.first_names}`.trim(), gender: x.gender === 'male' ? 'M' : x.gender === 'female' ? 'F' : '', section: x.section ?? '', code: x.internal_code,
        delivered_on: v.delivered_on, kg: part / 1000, bags: Number(x.bags ?? 0), receipt: x.receipt ?? '', convoy_no: v.convoy_no });
    });
  }
  lines.forEach((l, i) => { l.n = i + 1; });
  if (lines.length > LAST_ROW - FIRST_ROW + 1) throw new UnprocessableEntityException(`Le modèle de fiche contient ${LAST_ROW - FIRST_ROW + 1} lignes au plus : ce chargement en compte ${lines.length}. Répartissez les convois sur deux fiches.`);
  return { convoys: cv, lines };
}

const text = (v: any) => (v == null ? '' : typeof v === 'object' && 'richText' in v ? v.richText.map((t: any) => t.text).join('') : typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v)).trim();

/** Remplit le modèle de la coopérative (logos, cadres et mise en forme conservés). */
export async function buildSheetXlsx(s: any, lines: SheetLine[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(FICHE_TEMPLATE_B64, 'base64') as any);
  const ws = wb.worksheets[0];
  const set = (a: string, v: any) => { ws.getCell(a).value = v === '' ? null : v; };
  set('D3', s.coop_name ?? ''); set('D4', s.driver_name ?? ''); set('D7', s.truck_no ?? ''); set('D8', s.trailer_no ?? '');
  set('D10', s.declared_kg == null ? '' : Number(s.declared_kg)); set('D11', s.declared_bags == null ? '' : Number(s.declared_bags)); set('D12', s.lot_id_dse ?? ''); set('D13', s.bl_no ?? '');
  set('D14', s.departure_date ? new Date(`${String(s.departure_date).slice(0, 10)}T00:00:00Z`) : '');
  set('I4', s.cocoa_type === 'ordinaire' ? 'X' : '');
  CERTIFICATIONS.forEach((name, i) => set(`J${5 + i}`, s.cocoa_type === 'certifie' && (s.certifications ?? []).includes(name) ? 'X' : ''));
  set('I14', s.other_certification ?? '');
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) for (const col of 'BCDEFGHIJ') set(`${col}${r}`, '');
  lines.forEach((l, i) => {
    const r = FIRST_ROW + i;
    set(`B${r}`, l.n); set(`C${r}`, l.name); set(`D${r}`, l.gender); set(`E${r}`, l.section); set(`F${r}`, l.code);
    set(`G${r}`, l.delivered_on ? new Date(`${l.delivered_on}T00:00:00Z`) : ''); set(`H${r}`, l.kg); set(`I${r}`, l.bags); set(`J${r}`, l.receipt);
    ws.getCell(`G${r}`).numFmt = 'dd/mm/yyyy'; ws.getCell(`H${r}`).numFmt = '#,##0.0##';
  });
  ws.getCell(`B${TOTAL_ROW}`).value = 'Total';
  ws.getCell(`H${TOTAL_ROW}`).value = { formula: `SUM(H${FIRST_ROW}:H${LAST_ROW})`, result: lines.reduce((a, l) => a + l.kg, 0) } as any; ws.getCell(`H${TOTAL_ROW}`).numFmt = '#,##0.0##';
  ws.getCell(`I${TOTAL_ROW}`).value = { formula: `SUM(I${FIRST_ROW}:I${LAST_ROW})`, result: lines.reduce((a, l) => a + l.bags, 0) } as any;
  set(`B${TOTAL_ROW + 2}`, s.adg_name ?? ''); set(`D${TOTAL_ROW + 2}`, s.warehouse_keeper_name ?? '');
  ws.pageSetup = { ...ws.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'portrait', paperSize: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Lecture d'une fiche d'accompagnement remplie (même disposition que le modèle). */
export async function parseSheetXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw new BadRequestException('Fichier illisible : envoyez une fiche d\'accompagnement au format Excel (.xlsx)'); }
  const ws = wb.worksheets[0];
  if (!ws || !/ACCOMPAGNEMENT/i.test(text(ws.getCell('E1').value))) throw new BadRequestException('Ce fichier n\'a pas la disposition d\'une fiche d\'accompagnement (titre « FICHE D\'ACCOMPAGNEMENT » attendu en E1)');
  const num = (a: string) => { const t = text(ws.getCell(a).value).replace(/\s/g, '').replace(',', '.'); const n = Number(t); return t && Number.isFinite(n) ? n : null; };
  const date = (v: any) => { if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10); const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(text(v)); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(text(v)) ? text(v) : null; };
  const mark = (a: string) => /^(x|✓|✔|oui)$/i.test(text(ws.getCell(a).value));
  const lines: SheetLine[] = []; const warnings: string[] = [];
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
    const name = text(ws.getCell(`C${r}`).value), code = text(ws.getCell(`F${r}`).value);
    if (!name && !code) continue;
    const kg = num(`H${r}`), bags = num(`I${r}`); const g = text(ws.getCell(`D${r}`).value).toUpperCase().slice(0, 1);
    if (!code) warnings.push(`Ligne ${r} : code planteur manquant (${name})`);
    if (kg == null || kg <= 0) warnings.push(`Ligne ${r} : poids net livré manquant ou nul (${name || code})`);
    lines.push({ n: lines.length + 1, name, gender: g === 'M' || g === 'F' ? g : '', section: text(ws.getCell(`E${r}`).value), code, delivered_on: date(ws.getCell(`G${r}`).value), kg: kg ?? 0, bags: bags == null ? 0 : Math.round(bags), receipt: text(ws.getCell(`J${r}`).value) });
  }
  if (!lines.length) throw new UnprocessableEntityException('La fiche ne contient aucune ligne de producteur (lignes 18 à 343)');
  const codes = lines.map((l) => l.code).filter(Boolean); const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dup.length) warnings.push(`Codes planteur répétés (plusieurs livraisons du même producteur) : ${[...new Set(dup)].join(', ')}`);
  const certs = CERTIFICATIONS.filter((_, i) => mark(`J${5 + i}`));
  const head = {
    coop_name: text(ws.getCell('D3').value), driver_name: text(ws.getCell('D4').value), truck_no: text(ws.getCell('D7').value), trailer_no: text(ws.getCell('D8').value), declared_kg: num('D10'), declared_bags: num('D11') == null ? null : Math.round(num('D11')!),
    lot_id_dse: text(ws.getCell('D12').value), bl_no: text(ws.getCell('D13').value), departure_date: date(ws.getCell('D14').value),
    cocoa_type: certs.length || mark('J5') ? 'certifie' : 'ordinaire', certifications: certs, other_certification: text(ws.getCell('I14').value),
    adg_name: text(ws.getCell(`B${TOTAL_ROW + 2}`).value), warehouse_keeper_name: text(ws.getCell(`D${TOTAL_ROW + 2}`).value),
  };
  if (head.declared_kg == null) head.declared_kg = Math.round(lines.reduce((a, l) => a + l.kg, 0) * 1000) / 1000;
  if (head.declared_bags == null) head.declared_bags = lines.reduce((a, l) => a + l.bags, 0);
  return { head, lines, warnings };
}

@ApiTags('fiches d\'accompagnement')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class DispatchController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'dispatch_sheet', entityId: id, details });
  }
  private has(req: any, p: string) { return req.org.permissions.has(p); }
  private async nextNumber(c: PoolClient, orgId: string) {
    const yr = new Date().getFullYear();
    const n = (await c.query(`INSERT INTO dispatch_sheet_counters(organization_id, year, last_no) VALUES ($1,$2,1) ON CONFLICT (organization_id, year) DO UPDATE SET last_no = dispatch_sheet_counters.last_no + 1 RETURNING last_no`, [orgId, yr])).rows[0].last_no;
    return `FA-${yr}-${String(n).padStart(5, '0')}`;
  }
  private async sheetFor(c: PoolClient, req: any, id: string) {
    const s = (await c.query(`SELECT * FROM dispatch_sheets WHERE id = $1`, [id])).rows[0];
    if (!s) throw new NotFoundException();
    if (!this.has(req, 'dispatch:manage') && !(this.has(req, 'dispatch:read') && s.status === 'transmitted' && s.exporter_user_id === req.user.id)) throw new NotFoundException();
    return s;
  }
  private static strip(s: any) { const { file_bytes, ...rest } = s; return { ...rest, has_file: !!file_bytes }; }

  // ── Convois : consulter / exporter la liste de leurs producteurs
  @Get('dispatch-sheets/convoys') @RequirePermissions('dispatch:manage')
  convoys(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.id, v.convoy_no, v.driver_name, v.truck_no, v.trailer_no, r.received_at, r.total_kg AS net_kg, r.bags, cu.full_name AS collector_name,
              (SELECT count(*)::int FROM convoy_declarations x WHERE x.convoy_id = v.id) AS producers,
              (SELECT string_agg(s.number, ', ' ORDER BY s.number) FROM dispatch_sheet_convoys sc JOIN dispatch_sheets s ON s.id = sc.sheet_id WHERE sc.convoy_id = v.id) AS sheets
         FROM convoys v JOIN convoy_receptions r ON r.convoy_id = v.id JOIN collectors col ON col.id = v.collector_id JOIN users cu ON cu.id = col.user_id
        ORDER BY r.received_at DESC LIMIT 500`)).rows);
  }

  @Get('convoys/:id/fiche-accompagnement') @RequirePermissions('dispatch:manage')
  async convoyList(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => { const { convoys, lines } = await convoyLines(c, [id]); return { convoy: convoys[0], lines, total_kg: lines.reduce((a, l) => a + l.kg, 0), total_bags: lines.reduce((a, l) => a + l.bags, 0) }; });
  }

  @Get('convoys/:id/fiche-accompagnement.xlsx') @RequirePermissions('dispatch:manage')
  async convoyXlsx(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const { buf, no } = await this.db.tx(req.org.id, async (c) => {
      const { convoys, lines } = await convoyLines(c, [id]); const v = convoys[0];
      const org = (await c.query(`SELECT name FROM organizations WHERE id = $1`, [req.org.id])).rows[0];
      const head = { coop_name: org?.name ?? '', driver_name: v.driver_name, truck_no: v.truck_no, trailer_no: v.trailer_no, declared_kg: lines.reduce((a, l) => a + l.kg, 0), declared_bags: lines.reduce((a, l) => a + l.bags, 0), bl_no: v.convoy_no, departure_date: null, cocoa_type: 'ordinaire', certifications: [] };
      return { buf: await buildSheetXlsx(head, lines), no: v.convoy_no };
    });
    await this.log(req, 'dispatch.export_convoy', id, { convoy_no: no });
    return new StreamableFile(buf, { type: XLSX, disposition: `attachment; filename="Fiche_accompagnement_${no.replace(/[^\w.-]+/g, '_')}.xlsx"` });
  }

  // ── Fiches d'accompagnement (chargement = un ou plusieurs convois)
  @Post('dispatch-sheets') @RequirePermissions('dispatch:manage')
  async create(@Body() b: CreateSheetDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const { convoys, lines } = await convoyLines(c, [...new Set(b.convoy_ids)]);
      const taken = (await c.query(`SELECT DISTINCT s.number FROM dispatch_sheet_convoys sc JOIN dispatch_sheets s ON s.id = sc.sheet_id WHERE sc.convoy_id = ANY($1::uuid[]) AND s.status = 'transmitted'`, [convoys.map((v) => v.id)])).rows;
      if (taken.length) throw new ConflictException(`Des convois sont déjà sur une fiche transmise (${taken.map((t) => t.number).join(', ')})`);
      const org = (await c.query(`SELECT name FROM organizations WHERE id = $1`, [req.org.id])).rows[0];
      const first = convoys[0]; const kg = lines.reduce((a, l) => a + l.kg, 0); const bags = lines.reduce((a, l) => a + l.bags, 0);
      const number = await this.nextNumber(c, req.org.id);
      const s = (await c.query(
        `INSERT INTO dispatch_sheets(organization_id, number, source, driver_name, truck_no, trailer_no, declared_kg, declared_bags, lot_id_dse, bl_no, departure_date, cocoa_type, certifications, other_certification, coop_name, adg_name, warehouse_keeper_name, lines, created_by)
         VALUES ($1,$2,'generated',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [req.org.id, number, b.driver_name ?? first.driver_name, b.truck_no ?? first.truck_no, b.trailer_no ?? first.trailer_no ?? null, kg, bags, b.lot_id_dse || null, b.bl_no || (convoys.length === 1 ? first.convoy_no : null), b.departure_date ?? null,
         b.cocoa_type ?? 'ordinaire', b.cocoa_type === 'certifie' ? (b.certifications ?? []) : [], b.other_certification || null, org?.name ?? '', b.adg_name || null, b.warehouse_keeper_name || null, JSON.stringify(lines), req.user.id])).rows[0];
      for (const v of convoys) await c.query(`INSERT INTO dispatch_sheet_convoys(organization_id, sheet_id, convoy_id) VALUES ($1,$2,$3)`, [req.org.id, s.id, v.id]);
      return s;
    });
    await this.log(req, 'dispatch.create', row.id, { number: row.number, convoys: b.convoy_ids.length });
    return DispatchController.strip(row);
  }

  @Get('dispatch-sheets')
  list(@Req() req: any) {
    const all = this.has(req, 'dispatch:manage');
    if (!all && !this.has(req, 'dispatch:read')) throw new ForbiddenException('Permission insuffisante');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.id, s.number, s.source, s.status, s.bl_no, s.truck_no, s.driver_name, s.declared_kg, s.declared_bags, s.departure_date, s.exporter_name, s.transmitted_at, s.created_at, jsonb_array_length(s.lines) AS producers,
              (SELECT count(*)::int FROM dispatch_sheet_convoys x WHERE x.sheet_id = s.id) AS convoys
         FROM dispatch_sheets s WHERE ($1::boolean OR (s.status = 'transmitted' AND s.exporter_user_id = $2)) ORDER BY s.created_at DESC LIMIT 500`, [all, req.user.id])).rows);
  }

  @Get('dispatch-sheets/exporters') @RequirePermissions('dispatch:manage')
  exporters(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM user_organizations uo JOIN users u ON u.id = uo.user_id JOIN role_permissions rp ON rp.role_id = uo.role_id
        WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = 'dispatch:read'
          AND NOT EXISTS (SELECT 1 FROM role_permissions m WHERE m.role_id = uo.role_id AND m.permission_code = 'dispatch:manage') ORDER BY u.full_name`, [req.org.id])).rows);
  }

  @Post('dispatch-sheets/import') @RequirePermissions('dispatch:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  async importSheet(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file?.buffer?.length) throw new BadRequestException('Aucun fichier reçu');
    const { head, lines, warnings } = await parseSheetXlsx(file.buffer);
    const row = await this.db.tx(req.org.id, async (c) => {
      const known = new Set((await c.query(`SELECT internal_code FROM producers WHERE internal_code = ANY($1::text[])`, [lines.map((l) => l.code)])).rows.map((r) => r.internal_code));
      const unknown = [...new Set(lines.filter((l) => l.code && !known.has(l.code)).map((l) => l.code))];
      if (unknown.length) warnings.push(`Codes planteur absents du registre : ${unknown.slice(0, 15).join(', ')}${unknown.length > 15 ? '…' : ''}`);
      const org = (await c.query(`SELECT name FROM organizations WHERE id = $1`, [req.org.id])).rows[0];
      const number = await this.nextNumber(c, req.org.id);
      return (await c.query(
        `INSERT INTO dispatch_sheets(organization_id, number, source, driver_name, truck_no, trailer_no, declared_kg, declared_bags, lot_id_dse, bl_no, departure_date, cocoa_type, certifications, other_certification, coop_name, adg_name, warehouse_keeper_name, lines, file_name, file_sha256, file_bytes, created_by)
         VALUES ($1,$2,'imported',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [req.org.id, number, head.driver_name || null, head.truck_no || null, head.trailer_no || null, head.declared_kg, head.declared_bags, head.lot_id_dse || null, head.bl_no || null, head.departure_date,
         head.cocoa_type, head.certifications, head.other_certification || null, head.coop_name || org?.name || '', head.adg_name || null, head.warehouse_keeper_name || null, JSON.stringify(lines),
         String(file.originalname ?? 'fiche.xlsx').slice(0, 150), createHash('sha256').update(file.buffer).digest('hex'), file.buffer, req.user.id])).rows[0];
    });
    await this.log(req, 'dispatch.import', row.id, { number: row.number, lines: lines.length, warnings: warnings.length });
    return { sheet: DispatchController.strip(row), warnings };
  }

  @Get('dispatch-sheets/:id')
  async one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const s = await this.sheetFor(c, req, id);
      const convoys = (await c.query(`SELECT v.id, v.convoy_no FROM dispatch_sheet_convoys x JOIN convoys v ON v.id = x.convoy_id WHERE x.sheet_id = $1 ORDER BY v.convoy_no`, [id])).rows;
      return { ...DispatchController.strip(s), convoys_list: convoys };
    });
  }

  @Get('dispatch-sheets/:id/export')
  async exportSheet(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const { s, buf } = await this.db.tx(req.org.id, async (c) => {
      const s = await this.sheetFor(c, req, id);
      return { s, buf: s.source === 'imported' && s.file_bytes ? (s.file_bytes as Buffer) : await buildSheetXlsx(s, s.lines) };
    });
    await this.log(req, 'dispatch.export', id, { number: s.number, source: s.source });
    return new StreamableFile(buf, { type: XLSX, disposition: `attachment; filename="Fiche_accompagnement_${s.number}.xlsx"` });
  }

  @Post('dispatch-sheets/:id/transmit') @RequirePermissions('dispatch:manage')
  async transmit(@Param('id', ParseUUIDPipe) id: string, @Body() b: TransmitDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const s = await this.sheetFor(c, req, id);
      if (s.status === 'transmitted') throw new ConflictException('Cette fiche a déjà été transmise');
      if (!!b.exporter_user_id === !!b.destination_org_id) throw new BadRequestException('Choisissez un destinataire : un compte exportateur de la coopérative, ou une organisation liée');
      if (b.destination_org_id) {
        const dest = (await c.query(
          `SELECT o.id, o.name FROM org_links l JOIN organizations o ON o.id = CASE WHEN l.from_org_id = $1 THEN l.to_org_id ELSE l.from_org_id END
            WHERE l.status = 'active' AND o.status = 'active' AND o.id = $2 AND (l.from_org_id = $1 OR l.bidirectional) LIMIT 1`, [req.org.id, b.destination_org_id])).rows[0];
        if (!dest) throw new BadRequestException('Aucun lien actif vous autorise à livrer à cette organisation');
        const t = (await c.query(`UPDATE dispatch_sheets SET status = 'transmitted', destination_org_id = $2, exporter_name = $3, transmitted_at = now(), transmitted_by = $4 WHERE id = $1 RETURNING *`, [id, dest.id, dest.name, req.user.id])).rows[0];
        const srcName = (await c.query(`SELECT name FROM organizations WHERE id = $1`, [req.org.id])).rows[0]?.name ?? '';
        // Création de la livraison chez le destinataire (transaction propre : si elle échoue, la transmission est annulée)
        const deliveryId = await this.db.tx(dest.id, async (dc) => {
          const number = await nextDeliveryNumber(dc, dest.id);
          const d = (await dc.query(
            `INSERT INTO deliveries(organization_id, source_org_id, source_org_name, source_sheet_id, source_sheet_no, number, driver_name, truck_no, trailer_no, declared_kg, declared_bags, lot_id_dse, bl_no, departure_date, cocoa_type, certifications, lines)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb) ON CONFLICT (organization_id, source_org_id, source_sheet_id) DO NOTHING RETURNING id`,
            [dest.id, req.org.id, srcName, t.id, t.number, number, t.driver_name, t.truck_no, t.trailer_no, t.declared_kg ?? 0, t.declared_bags ?? 0, t.lot_id_dse, t.bl_no, t.departure_date, t.cocoa_type, t.certifications ?? [], JSON.stringify(t.lines ?? [])])).rows[0];
          const did = d?.id ?? (await dc.query(`SELECT id FROM deliveries WHERE source_org_id = $1 AND source_sheet_id = $2`, [req.org.id, t.id])).rows[0].id;
          const ids = (await dc.query(`SELECT DISTINCT uo.user_id FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = 'deliveries:weigh'`, [dest.id])).rows.map((r) => r.user_id);
          if (ids.length) await this.notif.notifyUsers(dc, dest.id, ids, { kind: 'delivery', severity: 'info', title: `Livraison de ${srcName} attendue`, body: `${Number(t.declared_kg ?? 0)} kg · camion ${t.truck_no ?? ''} · fiche ${t.number}`, entityType: 'delivery', entityId: did, dedupe: `delivery:${did}:new` });
          return did;
        });
        return t;
      }
      const ex = (await c.query(
        `SELECT u.id, u.full_name FROM users u JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.status = 'active'
           JOIN role_permissions rp ON rp.role_id = uo.role_id AND rp.permission_code = 'dispatch:read'
          WHERE u.id = $1 AND NOT EXISTS (SELECT 1 FROM role_permissions m WHERE m.role_id = uo.role_id AND m.permission_code = 'dispatch:manage') LIMIT 1`, [b.exporter_user_id, req.org.id])).rows[0];
      if (!ex) throw new BadRequestException('Destinataire inconnu : choisissez un compte exportateur de la coopérative');
      const t = (await c.query(`UPDATE dispatch_sheets SET status = 'transmitted', exporter_user_id = $2, exporter_name = $3, transmitted_at = now(), transmitted_by = $4 WHERE id = $1 RETURNING *`, [id, ex.id, ex.full_name, req.user.id])).rows[0];
      await this.notif.notifyUsers(c, req.org.id, [ex.id], { kind: 'dispatch_sheet', severity: 'info', title: `Fiche d'accompagnement ${t.number} reçue`,
        body: `${Number(t.declared_kg ?? 0)} kg · ${t.lines.length} producteur(s)${t.bl_no ? ` · connaissement ${t.bl_no}` : ''}`, entityType: 'dispatch_sheet', entityId: t.id, dedupe: `dispatch_sheet:${t.id}` });
      return t;
    });
    await this.log(req, 'dispatch.transmit', id, { number: row.number, exporter: row.exporter_name });
    return DispatchController.strip(row);
  }
}
