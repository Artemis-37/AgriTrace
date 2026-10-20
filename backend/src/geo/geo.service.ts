import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { Polygon } from '../parcels/geo';
import { analysePair, AnomalyKind, DEFAULT_GEO_SETTINGS, GeoSettings, isBlocking, RECOMMENDED } from './geo-core';

export interface DetectedAnomaly { id: string; kind: AnomalyKind; other_id: string; other_code: string; intersection_m2: number; blocking: boolean }

@Injectable()
export class GeoService {
  constructor(readonly db: DbService, readonly audit: AuditService) {}

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
    const others = (await c.query(
      `SELECT o.id, o.code, o.geometry FROM parcels o
        WHERE o.id <> $1 AND o.status = 'active' AND o.geometry IS NOT NULL AND o.bbox && (SELECT bbox FROM parcels WHERE id = $1)`, [parcelId])).rows;
    const out: DetectedAnomaly[] = [];
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
      const pairs = (await c.query(
        `SELECT a.id AS a_id, a.code AS a_code, a.geometry AS a_geom, b.id AS b_id, b.code AS b_code, b.geometry AS b_geom
           FROM parcels a JOIN parcels b ON a.id < b.id AND a.bbox && b.bbox
          WHERE a.status = 'active' AND b.status = 'active' AND a.geometry IS NOT NULL AND b.geometry IS NOT NULL LIMIT 100000`)).rows;
      const found: Record<string, number> = {};
      let created = 0;
      for (const p of pairs) {
        const r = analysePair(p.a_geom, p.b_geom, s);
        if (!r.kind) continue;
        const d = await this.record(c, orgId, { id: p.a_id, code: p.a_code }, { id: p.b_id, code: p.b_code }, r, s, userId, 'periodic');
        found[r.kind] = (found[r.kind] ?? 0) + 1;
        if (d) created++;
      }
      const open = Number((await c.query(`SELECT count(*) FROM parcel_anomalies WHERE status = 'open'`)).rows[0].count);
      return { parcels_examined: total, candidate_pairs: pairs.length, anomalies_found: found, new_anomalies: created, open_anomalies: open, policy: s.overlap_policy, truncated: pairs.length >= 100000 };
    });
  }
}
