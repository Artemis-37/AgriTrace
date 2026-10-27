import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe,
  ForbiddenException, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import * as ExcelJS from 'exceljs';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { decryptFile, encryptFile } from '../common/crypto';
import { DbService } from '../db/db.service';
import {
  duplicateKeys, findInFileDuplicates, ParsedRow, resolveMapping, TARGET_FIELDS, TEMPLATE_HEADERS, validateRow,
} from './producer-import';

export class DeleteProducersDto {
  @IsArray() @IsUUID('all', { each: true }) ids: string[];
}

export class CreateProducerDto {
  /** Identifiant fourni par l'appareil (création hors connexion) : le producteur est utilisable tout de suite sur le téléphone. */
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsIn(['male', 'female']) gender?: string;
  @IsOptional() @IsDateString() birth_date?: string;
  @IsOptional() @IsString() @Length(1, 40) id_doc_type?: string;
  @IsOptional() @IsString() @Length(1, 60) id_doc_number?: string;
  /** Déclaration de consentement lue et validée par le producteur. */
  @IsOptional() @IsBoolean() consent?: boolean;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,30}$/) internal_code?: string;
  @IsString() @Length(1, 100) last_name: string;
  @IsString() @Length(1, 150) first_names: string;
  @IsOptional() @Matches(/^\+?\d{8,15}$/) phone?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() village?: string;
  @IsOptional() @Matches(/^\d+(\.\d{1,4})?$/) area_ha?: string;
  @IsOptional() @Matches(/^\d+(\.\d{1,2})?$/) estimated_kg?: string;
  @IsOptional() @IsDateString() joined_on?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) value_chain_ids?: string[];
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

@ApiTags('producteurs')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
export class UpdateProducerDto {
  @IsOptional() @IsIn(['male', 'female']) gender?: string;
  @IsOptional() @IsString() @Length(1, 100) last_name?: string;
  @IsOptional() @IsString() @Length(1, 150) first_names?: string;
  @IsOptional() @IsString() @Length(0, 20) phone?: string;
  @IsOptional() @IsString() @Length(0, 100) region?: string;
  @IsOptional() @IsString() @Length(0, 100) department?: string;
  @IsOptional() @IsString() @Length(0, 100) section?: string;
  @IsOptional() @IsString() @Length(0, 100) village?: string;
  @IsOptional() @IsString() @Length(0, 10) birth_date?: string;
  @IsOptional() @IsString() @Length(0, 40) id_doc_type?: string;
  @IsOptional() @IsString() @Length(0, 60) id_doc_number?: string;
  @IsOptional() @IsString() @Length(0, 20) area_ha?: string;
  @IsOptional() @IsString() @Length(0, 20) estimated_kg?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) value_chain_ids?: string[];
}

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
        `SELECT p.id, p.internal_code, p.last_name, p.first_names, p.phone, p.region, p.department, p.section, p.village, p.joined_on, p.status, p.area_ha, p.estimated_kg, p.gender,
                (SELECT coalesce(json_agg(x.value_chain_id), '[]') FROM producer_value_chains x WHERE x.producer_id = p.id) AS value_chain_ids,
                (SELECT count(*)::int FROM parcels pa WHERE pa.producer_id = p.id AND pa.status = 'active') AS parcels_count,
                (SELECT coalesce(sum(pa.geometry_area_ha), 0)::float8 FROM parcels pa WHERE pa.producer_id = p.id AND pa.status = 'active' AND pa.geometry IS NOT NULL) AS parcels_area_ha
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

  /** Sections de la coopérative avec leur nombre de producteurs : alimente le filtre « Section » (portail et téléphone). */
  @Get('sections')
  @RequirePermissions('producers:read')
  sections(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT section, count(*)::int AS producers, count(DISTINCT village)::int AS villages FROM producers WHERE section IS NOT NULL AND btrim(section) <> '' GROUP BY section ORDER BY section`)).rows);
  }

  /** Localités déjà connues de la coopérative (région > quartier > lieu) : alimente les listes en cascade de la fiche producteur. */
  @Get('localities')
  @RequirePermissions('producers:read')
  localities(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT btrim(region) AS region, btrim(department) AS department, btrim(village) AS village, count(*)::int AS producers
         FROM producers
        WHERE (region IS NOT NULL AND btrim(region) <> '') OR (department IS NOT NULL AND btrim(department) <> '') OR (village IS NOT NULL AND btrim(village) <> '')
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).rows);
  }

  /**
   * Suppression définitive d'un ou plusieurs producteurs (administrateur de la coopérative).
   * Refusée pour un producteur qui a des opérations enregistrées (déclarations, paiements, missions…) : l'archiver à la place.
   * Un producteur qui a des parcelles est aussi refusé : l'historique des parcelles est immuable (traçabilité).
   */
  @Post('delete')
  @RequirePermissions('producers:delete')
  async remove(@Body() b: DeleteProducersDto, @Req() req: any) {
    const ids = [...new Set(b.ids ?? [])];
    if (!ids.length) throw new BadRequestException('Aucun producteur sélectionné');
    if (ids.length > 500) throw new BadRequestException('500 producteurs au maximum par opération');
    const out = await this.db.tx(req.org.id, async (c) => {
      const deleted: { id: string; code: string; parcels: number }[] = []; const blocked: { id: string; code: string | null; reason: string }[] = [];
      for (const id of ids) {
        const p = (await c.query(`SELECT internal_code FROM producers WHERE id = $1`, [id])).rows[0];
        if (!p) { blocked.push({ id, code: null, reason: 'introuvable' }); continue; }
        await c.query('SAVEPOINT del');
        try {
          const np = (await c.query(`SELECT count(*)::int AS n FROM parcels WHERE producer_id = $1`, [id])).rows[0].n;
          if (np) { await c.query('ROLLBACK TO SAVEPOINT del'); blocked.push({ id, code: p.internal_code, reason: `a ${np} parcelle(s) : leur historique de traçabilité est conservé, l'archiver plutôt (Statut)` }); continue; }
          await c.query(`DELETE FROM producer_status_history WHERE producer_id = $1`, [id]);
          await c.query(`DELETE FROM producers WHERE id = $1`, [id]);
          await c.query('RELEASE SAVEPOINT del');
          deleted.push({ id, code: p.internal_code, parcels: 0 });
        } catch (e: any) {
          await c.query('ROLLBACK TO SAVEPOINT del');
          if (e.code !== '23503' && !/immuable/.test(String(e.message))) throw e;
          blocked.push({ id, code: p.internal_code, reason: 'a des opérations enregistrées (déclarations, paiements, missions…) : l\'archiver plutôt' });
        }
      }
      return { deleted, blocked };
    });
    if (out.deleted.length) await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.delete', entityType: 'producer', entityId: out.deleted[0].id, details: { count: out.deleted.length, codes: out.deleted.map((d) => d.code).slice(0, 200) } });
    return out;
  }

  @Get('imports/template')
  @RequirePermissions('producers:import')
  async template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Producteurs');
    ws.addRow(TARGET_FIELDS.map((f) => TEMPLATE_HEADERS[f]));
    ws.getRow(1).font = { bold: true };
    const sample: Record<string, string> = { internal_code: '', last_name: 'KONE', first_names: 'Awa', phone: '+2250701020304', region: 'Haut-Sassandra', department: 'Daloa', section: 'Hiré', village: 'Zoukougbeu', area_ha: '2.5', estimated_kg: '1200', value_chains: 'CACAO', joined_on: '2024-05-12', gender: 'F', birth_date: '14/03/1985', id_doc_type: 'CNI ivoirienne', id_doc_number: 'C0012345678' };
    ws.addRow(TARGET_FIELDS.map((f) => sample[f] ?? ''));
    ws.columns.forEach((col) => (col.width = 22));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const guide = wb.addWorksheet('Instructions');
    guide.columns = [{ width: 34 }, { width: 90 }];
    guide.addRow(['Colonne', 'Comment la remplir']).font = { bold: true };
    for (const r of [
      ['Nom, Prénoms', 'Obligatoires.'],
      ['Code', 'Facultatif : laissé vide, le code est attribué automatiquement.'],
      ['Sexe', 'M ou F (Homme / Femme acceptés).'],
      ['Date de naissance', 'JJ/MM/AAAA.'],
      ["Type de pièce d'identité", "Par exemple : CNI ivoirienne, CNI malienne, CNI burkinabé, Passeport, Numéro matricule CCC du producteur, Pas de CNI ni matricule CCC. Obligatoire si le numéro de pièce est rempli."],
      ['Téléphone', 'Avec ou sans +225 (8 à 15 chiffres).'],
      ['Région, Département, Sous-préfecture', "Mêmes noms que dans la fiche producteur du téléphone : Région (ex. Haut-Sassandra) > Département (ville chef-lieu de région, ex. Daloa) > Sous-préfecture (ex. Zoukougbeu). Les anciens intitulés « Quartier », « Ville », « Lieu » et « Village » sont toujours reconnus."],
      ['Section', 'Section de la coopérative, telle qu\'elle figure dans la liste de Paramètres.'],
      ['Superficie (ha), Estimation (kg)', 'Nombres positifs, virgule décimale acceptée.'],
      ['Filières', 'Codes séparés par une virgule (ex. CACAO). Vide : toutes les filières de la coopérative.'],
      ["Date d'adhésion", 'AAAA-MM-JJ.'],
    ]) guide.addRow(r);
    guide.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="modele-producteurs.xlsx"',
    });
  }

  /** Photo de profil du producteur (fichier binaire ; 404 s'il n'y en a pas). */
  @Get(':id/photo')
  @RequirePermissions('producers:read')
  async photo(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const r = (await this.db.tx(req.org.id, (c) => c.query(`SELECT mime, data FROM producer_photos WHERE producer_id = $1`, [id]))).rows[0];
    if (!r) throw new NotFoundException('Aucune photo');
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(decryptFile(r.data));
  }

  /** Enregistre ou remplace la photo de profil (JPEG ou PNG, 3 Mo au plus). */
  @Post(':id/photo')
  @RequirePermissions('producers:read')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  async setPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    const perms = req.org.permissions;
    if (!(perms.has('producers:create') || perms.has('producers:update') || perms.has('documents:upload'))) throw new ForbiddenException('Droit insuffisant pour changer la photo');
    if (!file) throw new BadRequestException('Fichier manquant (champ "file", 3 Mo maximum)');
    const b = file.buffer;
    const mime = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
      : b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : null;
    if (!mime) throw new BadRequestException('Format non autorisé : JPEG ou PNG uniquement');
    await this.db.tx(req.org.id, async (c) => {
      if (!(await c.query(`SELECT 1 FROM producers WHERE id = $1`, [id])).rowCount) throw new NotFoundException('Producteur introuvable');
      await c.query(
        `INSERT INTO producer_photos(producer_id, organization_id, mime, data, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (producer_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [id, req.org.id, mime, encryptFile(b), req.user.id]);
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.photo', entityType: 'producer', entityId: id });
    return { ok: true };
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
      const out = { ...p.rows[0], value_chain_ids: vc.rows.map((r) => r.value_chain_id) };
      if (!req.org.permissions.has('documents:sensitive')) delete out.id_doc_number; // pièce d'identité : donnée sensible
      return out;
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
        `INSERT INTO producers(id, organization_id, internal_code, last_name, first_names, phone, region, department, section, village, joined_on, created_by,
                               gender, birth_date, id_doc_type, id_doc_number, consent_at, area_ha, estimated_kg)
         VALUES (coalesce($12::uuid, gen_random_uuid()),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$13,$14,$15,$16, CASE WHEN $17::boolean THEN now() END, $18, $19)
         ON CONFLICT (id) DO UPDATE SET id = producers.id RETURNING *`,
        [req.org.id, code, b.last_name, b.first_names, b.phone ?? null, b.region ?? null, b.department ?? null,
         b.section ?? null, b.village ?? null, b.joined_on ?? null, req.user.id, b.id ?? null,
         b.gender ?? null, b.birth_date ?? null, b.id_doc_type ?? null, b.id_doc_number ?? null, b.consent === true, b.area_ha ?? null, b.estimated_kg ?? null]);
      const wanted = b.value_chain_ids?.length ? b.value_chain_ids : (await c.query(`SELECT id FROM value_chains WHERE status = 'active'`)).rows.map((r: any) => r.id);
      for (const vc of wanted) {
        const ok = await c.query(`SELECT 1 FROM value_chains WHERE id = $1`, [vc]);
        if (!ok.rowCount) throw new BadRequestException('Filière inconnue');
        await c.query(`INSERT INTO producer_value_chains(producer_id, value_chain_id, organization_id) VALUES ($1,$2,$3)`, [ins.rows[0].id, vc, req.org.id]);
      }
      return { producer: ins.rows[0], potential_duplicates: duplicates };
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.create', entityType: 'producer', entityId: out.producer.id });
    return out; // les doublons potentiels sont signalés, jamais fusionnés automatiquement
  }

  /** Modification de la fiche d'un producteur (identité, localisation, pièce, superficie, filières). Le code et le statut ne changent pas ici. */
  @Put(':id')
  @RequirePermissions('producers:update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateProducerDto, @Req() req: any) {
    const cols = ['gender', 'last_name', 'first_names', 'phone', 'region', 'department', 'section', 'village', 'birth_date', 'id_doc_type', 'id_doc_number', 'area_ha', 'estimated_kg'] as const;
    if (b.phone && !/^\+?\d{8,15}$/.test(b.phone)) throw new BadRequestException('Téléphone : format international, par exemple +2250701020304');
    if (b.area_ha && !/^\d+(\.\d{1,4})?$/.test(b.area_ha)) throw new BadRequestException('Superficie invalide');
    if (b.estimated_kg && !/^\d+(\.\d{1,2})?$/.test(b.estimated_kg)) throw new BadRequestException('Estimation invalide');
    if (b.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date)) throw new BadRequestException('Date de naissance : AAAA-MM-JJ');
    const out = await this.db.tx(req.org.id, async (c) => {
      const sets: string[] = []; const vals: any[] = [id, req.user.id];
      for (const k of cols) if (b[k] !== undefined) { vals.push((b[k] as string).trim?.() === '' ? null : b[k]); sets.push(`${k} = $${vals.length}`); }
      if (b.value_chain_ids) {
        for (const vc of b.value_chain_ids) if (!(await c.query(`SELECT 1 FROM value_chains WHERE id = $1`, [vc])).rowCount) throw new BadRequestException('Filière inconnue');
      }
      if (!sets.length && !b.value_chain_ids) throw new BadRequestException('Aucune information à modifier');
      const row = sets.length
        ? (await c.query(`UPDATE producers SET ${sets.join(', ')}, updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1 RETURNING *`, vals)).rows[0]
        : (await c.query(`SELECT * FROM producers WHERE id = $1`, [id])).rows[0];
      if (!row) throw new NotFoundException();
      if (b.value_chain_ids) {
        await c.query(`DELETE FROM producer_value_chains WHERE producer_id = $1`, [id]);
        for (const vc of b.value_chain_ids) await c.query(`INSERT INTO producer_value_chains(producer_id, value_chain_id, organization_id) VALUES ($1,$2,$3)`, [id, vc, req.org.id]);
      }
      return row;
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer.update', entityType: 'producer', entityId: id, details: { fields: cols.filter((k) => b[k] !== undefined), value_chains: b.value_chain_ids !== undefined } });
    return out;
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
      throw new BadRequestException({ message: 'Colonnes Nom et Prénoms introuvables : indiquez à quelle colonne correspond chaque information.', headers: headers.filter(Boolean), missing_mapping: true });

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
      const result = { total: rows.length, created: 0, skipped: 0, dry_run: confirm !== 'true', headers: headers.filter(Boolean), mapping,
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
            `INSERT INTO producers(organization_id, internal_code, last_name, first_names, phone, region, department, section, village, joined_on, created_by, area_ha, estimated_kg, gender, birth_date, id_doc_type, id_doc_number)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [req.org.id, code, r.data.last_name, r.data.first_names, r.data.phone ?? null, r.data.region ?? null,
             r.data.department ?? null, r.data.section ?? null, r.data.village ?? null, r.data.joined_on ?? null, req.user.id, r.data.area_ha ?? null, r.data.estimated_kg ?? null, r.data.gender ?? null,
             r.data.birth_date ?? null, r.data.id_doc_type ?? null, r.data.id_doc_number ?? null]);
          for (const vc of (chainIds.length ? chainIds : [...chains.values()]))
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
