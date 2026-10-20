import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { GeoService } from '../geo/geo.service';
import { geometryHash } from '../geo/geo-core';
import { isUniqueViolation } from '../common/dto';
import { areaGapPct, centroid, polygonAreaHa, validatePolygon } from './geo';

const DUP_RADIUS_M = 50;
const AREA_GAP_PCT = 20;
// Distance de Haversine (m) entre deux points ; PostGIS n'est pas requis.
const HAV = (a: string, b: string, c: string, d: string) =>
  `(2 * 6371008.8 * asin(sqrt(power(sin(radians((${c}) - (${a})) / 2), 2) + cos(radians(${a})) * cos(radians(${c})) * power(sin(radians((${d}) - (${b})) / 2), 2))))`;

export class CreateParcelDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() producer_id: string;
  @IsUUID() value_chain_id: string;
  @Dec(4) declared_area_ha: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsObject() geometry?: any;
  @IsOptional() @IsBoolean() confirm_not_duplicate?: boolean;
}
class UpdateParcelDto {
  @IsOptional() @Dec(4) declared_area_ha?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsObject() geometry?: any;
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
class NoteDto { @IsOptional() @IsString() @Length(1, 500) note?: string; }

@ApiTags('parcelles')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ParcelsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly geoSvc: GeoService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'parcel', entityId: id, details });
  }
  private hist(c: PoolClient, orgId: string, parcelId: string, event: string, actor: string, from?: string, to?: string, details?: any) {
    return c.query(`INSERT INTO parcel_history(organization_id, parcel_id, event, from_status, to_status, details, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, parcelId, event, from ?? null, to ?? null, details ? JSON.stringify(details) : null, actor]);
  }
  private async lock(c: PoolClient, id: string) {
    const r = await c.query(`SELECT * FROM parcels WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0];
  }
  /** Normalise position et géométrie : la surface mesurée est calculée par le serveur, jamais saisie. */
  private geo(b: { latitude?: number; longitude?: number; geometry?: any }) {
    if ((b.latitude === undefined) !== (b.longitude === undefined)) throw new BadRequestException('Latitude et longitude vont ensemble');
    let lat = b.latitude ?? null, lon = b.longitude ?? null, geom: any = null, area: number | null = null;
    if (b.geometry) {
      const err = validatePolygon(b.geometry);
      if (err) throw new BadRequestException(err);
      geom = b.geometry; area = polygonAreaHa(geom);
      if (lat === null) { const c = centroid(geom); lat = Number(c.lat.toFixed(6)); lon = Number(c.lon.toFixed(6)); }
    }
    return { lat, lon, geom, area: area === null ? null : Number(area.toFixed(4)) };
  }

  @Post('parcels')
  @RequirePermissions('parcels:create')
  async create(@Body() b: CreateParcelDto, @Req() req: any) {
    if (Number(b.declared_area_ha) <= 0) throw new BadRequestException('Superficie déclarée doit être supérieure à zéro');
    const g = this.geo(b);
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM parcels WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) {
        const p = prev.rows[0];
        if (p.producer_id !== b.producer_id || p.value_chain_id !== b.value_chain_id) throw new ConflictException("Cette clé d'idempotence a déjà servi pour une autre parcelle");
        return { row: p, replay: true, anomalies: [] as any[] };
      }
      const ok = await c.query(`SELECT (SELECT status FROM producers WHERE id = $1) AS p, EXISTS (SELECT 1 FROM value_chains WHERE id = $2) AS v`, [b.producer_id, b.value_chain_id]);
      if (ok.rows[0].p !== 'active') throw new BadRequestException('Producteur inconnu ou inactif');
      if (!ok.rows[0].v) throw new BadRequestException('Filière inconnue');
      if (g.lat !== null && !b.confirm_not_duplicate) {
        const dup = await c.query(
          `SELECT id, code, producer_id, ${HAV('latitude', 'longitude', '$1::numeric', '$2::numeric')}::int AS distance_m FROM parcels
            WHERE status = 'active' AND latitude IS NOT NULL AND ${HAV('latitude', 'longitude', '$1::numeric', '$2::numeric')} < ${DUP_RADIUS_M} ORDER BY 4 LIMIT 5`, [g.lat, g.lon]);
        if (dup.rowCount) throw new ConflictException({ message: `Parcelle potentiellement en double (à moins de ${DUP_RADIUS_M} m d'une parcelle existante). Renvoyer avec confirm_not_duplicate=true si c'est voulu.`, candidates: dup.rows });
      }
      // Code « CODE_PRODUCTEUR-Pn » : compteur du producteur incrémenté sous verrou de ligne, donc sans doublon en cas de créations simultanées
      // et sans réattribution après archivage (CDC §8.2).
      const seq = (await c.query(`UPDATE producers SET parcel_seq = parcel_seq + 1 WHERE id = $1 RETURNING parcel_seq, internal_code`, [b.producer_id])).rows[0];
      const code = `${seq.internal_code}-P${seq.parcel_seq}`;
      const row = (await c.query(
        `INSERT INTO parcels(organization_id, code, idempotency_key, producer_id, value_chain_id, declared_area_ha, latitude, longitude, geometry, geometry_area_ha, geometry_hash, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, code, b.idempotency_key, b.producer_id, b.value_chain_id, b.declared_area_ha, g.lat, g.lon, g.geom ? JSON.stringify(g.geom) : null, g.area, g.geom ? geometryHash(g.geom) : null, req.user.id])).rows[0];
      await this.hist(c, req.org.id, row.id, 'created', req.user.id, undefined, 'declared');
      // doublons et chevauchements : enregistrés comme anomalies (bloquantes selon la politique de la coopérative)
      const anomalies = g.geom ? await this.geoSvc.detectForParcel(c, req.org.id, row.id, req.user.id, 'edit') : [];
      return { row, replay: false, anomalies };
    }).catch((e) => {
      if (isUniqueViolation(e) && String(e.constraint).includes('uq_parcels_geom_producer'))
        throw new ConflictException('Un tracé identique existe déjà pour ce producteur : parcelle déjà enregistrée (utiliser la mise à jour ou le remplacement de doublon)');
      throw e;
    });
    if (!out.replay) await this.log(req, 'parcel.create', out.row.id, { code: out.row.code });
    return { ...out.row, replayed: out.replay, anomalies: out.anomalies };
  }

  /** Toute modification des données repasse la parcelle à « déclarée » : un contrôle ou une vérification ne couvre pas des données changées. */
  @Post('parcels/:id/update')
  @RequirePermissions('parcels:update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateParcelDto, @Req() req: any) {
    if (b.declared_area_ha === undefined && b.latitude === undefined && b.geometry === undefined) throw new BadRequestException('Aucune modification fournie');
    if (b.declared_area_ha !== undefined && Number(b.declared_area_ha) <= 0) throw new BadRequestException('Superficie déclarée doit être supérieure à zéro');
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (p.status !== 'active') throw new BadRequestException('Parcelle archivée');
      const g = (b.latitude !== undefined || b.geometry !== undefined) ? this.geo(b) : { lat: p.latitude, lon: p.longitude, geom: p.geometry, area: p.geometry_area_ha };
      const reset = p.verification_status !== 'declared';
      const r = (await c.query(
        `UPDATE parcels SET declared_area_ha = coalesce($2, declared_area_ha), latitude = $3, longitude = $4, geometry = $5, geometry_area_ha = $6, geometry_hash = $7,
                verification_status = 'declared', controlled_at = NULL, controlled_by = NULL, verified_at = NULL, verified_by = NULL, verified_inspection_id = NULL, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, b.declared_area_ha ?? null, g.lat, g.lon, g.geom ? (typeof g.geom === 'string' ? g.geom : JSON.stringify(g.geom)) : null, g.area, g.geom ? geometryHash(typeof g.geom === 'string' ? JSON.parse(g.geom) : g.geom) : null])).rows[0];
      // historique complet (CDC §8.6) : anciennes et nouvelles valeurs, motif, auteur, date
      await this.hist(c, req.org.id, id, 'updated', req.user.id, p.verification_status, 'declared', {
        fields: Object.keys(b).filter((k) => k !== 'reason'), reason: b.reason ?? null,
        old: { geometry: p.geometry, geometry_area_ha: p.geometry_area_ha, declared_area_ha: p.declared_area_ha, latitude: p.latitude, longitude: p.longitude },
        new: { geometry: r.geometry, geometry_area_ha: r.geometry_area_ha, declared_area_ha: r.declared_area_ha, latitude: r.latitude, longitude: r.longitude },
      });
      if (b.geometry !== undefined) {
        const found = await this.geoSvc.detectForParcel(c, req.org.id, id, req.user.id, 'edit');
        if (found.length) await this.hist(c, req.org.id, id, 'updated', req.user.id, undefined, undefined, { spatial_check: found.map((f) => ({ kind: f.kind, with: f.other_code, intersection_m2: f.intersection_m2 })) });
      }
      if (reset) await this.hist(c, req.org.id, id, 'reset', req.user.id, p.verification_status, 'declared', { reason: 'données modifiées' });
      return r;
    }).catch((e) => {
      if (isUniqueViolation(e) && String(e.constraint).includes('uq_parcels_geom_producer'))
        throw new ConflictException('Un tracé identique existe déjà pour ce producteur');
      throw e;
    });
    await this.log(req, 'parcel.update', id, { fields: Object.keys(b) });
    return row;
  }

  /** Une anomalie bloquante (doublon, chevauchement interdit) empêche toute validation tant qu'elle n'est pas résolue ou qu'une exception motivée n'est pas enregistrée. */
  private async assertNoBlockingAnomaly(c: PoolClient, id: string) {
    const b = await this.geoSvc.blockingFor(c, id);
    if (b.length) throw new UnprocessableEntityException({
      message: `Validation bloquée : ${b.length} anomalie(s) cartographique(s) à résoudre (${b.map((x: any) => `${x.kind} avec ${x.other_code}`).join(' ; ')})`,
      anomalies: b,
    });
  }

  /** Contrôle : les données sont complètes et cohérentes (position présente, surface mesurée proche de la déclarée). */
  @Post('parcels/:id/control')
  @RequirePermissions('parcels:control')
  async control(@Param('id', ParseUUIDPipe) id: string, @Body() b: NoteDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (p.verification_status !== 'declared') throw new BadRequestException(`Statut ${p.verification_status} : contrôle impossible`);
      await this.assertNoBlockingAnomaly(c, id);
      if (p.latitude === null) throw new UnprocessableEntityException('Coordonnées GPS manquantes : contrôle impossible');
      if (p.geometry_area_ha !== null && areaGapPct(Number(p.declared_area_ha), Number(p.geometry_area_ha)) > AREA_GAP_PCT)
        throw new UnprocessableEntityException(`Superficie incohérente : déclarée ${p.declared_area_ha} ha, mesurée ${p.geometry_area_ha} ha (écart > ${AREA_GAP_PCT} %)`);
      const r = (await c.query(`UPDATE parcels SET verification_status = 'controlled', controlled_at = now(), controlled_by = $2 WHERE id = $1 RETURNING *`, [id, req.user.id])).rows[0];
      await this.hist(c, req.org.id, id, 'controlled', req.user.id, 'declared', 'controlled', b.note ? { note: b.note } : undefined);
      return r;
    });
    await this.log(req, 'parcel.control', id);
    return row;
  }

  /** Vérification : exige une inspection de terrain conforme, terminée après la dernière modification des données. */
  @Post('parcels/:id/verify')
  @RequirePermissions('parcels:verify')
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() b: NoteDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (p.verification_status !== 'controlled') throw new BadRequestException(`Statut ${p.verification_status} : la parcelle doit d'abord être contrôlée`);
      await this.assertNoBlockingAnomaly(c, id);
      const ins = (await c.query(
        `SELECT id FROM inspections WHERE subject_type = 'parcel' AND subject_id = $1 AND kind = 'field' AND status = 'completed' AND outcome = 'compliant'
            AND completed_at > (SELECT max(at) FROM parcel_history WHERE parcel_id = $1 AND event IN ('created','updated'))
          ORDER BY completed_at DESC LIMIT 1`, [id])).rows[0];
      if (!ins) throw new UnprocessableEntityException("Aucune inspection de terrain conforme postérieure aux dernières modifications : vérification impossible");
      const r = (await c.query(`UPDATE parcels SET verification_status = 'verified', verified_at = now(), verified_by = $2, verified_inspection_id = $3 WHERE id = $1 RETURNING *`, [id, req.user.id, ins.id])).rows[0];
      await this.hist(c, req.org.id, id, 'verified', req.user.id, 'controlled', 'verified', { inspection_id: ins.id, note: b.note });
      return r;
    });
    await this.log(req, 'parcel.verify', id);
    return row;
  }

  @Post('parcels/:id/archive')
  @RequirePermissions('parcels:update')
  async archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const p = await this.lock(c, id);
      if (p.status === 'archived') throw new BadRequestException('Déjà archivée');
      await c.query(`UPDATE parcels SET status = 'archived', updated_at = now() WHERE id = $1`, [id]);
      await this.hist(c, req.org.id, id, 'archived', req.user.id);
    });
    await this.log(req, 'parcel.archive', id);
    return { id, status: 'archived' };
  }

  /** Contrôles de qualité des données (cahier des charges §7). */
  @Get('parcels/checks')
  @RequirePermissions('parcels:read')
  async checks(@Req() req: any, @Query('renewal_months') rm?: string) {
    const m = Math.min(Math.max(Number(rm) || 12, 1), 60);
    return this.db.tx(req.org.id, async (c) => {
      const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
      const missing_coordinates = await q(`SELECT id, code, producer_id FROM parcels WHERE status = 'active' AND latitude IS NULL ORDER BY code`);
      const potential_duplicates = await q(
        `SELECT a.id AS parcel_a, a.code AS code_a, b.id AS parcel_b, b.code AS code_b, ${HAV('a.latitude', 'a.longitude', 'b.latitude', 'b.longitude')}::int AS distance_m
           FROM parcels a JOIN parcels b ON a.id < b.id AND b.status = 'active' AND b.latitude IS NOT NULL
          WHERE a.status = 'active' AND a.latitude IS NOT NULL AND ${HAV('a.latitude', 'a.longitude', 'b.latitude', 'b.longitude')} < ${DUP_RADIUS_M} ORDER BY distance_m LIMIT 200`);
      const inconsistent_area = await q(
        `SELECT id, code, declared_area_ha, geometry_area_ha, round(abs(declared_area_ha - geometry_area_ha) / declared_area_ha * 100, 1) AS gap_pct
           FROM parcels WHERE status = 'active' AND geometry_area_ha IS NOT NULL AND abs(declared_area_ha - geometry_area_ha) / declared_area_ha * 100 > ${AREA_GAP_PCT} ORDER BY gap_pct DESC`);
      const inspections_to_renew = await q(
        `SELECT p.id, p.code, max(i.completed_at) AS last_inspection FROM parcels p
           LEFT JOIN inspections i ON i.subject_type = 'parcel' AND i.subject_id = p.id AND i.status = 'completed'
          WHERE p.status = 'active' GROUP BY p.id HAVING max(i.completed_at) IS NULL OR max(i.completed_at) < now() - make_interval(months => $1::int)
          ORDER BY max(i.completed_at) NULLS FIRST LIMIT 200`, [m]);
      const lists = { missing_coordinates, potential_duplicates, inconsistent_area, inspections_to_renew };
      return { duplicate_radius_m: DUP_RADIUS_M, area_gap_threshold_pct: AREA_GAP_PCT, renewal_months: m,
        counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])), ...lists };
    });
  }

  @Get('parcels')
  @RequirePermissions('parcels:read')
  list(@Req() req: any, @Query('producer_id') producerId?: string, @Query('verification_status') vs?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, code, producer_id, value_chain_id, declared_area_ha, geometry_area_ha, latitude, longitude, verification_status, status, registered_on
         FROM parcels WHERE ($1::uuid IS NULL OR producer_id = $1::uuid) AND ($2::text IS NULL OR verification_status = $2) ORDER BY code LIMIT 1000`,
      [producerId ?? null, vs ?? null])).rows);
  }

  @Get('parcels/:id')
  @RequirePermissions('parcels:read')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const p = (await c.query(`SELECT * FROM parcels WHERE id = $1`, [id])).rows[0];
      if (!p) throw new NotFoundException();
      const history = (await c.query(`SELECT event, from_status, to_status, details, actor_id, at FROM parcel_history WHERE parcel_id = $1 ORDER BY seq`, [id])).rows;
      const inspections = (await c.query(`SELECT id, kind, status, outcome, completed_at FROM inspections WHERE subject_type = 'parcel' AND subject_id = $1 ORDER BY coalesce(completed_at, created_at) DESC`, [id])).rows;
      const documents = (await c.query(`SELECT id, kind, filename, version, uploaded_at FROM documents WHERE subject_type = 'parcel' AND subject_id = $1 ORDER BY uploaded_at DESC`, [id])).rows;
      return { ...p, data_levels: { declared: true, controlled: ['controlled', 'verified'].includes(p.verification_status), verified: p.verification_status === 'verified' }, history, inspections, documents };
    });
  }
}
