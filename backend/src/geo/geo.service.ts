import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DbService } from '../db/db.service';
import { Polygon } from '../parcels/geo';
import { analysePair, AnomalyKind, classifyPair, DEFAULT_GEO_SETTINGS, GeoSettings, isBlocking, PairAnalysis, RECOMMENDED } from './geo-core';

export type GeoEngineName = 'postgis' | 'js';

/**
 * Mesures d'un couple de parcelles calculées par PostGIS (colonne générée `parcels.geom`, index GiST).
 * Surfaces sur l'ellipsoïde WGS84 (geography) ; intersection en géométrie plane après correction éventuelle des tracés invalides.
 * `a` et `b` sont deux alias de la table `parcels` ; l'égalité d'emprise utilise l'index (&&) puis ST_Intersects exact.
 */
const PG_METRICS = (a: string, b: string) => `
  (${a}.geometry->'coordinates' = ${b}.geometry->'coordinates') AS same_raw,
  e.eq AS equivalent,
  ST_Area(${a}.geom::geography) AS area_a, ST_Area(${b}.geom::geography) AS area_b,
  CASE WHEN e.eq THEN 0 ELSE ST_Area(ST_CollectionExtract(ST_Intersection(ST_MakeValid(${a}.geom), ST_MakeValid(${b}.geom)), 3)::geography) END AS inter`;
const PG_EQUAL = (a: string, b: string) => `CROSS JOIN LATERAL (SELECT ST_Equals(ST_MakeValid(ST_SnapToGrid(${a}.geom, 1e-7)), ST_MakeValid(ST_SnapToGrid(${b}.geom, 1e-7))) AS eq) e`;
const toMetrics = (r: any) => ({ sameRaw: !!r.same_raw, equivalent: !!r.equivalent, areaA_m2: Number(r.area_a), areaB_m2: Number(r.area_b), intersection_m2: Number(r.inter ?? 0) });

export interface DetectedAnomaly { id: string; kind: AnomalyKind; other_id: string; other_code: string; intersection_m2: number; blocking: boolean }

@Injectable()
export class GeoService {
  constructor(readonly db: DbService, readonly audit: AuditService, readonly notif: NotificationsService) {}

  private engineCache?: { at: number; name: GeoEngineName };

  /**
   * Moteur de calcul : PostGIS quand la colonne `parcels.geom` existe (migration facultative), sinon calcul par l'application.
   * `GEO_ENGINE=js` force le repli (comparaison, dépannage) ; `GEO_ENGINE=postgis` l'exige et le journalise s'il manque.
   */
  async engine(c: PoolClient): Promise<GeoEngineName> {
    const forced = (process.env.GEO_ENGINE ?? 'auto').toLowerCase();
    if (forced === 'js') return 'js';
    if (this.engineCache && Date.now() - this.engineCache.at < 60_000) return this.engineCache.name;
    const on = (await c.query(`SELECT 1 FROM pg_attribute WHERE attrelid = 'parcels'::regclass AND attname = 'geom' AND NOT attisdropped`)).rowCount! > 0;
    if (!on && forced === 'postgis') console.warn('GEO_ENGINE=postgis demandé mais PostGIS n\'est pas activé sur cette base : repli sur le calcul par l\'application');
    this.engineCache = { at: Date.now(), name: on ? 'postgis' : 'js' };
    return this.engineCache.name;
  }

  /** Compare deux parcelles enregistrées avec le moteur en service. */
  async analyseStored(c: PoolClient, idA: string, idB: string, s: GeoSettings): Promise<PairAnalysis> {
    if (await this.engine(c) === 'postgis') {
      const r = (await c.query(
        `SELECT ${PG_METRICS('a', 'b')} FROM parcels a JOIN parcels b ON b.id = $2 ${PG_EQUAL('a', 'b')}
          WHERE a.id = $1 AND a.geom IS NOT NULL AND b.geom IS NOT NULL AND ST_Intersects(a.geom, b.geom)`, [idA, idB])).rows[0];
      return r ? classifyPair(toMetrics(r), s) : { kind: null, intersection_m2: 0, pct_a: 0, pct_b: 0, iou: 0 };
    }
    const g = (await c.query(`SELECT id, geometry FROM parcels WHERE id = ANY($1)`, [[idA, idB]])).rows;
    const ga = g.find((x: any) => x.id === idA)?.geometry, gb = g.find((x: any) => x.id === idB)?.geometry;
    return ga && gb ? analysePair(ga, gb, s) : { kind: null, intersection_m2: 0, pct_a: 0, pct_b: 0, iou: 0 };
  }

  async settings(c: PoolClient): Promise<GeoSettings> {
    const r = (await c.query(
      `SELECT geo_overlap_min_m2::float8 AS overlap_min_m2, geo_overlap_min_pct::float8 AS overlap_min_pct,
              geo_near_duplicate_iou::float8 AS near_duplicate_iou, geo_overlap_policy AS overlap_policy FROM org_settings`)).rows[0];
    return r ?? { ...DEFAULT_GEO_SETTINGS };
  }

  private async record(c: PoolClient, orgId: string, a: { id: string; code: string }, b: { id: string; code: string }, r: ReturnType<typeof analysePair>,
                       s: GeoSettings, userId: string | null, source: 'edit' | 'import' | 'periodic'): Promise<DetectedAnomaly | null> {
    if (!r.kind) return null;
    // ordre canonique du couple : pas de doublon A/B et B/A
    const swap = a.id > b.id;
    const [pa, pb] = swap ? [b, a] : [a, b];
    const [ppa, ppb] = swap ? [r.pct_b, r.pct_a] : [r.pct_a, r.pct_b];
    // une exception déjà accordée pour ce couple et ce type n'est pas rouverte
    const exc = await c.query(`SELECT 1 FROM parcel_anomalies WHERE kind = $1 AND parcel_a = $2 AND parcel_b = $3 AND status = 'exception' LIMIT 1`, [r.kind, pa.id, pb.id]);
    if (exc.rowCount) return null;
    const ins = await c.query(
      `INSERT INTO parcel_anomalies(organization_id, kind, parcel_a, parcel_b, intersection_m2, pct_a, pct_b, iou, blocking, recommended_action, detected_by, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, r.kind, pa.id, pb.id, r.intersection_m2, ppa, ppb, r.iou, isBlocking(r.kind, s), RECOMMENDED[r.kind], userId, source]);
    if (!ins.rowCount) return null;
    for (const p of [pa, pb])
      await c.query(`INSERT INTO parcel_history(organization_id, parcel_id, event, details, actor_id) VALUES ($1,$2,'anomaly',$3,$4)`,
        [orgId, p.id, JSON.stringify({ anomaly_id: ins.rows[0].id, kind: r.kind, with: p.id === pa.id ? pb.code : pa.code }), userId ?? '00000000-0000-0000-0000-000000000000']);
    await this.notif.notifyPermission(c, orgId, 'geo:anomalies', { kind: 'geo_anomaly', severity: isBlocking(r.kind, s) ? 'critical' : 'warning',
      title: `${r.kind.startsWith('duplicate') ? 'Doublon' : 'Chevauchement'} cartographique : ${pa.code} / ${pb.code}`, body: `${Math.round(Number(r.intersection_m2))} m² en commun`,
      entityType: 'parcel_anomaly', entityId: ins.rows[0].id, dedupe: `geo_anomaly:${ins.rows[0].id}` }, userId ?? undefined);
    return { id: ins.rows[0].id, kind: r.kind, other_id: b.id, other_code: b.code, intersection_m2: r.intersection_m2, blocking: isBlocking(r.kind, s) };
  }

  /**
   * Contrôle d'une parcelle contre toutes les autres (création, modification de géométrie, import, validation).
   * Les anomalies encore ouvertes d'une ancienne géométrie sont refermées avant la nouvelle évaluation.
   */
  async detectForParcel(c: PoolClient, orgId: string, parcelId: string, userId: string | null, source: 'edit' | 'import' | 'periodic', s?: GeoSettings): Promise<DetectedAnomaly[]> {
    const settings = s ?? (await this.settings(c));
    const me = (await c.query(`SELECT id, code, geometry FROM parcels WHERE id = $1`, [parcelId])).rows[0];
    if (!me) return [];
    await c.query(
      `UPDATE parcel_anomalies SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = 'Géométrie modifiée : anomalie réévaluée'
        WHERE status = 'open' AND (parcel_a = $1 OR parcel_b = $1)`, [parcelId, userId]);
    if (!me.geometry) return [];
    const out: DetectedAnomaly[] = [];
    if (await this.engine(c) === 'postgis') {
      const rows = (await c.query(
        `SELECT b.id AS o_id, b.code AS o_code, ${PG_METRICS('a', 'b')}
           FROM parcels a JOIN parcels b ON b.id <> a.id AND b.status = 'active' AND b.geom && a.geom ${PG_EQUAL('a', 'b')}
          WHERE a.id = $1 AND a.geom IS NOT NULL AND ST_Intersects(a.geom, b.geom)`, [parcelId])).rows;
      for (const o of rows) {
        const a = await this.record(c, orgId, me, { id: o.o_id, code: o.o_code }, classifyPair(toMetrics(o), settings), settings, userId, source);
        if (a) out.push(a);
      }
      return out;
    }
    const others = (await c.query(
      `SELECT o.id, o.code, o.geometry FROM parcels o
        WHERE o.id <> $1 AND o.status = 'active' AND o.geometry IS NOT NULL AND o.bbox && (SELECT bbox FROM parcels WHERE id = $1)`, [parcelId])).rows;
    for (const o of others) {
      const r = analysePair(me.geometry as Polygon, o.geometry as Polygon, settings);
      const a = await this.record(c, orgId, me, o, r, settings, userId, source);
      if (a) out.push(a);
    }
    return out;
  }

  /** Anomalies bloquantes encore ouvertes pour une parcelle (empêchent le contrôle et la vérification). */
  async blockingFor(c: PoolClient, parcelId: string) {
    return (await c.query(
      `SELECT a.id, a.kind, a.intersection_m2, a.pct_a, a.pct_b,
              CASE WHEN a.parcel_a = $1 THEN pb.code ELSE pa.code END AS other_code
         FROM parcel_anomalies a JOIN parcels pa ON pa.id = a.parcel_a LEFT JOIN parcels pb ON pb.id = a.parcel_b
        WHERE a.status = 'open' AND a.blocking AND (a.parcel_a = $1 OR a.parcel_b = $1)`, [parcelId])).rows;
  }

  /** Contrôle périodique de toutes les parcelles à polygone de la coopérative (couples filtrés par l'index spatial). */
  async runPeriodic(orgId: string, userId: string) {
    return this.db.tx(orgId, async (c) => {
      const s = await this.settings(c);
      const total = Number((await c.query(`SELECT count(*) FROM parcels WHERE status = 'active' AND geometry IS NOT NULL`)).rows[0].count);
      const engine = await this.engine(c);
      const found: Record<string, number> = {};
      let created = 0, candidates = 0;
      if (engine === 'postgis') {
        const pairs = (await c.query(
          `SELECT a.id AS a_id, a.code AS a_code, b.id AS b_id, b.code AS b_code, ${PG_METRICS('a', 'b')}
             FROM parcels a JOIN parcels b ON a.id < b.id AND a.geom && b.geom ${PG_EQUAL('a', 'b')}
            WHERE a.status = 'active' AND b.status = 'active' AND ST_Intersects(a.geom, b.geom) LIMIT 100000`)).rows;
        candidates = pairs.length;
        for (const p of pairs) {
          const r = classifyPair(toMetrics(p), s);
          if (!r.kind) continue;
          const d = await this.record(c, orgId, { id: p.a_id, code: p.a_code }, { id: p.b_id, code: p.b_code }, r, s, userId, 'periodic');
          found[r.kind] = (found[r.kind] ?? 0) + 1;
          if (d) created++;
        }
      } else {
        const pairs = (await c.query(
          `SELECT a.id AS a_id, a.code AS a_code, a.geometry AS a_geom, b.id AS b_id, b.code AS b_code, b.geometry AS b_geom
             FROM parcels a JOIN parcels b ON a.id < b.id AND a.bbox && b.bbox
            WHERE a.status = 'active' AND b.status = 'active' AND a.geometry IS NOT NULL AND b.geometry IS NOT NULL LIMIT 100000`)).rows;
        candidates = pairs.length;
        for (const p of pairs) {
          const r = analysePair(p.a_geom, p.b_geom, s);
          if (!r.kind) continue;
          const d = await this.record(c, orgId, { id: p.a_id, code: p.a_code }, { id: p.b_id, code: p.b_code }, r, s, userId, 'periodic');
          found[r.kind] = (found[r.kind] ?? 0) + 1;
          if (d) created++;
        }
      }
      const open = Number((await c.query(`SELECT count(*) FROM parcel_anomalies WHERE status = 'open'`)).rows[0].count);
      return { engine, parcels_examined: total, candidate_pairs: candidates, anomalies_found: found, new_anomalies: created, open_anomalies: open, policy: s.overlap_policy, truncated: candidates >= 100000 };
    });
  }
}
