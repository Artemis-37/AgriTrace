import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req,
  StreamableFile, UnprocessableEntityException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { centroid, polygonAreaHa } from '../parcels/geo';
import { geometryHash } from './geo-core';
import { detectFields, GeoImportService, ImportOptions, Item, Mode } from './geo-import.service';
import {
  buildGeoJson, buildGpkg, buildKml, buildKmz, buildShapefile, ExportColumn, ExportRow, GeoFormat, GeoFormatError, parseGeoFile,
} from './formats';
import { GeoService } from './geo.service';

const MAX_GEO_BYTES = 20 * 1024 * 1024;
const MODES = ['create_only', 'create_update', 'simulate', 'quarantine'];

class SettingsDto {
  @IsNumber() @Min(0) overlap_min_m2: number;
  @IsNumber() @Min(0) @Max(100) overlap_min_pct: number;
  @IsNumber() @Min(0.5) @Max(1) near_duplicate_iou: number;
  @IsIn(['block', 'warn']) overlap_policy: 'block' | 'warn';
}
class ConfirmDto {
  @IsIn(['create_only', 'create_update', 'quarantine']) mode: Mode;
  @IsOptional() @IsBoolean() all_or_nothing?: boolean;
}
class ResolveDto {
  @IsIn(['corrected', 'exception', 'dismissed']) resolution: 'corrected' | 'exception' | 'dismissed';
  @IsString() @Length(3, 500) note: string;
}
class AssignDto { @IsUUID() user_id: string; }
class MergeDto {
  @IsUUID() keep_id: string;
  @IsUUID() replace_id: string;
  @IsString() @Length(3, 500) reason: string;
  @IsOptional() @IsBoolean() confirm?: boolean;
  @IsOptional() take_fields?: string[];
}

// Colonnes d'export (CDC §9.5). Noms Shapefile ≤ 10 caractères, correspondance fournie dans champs.txt de l'archive.
const BASE_COLS: ExportColumn[] = [
  { key: 'parcel_id', shp: 'parcel_id', type: 'C' }, { key: 'parcel_code', shp: 'parcel_cod', type: 'C' }, { key: 'producer_code', shp: 'prod_code', type: 'C' },
  { key: 'cooperative_code', shp: 'coop_code', type: 'C' }, { key: 'filiere', shp: 'filiere', type: 'C' },
  { key: 'declared_area_ha', shp: 'decl_ha', type: 'N', dec: 4 }, { key: 'measured_area_ha', shp: 'meas_ha', type: 'N', dec: 4 },
  { key: 'centroid_longitude', shp: 'cen_lon', type: 'N', dec: 6 }, { key: 'centroid_latitude', shp: 'cen_lat', type: 'N', dec: 6 },
  { key: 'geometry_status', shp: 'geom_stat', type: 'C' }, { key: 'validation_status', shp: 'valid_stat', type: 'C' },
  { key: 'survey_date', shp: 'survey_dt', type: 'C' }, { key: 'last_updated', shp: 'last_upd', type: 'C' }, { key: 'campaign_code', shp: 'camp_code', type: 'C' },
];
const NAME_COL: ExportColumn = { key: 'producer_name', shp: 'prod_name', type: 'C' };
const EXTRA_COLS: Record<string, ExportColumn> = {
  section: { key: 'section', shp: 'section', type: 'C' }, village: { key: 'village', shp: 'village', type: 'C' }, region: { key: 'region', shp: 'region', type: 'C' },
  agent: { key: 'agent', shp: 'agent', type: 'C' }, gps_accuracy_m: { key: 'gps_accuracy_m', shp: 'gps_acc_m', type: 'N', dec: 2 },
  verified_at: { key: 'verified_at', shp: 'verif_dt', type: 'C' },
};

@ApiTags('cartographie')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('geo')
export class GeoController {
  constructor(private readonly svc: GeoService, private readonly imp: GeoImportService) {}
  private get db() { return this.svc.db; }
  private log(req: any, action: string, type: string, id: string | null, details?: any) {
    return this.svc.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id ?? undefined, details });
  }

  // ---- Paramètres ----
  @Get('settings') @RequirePermissions('parcels:read')
  settings(@Req() req: any) { return this.db.tx(req.org.id, (c) => this.svc.settings(c)); }

  @Put('settings') @RequirePermissions('geo:settings')
  async putSettings(@Body() b: SettingsDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => (await c.query(
      `INSERT INTO org_settings(organization_id, geo_overlap_min_m2, geo_overlap_min_pct, geo_near_duplicate_iou, geo_overlap_policy, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id) DO UPDATE SET geo_overlap_min_m2 = EXCLUDED.geo_overlap_min_m2, geo_overlap_min_pct = EXCLUDED.geo_overlap_min_pct,
         geo_near_duplicate_iou = EXCLUDED.geo_near_duplicate_iou, geo_overlap_policy = EXCLUDED.geo_overlap_policy, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING geo_overlap_min_m2::float8 AS overlap_min_m2, geo_overlap_min_pct::float8 AS overlap_min_pct, geo_near_duplicate_iou::float8 AS near_duplicate_iou, geo_overlap_policy AS overlap_policy`,
      [req.org.id, b.overlap_min_m2, b.overlap_min_pct, b.near_duplicate_iou, b.overlap_policy, req.user.id])).rows[0]);
    await this.log(req, 'geo.settings', 'org_settings', req.org.id, out);
    return out;
  }

  // ---- Importation ----
  @Post('imports')
  @RequirePermissions('geo:import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_GEO_BYTES, files: 1 } }))
  async startImport(@UploadedFile() file: Express.Multer.File, @Body('mode') mode: string, @Body('options') optionsJson: string | undefined, @Query('wait') wait: string | undefined, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier requis (champ « file »)');
    if (!MODES.includes(mode)) throw new BadRequestException(`mode invalide (${MODES.join(', ')})`);
    let options: ImportOptions = {};
    if (optionsJson) { try { options = JSON.parse(optionsJson); } catch { throw new BadRequestException('options : JSON invalide'); } }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new BadRequestException('options : objet attendu');
    let parsed;
    try { parsed = await parseGeoFile(file.buffer, file.originalname, { assumeWgs84: !!options.assume_wgs84, layer: options.layer }); }
    catch (e) { if (e instanceof GeoFormatError) throw new UnprocessableEntityException(e.message); throw e; }
    const { opt, columns } = detectFields(parsed.features, options);
    if (!opt.producer_field) throw new BadRequestException({ message: "Colonne du code producteur non identifiée : la préciser dans options.producer_field (le nom affiché du polygone n'est jamais supposé être le code producteur)", columns });
    for (const k of ['producer_field', 'producer_name_field', 'parcel_code_field', 'value_chain_field', 'declared_area_field', 'external_id_field', 'survey_date_field', 'accuracy_field'] as const)
      if (opt[k] && !columns.includes(opt[k]!)) throw new BadRequestException({ message: `Colonne « ${opt[k]} » absente du fichier (${k})`, columns });
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const row = await this.db.tx(req.org.id, async (c) => (await c.query(
      `INSERT INTO geo_imports(organization_id, file_name, format, file_sha256, file_size, mode, options, total, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.org.id, file.originalname.slice(0, 200), parsed.format, sha, file.size, mode, JSON.stringify(opt), parsed.features.length, req.user.id])).rows[0]);
    await this.log(req, 'geo.import.start', 'geo_import', row.id, { format: parsed.format, mode, rows: parsed.features.length, sha256: sha });
    const job = this.runJob(req.org.id, req.user.id, row.id, parsed.features.map((f) => ({ props: f.props, geometry: f.geometry })), opt, mode as Mode, !!opt.all_or_nothing);
    if (wait === 'true') { await job; return { ...(await this.getImport(row.id, req)), warnings: parsed.warnings }; }
    return { id: row.id, status: 'running', total: row.total, warnings: parsed.warnings };
  }

  /** Exécution détachée de la requête (arrière-plan) avec progression ; tout ou rien pour les écritures. */
  private runJob(orgId: string, userId: string, importId: string, features: { props: any; geometry: any }[], opt: ImportOptions, mode: Mode, allOrNothing: boolean): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(async () => {
      try {
        await this.db.tx(orgId, async (c) => {
          const s = await this.svc.settings(c);
          const progress = async (n: number) => { await this.db.tx(orgId, (c2) => c2.query(`UPDATE geo_imports SET progress = $2 WHERE id = $1`, [importId, n])); };
          const items = await this.imp.analyse(c, features, opt, mode, s, progress);
          const bad = items.filter((i) => i.outcome === 'rejected' || i.outcome === 'quarantined');
          let status = mode === 'simulate' ? 'simulated' : 'completed', error: string | null = null;
          if (mode !== 'simulate' && allOrNothing && bad.length) {
            for (const i of items) if (i.outcome === 'create' || i.outcome === 'update') { i.outcome = 'rejected'; i.reasons.push('annulé : import « tout ou rien », une autre ligne est en anomalie'); }
            status = 'failed'; error = `Mode tout ou rien : ${bad.length} ligne(s) en anomalie, aucune parcelle n'a été écrite`;
          }
          await this.imp.apply(c, orgId, userId, importId, items, s, mode !== 'simulate' && status === 'completed');
          await c.query(`UPDATE geo_imports SET status = $2, progress = total, report = $3, error = $4, finished_at = now() WHERE id = $1`,
            [importId, status, JSON.stringify(this.imp.report(items)), error]);
          const rep: any = this.imp.report(items);
          if (mode !== 'simulate' && (rep.unknown_producers || rep.rejected || rep.overlaps || rep.duplicates_confirmed))
            await this.svc.notif.notifyUsers(c, orgId, [userId], { kind: 'geo_import_issues', severity: 'warning', title: 'Import cartographique : lignes à corriger',
              body: `${rep.rejected} rejetée(s), ${rep.unknown_producers} producteur(s) inconnu(s), ${rep.overlaps} chevauchement(s), ${rep.duplicates_confirmed} doublon(s)`,
              entityType: 'geo_import', entityId: importId, dedupe: `geo_import_issues:${importId}` });
        });
      } catch (e: any) {
        await this.db.tx(orgId, (c) => c.query(`UPDATE geo_imports SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [importId, String(e.message).slice(0, 500)])).catch(() => undefined);
      } finally { resolve(); }
    }));
  }

  private async getImport(id: string, req: any) {
    return this.db.tx(req.org.id, async (c) => {
      // un travail interrompu (redémarrage du serveur) ne reste pas « en cours » indéfiniment
      await c.query(`UPDATE geo_imports SET status = 'failed', error = 'Interrompu (redémarrage du serveur ?)' WHERE id = $1 AND status = 'running' AND created_at < now() - interval '30 minutes'`, [id]);
      const r = (await c.query(`SELECT * FROM geo_imports WHERE id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      return r;
    });
  }

  @Get('imports') @RequirePermissions('geo:import')
  list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, file_name, format, mode, status, progress, total, created_at, finished_at, parent_import_id, error,
              report->>'creatable' AS creatable, report->>'rejected' AS rejected FROM geo_imports ORDER BY created_at DESC LIMIT 100`)).rows);
  }
  @Get('imports/:id') @RequirePermissions('geo:import')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) { return this.getImport(id, req); }

  @Get('imports/:id/items') @RequirePermissions('geo:import')
  items(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Query('outcome') outcome?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT row_no, producer_code, parcel_code, outcome, reasons, parcel_id FROM geo_import_items WHERE import_id = $1 AND ($2::text IS NULL OR outcome = $2) ORDER BY row_no LIMIT $3 OFFSET $4`,
      [id, outcome ?? null, Math.min(Number(limit) || 200, 1000), Number(offset) || 0])).rows);
  }

  /** Lignes rejetées ou en quarantaine, au format GeoJSON, avec les motifs : à corriger puis réimporter. */
  @Get('imports/:id/quarantine.geojson') @RequirePermissions('geo:import')
  async quarantine(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT row_no, outcome, reasons, properties, geometry FROM geo_import_items WHERE import_id = $1 AND outcome IN ('rejected','quarantined') ORDER BY row_no`, [id])).rows);
    return { type: 'FeatureCollection', features: rows.map((r: any) => ({ type: 'Feature', geometry: r.geometry, properties: { ...r.properties, _row: r.row_no, _outcome: r.outcome, _reasons: r.reasons.join(' | ') } })) };
  }

  @Post('imports/:id/confirm')
  @RequirePermissions('geo:import')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() b: ConfirmDto, @Query('wait') wait: string | undefined, @Req() req: any) {
    const parent = await this.getImport(id, req);
    if (parent.status !== 'simulated') throw new BadRequestException(`Seule une simulation peut être confirmée (état : ${parent.status})`);
    const done = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT 1 FROM geo_imports WHERE parent_import_id = $1 AND status IN ('running','completed')`, [id])).rowCount);
    if (done) throw new ConflictException('Cette simulation a déjà été confirmée');
    const stored = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT properties, geometry FROM geo_import_items WHERE import_id = $1 ORDER BY row_no`, [id])).rows);
    const row = await this.db.tx(req.org.id, async (c) => (await c.query(
      `INSERT INTO geo_imports(organization_id, file_name, format, file_sha256, file_size, mode, options, total, created_by, parent_import_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.org.id, parent.file_name, parent.format, parent.file_sha256, parent.file_size, b.mode, JSON.stringify(parent.options), stored.length, req.user.id, id])).rows[0]);
    await this.log(req, 'geo.import.confirm', 'geo_import', row.id, { parent: id, mode: b.mode });
    const job = this.runJob(req.org.id, req.user.id, row.id, stored.map((r: any) => ({ props: r.properties, geometry: r.geometry })), parent.options, b.mode, !!b.all_or_nothing);
    if (wait === 'true') { await job; return this.getImport(row.id, req); }
    return { id: row.id, status: 'running', total: row.total };
  }

  /** Données légères pour la carte du portail (aucune donnée personnelle, non audité comme un export). */
  @Get('map') @RequirePermissions('parcels:read')
  async map(@Req() req: any, @Query() q: Record<string, string>) {
    let bbox: number[] | null = null;
    if (q.bbox) { bbox = q.bbox.split(',').map(Number); if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) throw new BadRequestException('bbox : minLon,minLat,maxLon,maxLat'); }
    const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT p.id, p.code, p.geometry, p.declared_area_ha, p.geometry_area_ha, p.verification_status, pr.internal_code, vc.code AS vc_code,
              EXISTS (SELECT 1 FROM parcel_anomalies a WHERE a.status = 'open' AND (a.parcel_a = p.id OR a.parcel_b = p.id)) AS has_anomaly
         FROM parcels p JOIN producers pr ON pr.id = p.producer_id JOIN value_chains vc ON vc.id = p.value_chain_id
        WHERE p.geometry IS NOT NULL AND p.status = 'active' AND ($1::float8 IS NULL OR p.bbox && box(point($3, $4), point($1, $2)))
        ORDER BY p.code LIMIT 5001`, [bbox ? bbox[2] : null, bbox ? bbox[3] : null, bbox ? bbox[0] : null, bbox ? bbox[1] : null])).rows);
    return {
      type: 'FeatureCollection', truncated: rows.length > 5000,
      features: rows.slice(0, 5000).map((r: any) => ({ type: 'Feature', geometry: r.geometry, properties: {
        id: r.id, code: r.code, producer_code: r.internal_code, filiere: r.vc_code, declared_area_ha: Number(r.declared_area_ha),
        measured_area_ha: r.geometry_area_ha === null ? null : Number(r.geometry_area_ha), validation_status: r.verification_status, anomaly: r.has_anomaly } })),
    };
  }

  // ---- Exportation ----
  @Get('export')
  @RequirePermissions('geo:export')
  async export(@Req() req: any, @Query() q: Record<string, string>) {
    const format = (q.format ?? 'geojson').toLowerCase();
    if (!['geojson', 'kml', 'kmz', 'shapefile', 'gpkg'].includes(format)) throw new BadRequestException('format : geojson, kml, kmz, shapefile ou gpkg');
    const wantNames = q.include_names === 'true';
    if (wantNames && !req.org.permissions.has('geo:export_names')) throw new UnprocessableEntityException("Le nom des producteurs exige la permission « geo:export_names »");
    const extra = (q.fields ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    for (const f of extra) if (!EXTRA_COLS[f]) throw new BadRequestException(`Champ « ${f} » non exportable (disponibles : ${Object.keys(EXTRA_COLS).join(', ')} ; téléphones et données financières ne sont jamais exportés)`);
    let bbox: number[] | null = null;
    if (q.bbox) { bbox = q.bbox.split(',').map(Number); if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) throw new BadRequestException('bbox : minLon,minLat,maxLon,maxLat'); }
    const ids = q.parcel_ids ? q.parcel_ids.split(',').filter(Boolean) : null;
    if (ids && ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) throw new BadRequestException('parcel_ids : liste d\'identifiants');
    const cols = [...BASE_COLS, ...(wantNames ? [NAME_COL] : []), ...extra.map((f) => EXTRA_COLS[f])];
    const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT p.id, p.code, p.geometry, p.declared_area_ha, p.geometry_area_ha, p.longitude, p.latitude, p.verification_status, p.registered_on, p.surveyed_on, p.updated_at,
              p.gps_accuracy_m, p.verified_at, o.code AS coop_code, vc.code AS vc_code, pr.internal_code, pr.last_name || ' ' || pr.first_names AS producer_name,
              pr.section, pr.village, pr.region, u.full_name AS agent,
              EXISTS (SELECT 1 FROM parcel_anomalies a WHERE a.status = 'open' AND (a.parcel_a = p.id OR a.parcel_b = p.id)) AS has_anomaly
         FROM parcels p JOIN producers pr ON pr.id = p.producer_id JOIN value_chains vc ON vc.id = p.value_chain_id JOIN organizations o ON o.id = p.organization_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.geometry IS NOT NULL AND p.status = 'active'
          AND ($1::uuid IS NULL OR p.producer_id = $1) AND ($2::uuid IS NULL OR p.value_chain_id = $2) AND ($3::text IS NULL OR pr.section = $3)
          AND ($4::text IS NULL OR pr.village = $4) AND ($5::text IS NULL OR pr.region = $5) AND ($6::text IS NULL OR p.verification_status = $6)
          AND ($7::date IS NULL OR coalesce(p.surveyed_on, p.registered_on) >= $7) AND ($8::date IS NULL OR coalesce(p.surveyed_on, p.registered_on) <= $8)
          AND ($9::uuid IS NULL OR p.created_by = $9) AND ($10::uuid[] IS NULL OR p.id = ANY($10))
          AND ($11::float8 IS NULL OR p.bbox && box(point($13, $14), point($11, $12)))
        ORDER BY p.code LIMIT 20001`,
      [q.producer_id ?? null, q.value_chain_id ?? null, q.section ?? null, q.village ?? null, q.region ?? null, q.validation_status ?? null, q.from ?? null, q.to ?? null,
       q.agent_id ?? null, ids, bbox ? bbox[0] : null, bbox ? bbox[1] : null, bbox ? bbox[2] : null, bbox ? bbox[3] : null])).rows);
    if (rows.length > 20000) throw new UnprocessableEntityException('Plus de 20 000 parcelles : affiner les filtres');
    const iso = (d: any) => (d ? new Date(d).toISOString() : '');
    const day = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const data: ExportRow[] = rows.map((r: any) => ({
      geometry: r.geometry,
      props: {
        parcel_id: r.id, parcel_code: r.code, producer_code: r.internal_code, cooperative_code: r.coop_code, filiere: r.vc_code,
        declared_area_ha: Number(r.declared_area_ha), measured_area_ha: r.geometry_area_ha === null ? null : Number(r.geometry_area_ha),
        centroid_longitude: r.longitude === null ? null : Number(r.longitude), centroid_latitude: r.latitude === null ? null : Number(r.latitude),
        geometry_status: r.has_anomaly ? 'anomalie' : 'valide', validation_status: r.verification_status, survey_date: day(r.surveyed_on ?? r.registered_on),
        last_updated: iso(r.updated_at), campaign_code: '',
        ...(wantNames ? { producer_name: r.producer_name } : {}),
        section: r.section ?? '', village: r.village ?? '', region: r.region ?? '', agent: r.agent ?? '', gps_accuracy_m: r.gps_accuracy_m === null ? null : Number(r.gps_accuracy_m), verified_at: iso(r.verified_at),
      },
    }));
    // seules les colonnes demandées restent dans les propriétés
    const keep = new Set(cols.map((c) => c.key));
    for (const d of data) for (const k of Object.keys(d.props)) if (!keep.has(k)) delete d.props[k];
    const built = format === 'geojson' ? buildGeoJson(data) : format === 'kml' ? buildKml(data, cols) : format === 'kmz' ? await buildKmz(data, cols)
      : format === 'shapefile' ? await buildShapefile(data, cols) : buildGpkg(data, cols);
    await this.log(req, 'geo.export', 'parcel', null, { format, rows: data.length, include_names: wantNames, fields: extra, filters: { ...q, format: undefined, fields: undefined } });
    return new StreamableFile(built.buffer, { type: built.contentType, disposition: `attachment; filename="parcelles-${req.org.code ?? 'agritrace'}.${built.extension}"` });
  }

  // ---- Anomalies ----
  @Get('anomalies') @RequirePermissions('geo:anomalies')
  async anomalies(@Req() req: any, @Query('status') status?: string, @Query('kind') kind?: string, @Query('parcel_id') parcelId?: string, @Query('limit') limit?: string) {
    const names = req.org.permissions.has('producers:read');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT a.id, a.kind, a.status, a.blocking, a.reference_label, a.reference_feature_id, a.intersection_m2, a.pct_a, a.pct_b, a.iou, a.detected_at, a.source, a.recommended_action, a.assigned_to, a.resolved_at, a.resolution_note,
              pa.id AS parcel_a_id, pa.code AS parcel_a_code, ra.internal_code AS producer_a_code, ${names ? "ra.last_name || ' ' || ra.first_names" : 'NULL'} AS producer_a_name, va.code AS chain_a,
              pb.id AS parcel_b_id, pb.code AS parcel_b_code, rb.internal_code AS producer_b_code, ${names ? "rb.last_name || ' ' || rb.first_names" : 'NULL'} AS producer_b_name, vb.code AS chain_b,
              (SELECT code FROM organizations WHERE id = a.organization_id) AS cooperative
         FROM parcel_anomalies a JOIN parcels pa ON pa.id = a.parcel_a JOIN producers ra ON ra.id = pa.producer_id JOIN value_chains va ON va.id = pa.value_chain_id
         LEFT JOIN parcels pb ON pb.id = a.parcel_b LEFT JOIN producers rb ON rb.id = pb.producer_id LEFT JOIN value_chains vb ON vb.id = pb.value_chain_id
        WHERE ($1::text IS NULL OR a.status = $1) AND ($2::text IS NULL OR a.kind = $2) AND ($3::uuid IS NULL OR a.parcel_a = $3 OR a.parcel_b = $3)
        ORDER BY a.detected_at DESC LIMIT $4`, [status ?? null, kind ?? null, parcelId ?? null, Math.min(Number(limit) || 200, 1000)])).rows);
  }

  @Post('anomalies/:id/resolve') @RequirePermissions('geo:anomalies')
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveDto, @Req() req: any) {
    if (b.resolution === 'exception' && !req.org.permissions.has('geo:override')) throw new UnprocessableEntityException("Une exception exige la permission « geo:override »");
    const row = await this.db.tx(req.org.id, async (c) => {
      const a = (await c.query(`SELECT * FROM parcel_anomalies WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!a) throw new NotFoundException();
      if (a.status !== 'open') throw new BadRequestException(`Anomalie déjà traitée (${a.status})`);
      if (b.resolution === 'corrected' && a.kind === 'protected_overlap' && a.reference_feature_id) {
        const still = await this.svc.stillInProtected(c, a.parcel_a, a.reference_feature_id, await this.svc.settings(c));
        if (still.still) throw new ConflictException(`La parcelle est toujours dans la zone protégée (${still.inter_m2} m²) : corriger le tracé, ou enregistrer une exception motivée`);
      }
      if (b.resolution === 'corrected' && a.parcel_b) {
        const s = await this.svc.settings(c);
        const g = (await c.query(`SELECT id, geometry, status FROM parcels WHERE id = ANY($1)`, [[a.parcel_a, a.parcel_b]])).rows;
        const pa = g.find((x: any) => x.id === a.parcel_a), pb = g.find((x: any) => x.id === a.parcel_b);
        if (pa?.geometry && pb?.geometry && pa.status === 'active' && pb.status === 'active') {
          const r = await this.svc.analyseStored(c, pa.id, pb.id, s);
          if (r.kind === a.kind) throw new ConflictException(`L'anomalie est toujours présente (${r.intersection_m2} m²) : corriger un tracé, ou enregistrer une exception motivée`);
        }
      }
      const st = b.resolution === 'corrected' ? 'resolved' : b.resolution === 'exception' ? 'exception' : 'dismissed';
      return (await c.query(`UPDATE parcel_anomalies SET status = $2, resolved_at = now(), resolved_by = $3, resolution_note = $4 WHERE id = $1 RETURNING *`, [id, st, req.user.id, b.note])).rows[0];
    });
    await this.log(req, `geo.anomaly.${b.resolution}`, 'parcel_anomaly', id, { note: b.note });
    return row;
  }

  @Post('anomalies/:id/assign') @RequirePermissions('geo:anomalies')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const u = await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1`, [b.user_id]);
      if (!u.rowCount) throw new BadRequestException('Utilisateur inconnu dans cette coopérative');
      const r = (await c.query(`UPDATE parcel_anomalies SET assigned_to = $2 WHERE id = $1 AND status = 'open' RETURNING *`, [id, b.user_id])).rows[0];
      if (!r) throw new NotFoundException();
      return r;
    });
    await this.log(req, 'geo.anomaly.assign', 'parcel_anomaly', id, { user_id: b.user_id });
    return row;
  }

  /** Contrôle périodique de l'ensemble des parcelles (CDC §10.1) ; rapport de contrôle. */
  @Post('checks/run') @RequirePermissions('geo:anomalies')
  async run(@Req() req: any) {
    const r = await this.svc.runPeriodic(req.org.id, req.user.id);
    await this.log(req, 'geo.checks.run', 'parcel', null, r);
    return r;
  }

  // ---- Remplacement contrôlé d'un doublon ----
  @Post('merges') @RequirePermissions('geo:merge')
  async merge(@Body() b: MergeDto, @Req() req: any) {
    if (b.keep_id === b.replace_id) throw new BadRequestException('Les deux parcelles doivent être différentes');
    const take = b.take_fields ?? [];
    for (const f of take) if (!['geometry', 'declared_area_ha'].includes(f)) throw new BadRequestException("take_fields : 'geometry' et/ou 'declared_area_ha'");
    const out = await this.db.tx(req.org.id, async (c) => {
      const load = async (id: string) => {
        const p = (await c.query(`SELECT p.*, pr.internal_code AS producer_code FROM parcels p JOIN producers pr ON pr.id = p.producer_id WHERE p.id = $1 FOR UPDATE OF p`, [id])).rows[0];
        if (!p) throw new NotFoundException(`Parcelle ${id} introuvable`);
        const cnt = async (sql: string) => Number((await c.query(sql, [id])).rows[0].n);
        return { ...p, history_events: await cnt(`SELECT count(*) n FROM parcel_history WHERE parcel_id = $1`), inspections: await cnt(`SELECT count(*) n FROM inspections WHERE subject_type = 'parcel' AND subject_id = $1`), documents: await cnt(`SELECT count(*) n FROM documents WHERE subject_type = 'parcel' AND subject_id = $1`) };
      };
      const keep = await load(b.keep_id), rep = await load(b.replace_id);
      for (const p of [keep, rep]) if (p.status !== 'active') throw new BadRequestException(`Parcelle ${p.code} non active (${p.status}${p.merged_into ? ', déjà remplacée' : ''})`);
      const contradictions: string[] = [];
      if (keep.producer_id !== rep.producer_id) contradictions.push(`producteurs différents (${keep.producer_code} / ${rep.producer_code})`);
      if (keep.value_chain_id !== rep.value_chain_id) contradictions.push('filières différentes');
      if (keep.geometry && rep.geometry) {
        const s = await this.svc.settings(c);
        const r = await this.svc.analyseStored(c, keep.id, rep.id, s);
        if (!r.kind || r.kind === 'overlap_partial') contradictions.push(`les tracés ne représentent pas le même terrain (recouvrement ${r.pct_a} % / ${r.pct_b} %)`);
      }
      const summary = (p: any) => ({ id: p.id, code: p.code, producer_code: p.producer_code, declared_area_ha: p.declared_area_ha, measured_area_ha: p.geometry_area_ha, has_polygon: !!p.geometry, verification_status: p.verification_status, history_events: p.history_events, inspections: p.inspections, documents: p.documents, geometry: p.geometry });
      const preview = { keep: summary(keep), replace: summary(rep), contradictions, will_carry: take.filter((f) => f === 'declared_area_ha' || (f === 'geometry' && !keep.geometry && rep.geometry)) };
      if (contradictions.length) throw new ConflictException({ message: 'Contradictions importantes : vérification manuelle requise, fusion refusée', ...preview });
      if (!b.confirm) return { confirmed: false, ...preview };

      const carried: string[] = [];
      await c.query(`UPDATE parcels SET status = 'archived', merged_into = $2, geometry_hash = NULL, updated_at = now() WHERE id = $1`, [rep.id, keep.id]);
      if (take.includes('geometry') && !keep.geometry && rep.geometry) {
        const cen = centroid(rep.geometry);
        await c.query(`UPDATE parcels SET geometry = $2, geometry_area_ha = $3, geometry_hash = $4, latitude = $5, longitude = $6, updated_at = now() WHERE id = $1`,
          [keep.id, JSON.stringify(rep.geometry), Number(polygonAreaHa(rep.geometry).toFixed(4)), geometryHash(rep.geometry), Number(cen.lat.toFixed(6)), Number(cen.lon.toFixed(6))]);
        carried.push('geometry');
      }
      if (take.includes('declared_area_ha')) { await c.query(`UPDATE parcels SET declared_area_ha = $2, updated_at = now() WHERE id = $1`, [keep.id, rep.declared_area_ha]); carried.push('declared_area_ha'); }
      const snapshot = { ...rep }; delete (snapshot as any).history_events;
      await c.query(`INSERT INTO parcel_merges(organization_id, kept_id, replaced_id, reason, carried_fields, snapshot_replaced, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.org.id, keep.id, rep.id, b.reason, JSON.stringify(carried), JSON.stringify(snapshot), req.user.id]);
      for (const [pid, role, other] of [[keep.id, 'conservée', rep.code], [rep.id, 'remplacée', keep.code]] as const)
        await c.query(`INSERT INTO parcel_history(organization_id, parcel_id, event, from_status, to_status, details, actor_id) VALUES ($1,$2,'merged',$3,$4,$5,$6)`,
          [req.org.id, pid, 'active', pid === rep.id ? 'archived' : 'active', JSON.stringify({ role, other, reason: b.reason, carried }), req.user.id]);
      await c.query(`UPDATE parcel_anomalies SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = $3 WHERE status = 'open' AND (parcel_a = $1 OR parcel_b = $1)`,
        [rep.id, req.user.id, `Doublon remplacé par ${keep.code}`]);
      const detected = await this.svc.detectForParcel(c, req.org.id, keep.id, req.user.id, 'edit');
      return { confirmed: true, ...preview, carried, new_anomalies: detected.length };
    });
    if (out.confirmed) await this.log(req, 'geo.merge', 'parcel', b.keep_id, { replaced: b.replace_id, reason: b.reason, carried: (out as any).carried });
    return out;
  }
}
