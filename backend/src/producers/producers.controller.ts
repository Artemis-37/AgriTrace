import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe,
  Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsDateString, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import * as ExcelJS from 'exceljs';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import {
  duplicateKeys, findInFileDuplicates, ParsedRow, resolveMapping, TARGET_FIELDS, TEMPLATE_HEADERS, validateRow,
} from './producer-import';

class CreateProducerDto {
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,30}$/) internal_code?: string;
  @IsString() @Length(1, 100) last_name: string;
  @IsString() @Length(1, 150) first_names: string;
  @IsOptional() @Matches(/^\+?\d{8,15}$/) phone?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() village?: string;
  @IsOptional() @IsDateString() joined_on?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) value_chain_ids?: string[];
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

@ApiTags('producteurs')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('producers')
export class ProducersController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private async nextCode(c: PoolClient, orgId: string): Promise<string> {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`producer-code:${orgId}`]);
    const r = await c.query(
      `SELECT coalesce(max(substring(internal_code from '^P(\\d+)$')::int), 0) + 1 AS n FROM producers`);
    return `P${String(r.rows[0].n).padStart(5, '0')}`;
  }

  private async findDuplicates(c: PoolClient, d: { phone?: string; last_name?: string; first_names?: string; village?: string }) {
    const r = await c.query(
      `SELECT id, internal_code, last_name, first_names, phone, village FROM producers
        WHERE ($1::text IS NOT NULL AND phone = $1)
           OR (lower(last_name) = lower($2) AND lower(first_names) = lower($3) AND lower(coalesce(village,'')) = lower(coalesce($4,'')))
        LIMIT 5`,
      [d.phone ?? null, d.last_name ?? '', d.first_names ?? '', d.village ?? null]);
    return r.rows;
  }

  @Get()
  @RequirePermissions('producers:read')
  list(@Req() req: any, @Query('q') q?: string, @Query('section') section?: string, @Query('village') village?: string,
       @Query('value_chain_id') vc?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const like = q ? `%${q.replace(/[%_\\]/g, '\\$&').toLowerCase()}%` : null;
    const staff = req.org.permissions.has('declarations:validate');
    return this.db.tx(req.org.id, async (c) =>
      (await c.query(
        `SELECT p.id, p.internal_code, p.last_name, p.first_names, p.phone, p.region, p.department, p.section, p.village, p.joined_on, p.status
           FROM producers p
          WHERE ($1::text IS NULL OR lower(p.internal_code) LIKE $1 OR lower(p.last_name) LIKE $1 OR lower(p.first_names) LIKE $1 OR coalesce(p.phone,'') LIKE $1)
            AND ($2::text IS NULL OR p.section = $2) AND ($3::text IS NULL OR p.village = $3)
            AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM producer_value_chains x WHERE x.producer_id = p.id AND x.value_chain_id = $4))
            AND ($7::boolean OR NOT EXISTS (SELECT 1 FROM collectors k WHERE k.user_id = $8 AND k.status = 'active')
                 OR EXISTS (SELECT 1 FROM collectors k JOIN collector_assignments a ON a.collector_id = k.id
                              JOIN producer_value_chains x ON x.value_chain_id = a.value_chain_id
                             WHERE k.user_id = $8 AND k.status = 'active' AND x.producer_id = p.id))
          ORDER BY p.last_name, p.first_names LIMIT $5 OFFSET $6`,
        [like, section ?? null, village ?? null, vc ?? null, Math.min(Number(limit) || 50, 200), Number(offset) || 0, staff, req.user.id])).rows);
  }

  @Get('imports/template')
  @RequirePermissions('producers:import')
  async template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Producteurs');
    ws.addRow(TARGET_FIELDS.map((f) => TEMPLATE_HEADERS[f]));
    ws.getRow(1).font = { bold: true };
    ws.addRow(['', 'KONE', 'Awa', '+2250701020304', 'Haut-Sassandra', 'Daloa', 'Hiré', 'Hiré centre', 'CACAO', '2024-05-12']);
    ws.columns.forEach((col) => (col.width = 18));
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="modele-producteurs.xlsx"',
    });
  }

  @Get(':id')
  @RequirePermissions('producers:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await c.query(`SELECT * FROM producers WHERE id = $1`, [id]);
      if (!p.rowCount) return null;
      const vc = await c.query(`SELECT value_chain_id FROM producer_value_chains WHERE producer_id = $1`, [id]);
      if (!req.org.permissions.has('declarations:validate') && (await c.query(`SELECT 1 FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rowCount) {
        const ok = await c.query(
          `SELECT 1 FROM collectors k JOIN collector_assignments a ON a.collector_id = k.id
            WHERE k.user_id = $1 AND k.status = 'active' AND a.value_chain_id = ANY($2::uuid[])`, [req.user.id, vc.rows.map((r) => r.value_chain_id)]);
        if (!ok.rowCount) return null;
      }
      return { ...p.rows[0], value_chain_ids: vc.rows.map((r) => r.value_chain_id) };
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  @Post()
  @RequirePermissions('producers:create')
  async create(@Body() b: CreateProducerDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const duplicates = await this.findDuplicates(c, b);
      const code = b.internal_code ?? (await this.nextCode(c, req.org.id));
      const exists = await c.query(`SELECT 1 FROM producers WHERE internal_code = $1`, [code]);
      if (exists.rowCount) throw new ConflictException('Code producteur déjà utilisé');
      const ins = await c.query(
        `INSERT INTO producers(organization_id, internal_code, last_name, first_names, phone, region, department, section, village, joined_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.org.id, code, b.last_name, b.first_names, b.phone ?? null, b.region ?? null, b.department ?? null,
         b.section ?? null, b.village ?? null, b.joined_on ?? null, req.user.id]);
      for (const vc of b.value_chain_ids ?? []) {
        const ok = await c.query(`SELECT 1 FROM value_chains WHERE id = $1`, [vc]);
        if (!ok.rowCount) throw new BadRequestException('Filière inconnue');
        await c.query(`INSERT INTO producer_value_chains(producer_id, value_chain_id, organization_id) VALUES ($1,$2,$3)`, [ins.rows[0].id, vc, req.org.id]);
      }
      return { producer: ins.rows[0], potential_duplicates: duplicates };
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.create', entityType: 'producer', entityId: out.producer.id });
    return out; // les doublons potentiels sont signalés, jamais fusionnés automatiquement
  }

  /**
   * Import Excel en deux temps : sans `confirm=true` → simulation (rapport), avec → insertion des lignes valides.
   * Les doublons et les lignes en erreur ne sont jamais insérés.
   */
  @Post('imports')
  @RequirePermissions('producers:import', 'producers:create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, mapping: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  async importFile(@UploadedFile() file: Express.Multer.File, @Body('mapping') mappingJson: string | undefined,
                   @Query('confirm') confirm: string | undefined, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ "file")');
    // Contrôle du fichier : signature ZIP d'un .xlsx (le type MIME annoncé n'est pas fiable)
    if (file.buffer.length < 4 || file.buffer.readUInt32LE(0) !== 0x04034b50)
      throw new BadRequestException('Le fichier doit être un classeur Excel .xlsx');

    let explicit: any;
    if (mappingJson) {
      try { explicit = JSON.parse(mappingJson); } catch { throw new BadRequestException('mapping : JSON invalide'); }
    }

    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer as any); } catch { throw new BadRequestException('Classeur illisible'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Classeur vide');
    if (ws.rowCount - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`Maximum ${MAX_IMPORT_ROWS} lignes par import`);

    const cellText = (v: ExcelJS.CellValue): string => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'object') return String((v as any).text ?? (v as any).result ?? '');
      return String(v);
    };
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, n) => (headers[n - 1] = cellText(cell.value).trim()));
    const mapping = resolveMapping(headers.filter(Boolean), explicit);
    if (!mapping.last_name || !mapping.first_names)
      throw new BadRequestException('Colonnes Nom et Prénoms introuvables : fournissez un "mapping"');

    const rows: ParsedRow[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => { if (h) raw[h] = cellText(row.getCell(i + 1).value); });
      if (Object.values(raw).every((v) => !v.trim())) return;
      rows.push(validateRow(n, raw, mapping));
    });
    const inFile = findInFileDuplicates(rows);

    const report = await this.db.tx(req.org.id, async (c) => {
      const chains = new Map((await c.query(`SELECT id, upper(code) AS code FROM value_chains`)).rows.map((r) => [r.code, r.id]));
      const result = { total: rows.length, created: 0, skipped: 0, dry_run: confirm !== 'true',
                       issues: [] as { line: number; problem: string }[] };
      const used = new Set<string>();
      for (const r of rows) {
        const problems = [...r.errors];
        if (inFile.has(r.line)) problems.push(inFile.get(r.line)!);
        const chainIds: string[] = [];
        for (const code of (r.data.value_chains ?? '').split(/[;,]/).map((s) => s.trim().toUpperCase()).filter(Boolean)) {
          const id = chains.get(code);
          if (id) chainIds.push(id); else problems.push(`Filière inconnue : ${code}`);
        }
        if (!problems.length) {
          const existing = await this.findDuplicates(c, r.data);
          if (existing.length) problems.push(`Doublon potentiel avec ${existing[0].internal_code}`);
          else if (r.data.internal_code && (await c.query(`SELECT 1 FROM producers WHERE internal_code = $1`, [r.data.internal_code])).rowCount)
            problems.push('Code déjà utilisé');
        }
        if (problems.length) {
          result.skipped++;
          problems.forEach((p) => result.issues.push({ line: r.line, problem: p }));
          continue;
        }
        used.add(duplicateKeys(r.data)[0] ?? '');
        if (!result.dry_run) {
          const code = r.data.internal_code ?? (await this.nextCode(c, req.org.id));
          const ins = await c.query(
            `INSERT INTO producers(organization_id, internal_code, last_name, first_names, phone, region, department, section, village, joined_on, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [req.org.id, code, r.data.last_name, r.data.first_names, r.data.phone ?? null, r.data.region ?? null,
             r.data.department ?? null, r.data.section ?? null, r.data.village ?? null, r.data.joined_on ?? null, req.user.id]);
          for (const vc of chainIds)
            await c.query(`INSERT INTO producer_value_chains(producer_id, value_chain_id, organization_id) VALUES ($1,$2,$3)`, [ins.rows[0].id, vc, req.org.id]);
        }
        result.created++;
      }
      return result;
    });
    if (!report.dry_run)
      await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.import',
        details: { file: file.originalname, total: report.total, created: report.created, skipped: report.skipped } });
    return report;
  }
}
