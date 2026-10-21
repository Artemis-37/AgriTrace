import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnprocessableEntityException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { GeoFormatError, parseGeoFile } from './formats';
import { MAX_REF_VERTICES, prepareFeatures } from './reference-core';
import { GeoService } from './geo.service';

const MAX_LAYER_BYTES = 50 * 1024 * 1024;
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * Couches de référence : zones protégées (parcs, réserves, forêts classées…). Chargées par l'administrateur de la coopérative depuis un fichier
 * (GeoJSON, KML/KMZ, Shapefile zippé, GeoPackage ; WGS84 ou Web Mercator comme le WDPA). Les parcelles sont ensuite contrôlées contre ces zones
 * (anomalie « protected_overlap »). Les couches restent sur le serveur de la coopérative : elles ne sont pas répliquées vers le central.
 */
@ApiTags('cartographie : couches de référence')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('geo/layers')
export class ReferenceLayersController {
  constructor(private readonly db: DbService, private readonly svc: GeoService, private readonly audit: AuditService) {}

  @Post() @RequirePermissions('geo:layers')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LAYER_BYTES, files: 1 } }))
  async load(@UploadedFile() file: Express.Multer.File,
             @Body() b: { name?: string; code?: string; source?: string; license?: string; attribution?: string; replace?: string; layer?: string }, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ « file »)');
    const name = (b.name ?? '').trim();
    if (name.length < 2 || name.length > 120) throw new BadRequestException('Nom de la couche : 2 à 120 caractères');
    const code = (b.code ?? slug(name)).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) throw new BadRequestException('Code de couche invalide (lettres minuscules, chiffres, - et _, 2 à 40 caractères)');
    let parsed;
    try { parsed = await parseGeoFile(file.buffer, file.originalname, { allowWebMercator: true, layer: b.layer }); }
    catch (e) { if (e instanceof GeoFormatError) throw new UnprocessableEntityException(e.message); throw e; }
    const prep = prepareFeatures(parsed.features);
    if (!prep.features.length) throw new UnprocessableEntityException({ message: 'Aucune zone exploitable dans ce fichier (polygones attendus)', skipped: prep.skipped });
    if (prep.vertices_after > MAX_REF_VERTICES) throw new UnprocessableEntityException(`Couche trop détaillée (${prep.vertices_after} sommets après simplification, maximum ${MAX_REF_VERTICES}) : découpez-la à votre région`);
    const replace = b.replace === 'true';
    const sha = createHash('sha256').update(file.buffer).digest('hex');

    const res = await this.db.tx(req.org.id, async (c) => {
      const existing = (await c.query(`SELECT id FROM reference_layers WHERE code = $1`, [code])).rows[0];
      if (existing && !replace) throw new ConflictException(`La couche « ${code} » existe déjà : renvoyer avec replace=true pour la remplacer`);
      if (existing) {
        await c.query(`UPDATE parcel_anomalies SET status = 'dismissed', resolved_at = now(), resolved_by = $2, resolution_note = 'Couche remplacée : anomalie réévaluée'
                        WHERE status = 'open' AND kind = 'protected_overlap' AND reference_feature_id IN (SELECT id FROM reference_features WHERE layer_id = $1)`, [existing.id, req.user.id]);
        await c.query(`DELETE FROM reference_features WHERE layer_id = $1`, [existing.id]);
        await c.query(`DELETE FROM reference_layers WHERE id = $1`, [existing.id]);
      }
      const layer = (await c.query(
        `INSERT INTO reference_layers(organization_id, code, name, source, license, attribution, filename, sha256, feature_count, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, code, name, feature_count, imported_at`,
        [req.org.id, code, name, b.source?.slice(0, 300) || null, b.license?.slice(0, 300) || null, b.attribution?.slice(0, 300) || null,
         file.originalname.slice(0, 200), sha, prep.features.length, req.user.id])).rows[0];
      for (let i = 0; i < prep.features.length; i += 100) {
        const rows = prep.features.slice(i, i + 100).map((f) => ({ ...f, minx: f.bbox[0], miny: f.bbox[1], maxx: f.bbox[2], maxy: f.bbox[3] }));
        await c.query(
          `INSERT INTO reference_features(organization_id, layer_id, name, designation, category, status, year, properties, geometry, bbox, area_ha)
           SELECT $1, $2, r.name, r.designation, r.category, r.status, r.year, r.properties, r.geometry, box(point(r.maxx, r.maxy), point(r.minx, r.miny)), r.area_ha
             FROM jsonb_to_recordset($3::jsonb) AS r(name text, designation text, category text, status text, year int, properties jsonb, geometry jsonb, minx float8, miny float8, maxx float8, maxy float8, area_ha numeric)`,
          [req.org.id, layer.id, JSON.stringify(rows)]);
      }
      const s = await this.svc.settings(c);
      const scan = await this.svc.runProtectedScan(c, req.org.id, req.user.id, s, 'import');
      return { layer, scan };
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'geo.layer.load', entityType: 'reference_layer', entityId: res.layer.id,
      details: { code, features: prep.features.length, skipped: prep.skipped, replaced: replace, overlaps_found: res.scan.found, sha256: sha } });
    return {
      ...res.layer, features: prep.features.length, skipped: prep.skipped, warnings: parsed.warnings,
      simplification: { vertices_before: prep.vertices_before, vertices_after: prep.vertices_after },
      parcels_in_zones: res.scan,
    };
  }

  @Get() @RequirePermissions('geo:anomalies')
  async list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT l.id, l.code, l.name, l.kind, l.source, l.license, l.attribution, l.filename, l.feature_count, l.imported_at,
              (SELECT count(*)::int FROM parcel_anomalies a WHERE a.status = 'open' AND a.kind = 'protected_overlap' AND a.reference_feature_id IN (SELECT id FROM reference_features WHERE layer_id = l.id)) AS open_overlaps
         FROM reference_layers l ORDER BY l.imported_at DESC`)).rows);
  }

  @Get(':id/features') @RequirePermissions('geo:anomalies')
  async features(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, name, designation, category, status, year, area_ha::float8 AS area_ha, properties FROM reference_features WHERE layer_id = $1 ORDER BY name LIMIT 5000`, [id])).rows);
  }

  /** Contours pour la carte (GeoJSON). `bbox=minx,miny,maxx,maxy` limite aux zones visibles. */
  @Get(':id/geojson') @RequirePermissions('geo:anomalies')
  async geojson(@Param('id', ParseUUIDPipe) id: string, @Query('bbox') bbox: string | undefined, @Req() req: any) {
    let box: number[] | null = null;
    if (bbox) { box = bbox.split(',').map(Number); if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) throw new BadRequestException('bbox attendue : minx,miny,maxx,maxy'); }
    const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, name, designation, category, status, year, area_ha::float8 AS area_ha, geometry FROM reference_features
        WHERE layer_id = $1 AND ($2::text IS NULL OR bbox && box(point($5::float8, $6::float8), point($3::float8, $4::float8))) ORDER BY name LIMIT 5000`,
      [id, box ? 'x' : null, box?.[0] ?? 0, box?.[1] ?? 0, box?.[2] ?? 0, box?.[3] ?? 0])).rows);
    return { type: 'FeatureCollection', features: rows.map((r: any) => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: { name: r.name, designation: r.designation, category: r.category, status: r.status, year: r.year, area_ha: r.area_ha } })) };
  }

  /** Relance le contrôle de toutes les parcelles contre les zones protégées (après un changement de seuils, par exemple). */
  @Post('rescan') @RequirePermissions('geo:layers')
  async rescan(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => this.svc.runProtectedScan(c, req.org.id, req.user.id, await this.svc.settings(c), 'periodic'));
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('geo:layers')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const l = await this.db.tx(req.org.id, async (c) => {
      const layer = (await c.query(`SELECT id, code, name FROM reference_layers WHERE id = $1`, [id])).rows[0];
      if (!layer) throw new NotFoundException('Couche introuvable');
      await c.query(`UPDATE parcel_anomalies SET status = 'dismissed', resolved_at = now(), resolved_by = $2, resolution_note = 'Couche retirée'
                      WHERE status = 'open' AND kind = 'protected_overlap' AND reference_feature_id IN (SELECT id FROM reference_features WHERE layer_id = $1)`, [id, req.user.id]);
      await c.query(`DELETE FROM reference_features WHERE layer_id = $1`, [id]);
      await c.query(`DELETE FROM reference_layers WHERE id = $1`, [id]);
      return layer;
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'geo.layer.delete', entityType: 'reference_layer', entityId: id, details: { code: l.code, name: l.name } });
  }
}
