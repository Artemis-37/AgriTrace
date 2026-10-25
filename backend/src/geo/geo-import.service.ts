import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { centroid, polygonAreaHa, validatePolygon } from '../parcels/geo';
import { Polygon } from '../parcels/geo';
import { analysePair, AnomalyKind, bboxesOverlap, bboxOf, geometryHash, GeoSettings, isBlocking } from './geo-core';
import { RawFeature } from './formats';
import { GeoService } from './geo.service';

export interface ImportOptions {
  producer_field?: string; parcel_code_field?: string; ignore_parcel_code?: boolean; value_chain_field?: string; value_chain_id?: string;
  declared_area_field?: string; external_id_field?: string; survey_date_field?: string; accuracy_field?: string;
  default_declared_from_measured?: boolean; all_or_nothing?: boolean; assume_wgs84?: boolean; layer?: string;
}
export type Mode = 'create_only' | 'create_update' | 'simulate' | 'quarantine';
interface Spatial { kind: AnomalyKind; other: string; intersection_m2: number; pct_self: number; pct_other: number; iou: number; blocking: boolean }
export interface Item {
  row_no: number; producer_code: string | null; parcel_code: string | null; outcome: 'create' | 'update' | 'unchanged' | 'rejected' | 'quarantined';
  reasons: string[]; properties: Record<string, any>; geometry: any | null; parcel_id?: string;
  producerId?: string; vcId?: string; declared?: string; hash?: string; poly?: Polygon; existing?: any; ext?: string | null; surveyed?: string | null; accuracy?: number | null;
  spatial: Spatial[]; hard: boolean;
}

const CANDIDATES: Record<string, string[]> = {
  producer_field: ['producer_code', 'code_producteur', 'codeproducteur', 'producteur', 'prod_code', 'producer_c', 'producer', 'code_prod'],
  parcel_code_field: ['parcel_code', 'code_parcelle', 'parcel_cod', 'parcelle', 'codeparcelle'],
  value_chain_field: ['filiere', 'filière', 'value_chain', 'chain', 'culture'],
  declared_area_field: ['declared_area_ha', 'declared_a', 'decl_ha', 'superficie_declaree', 'surface_declaree', 'declared_ha', 'superficie_ha'],
  external_id_field: ['external_id', 'parcel_id', 'id_externe', 'extern_id', 'externalid'],
  survey_date_field: ['survey_date', 'survey_dt', 'date_releve', 'surveyed_on'],
  accuracy_field: ['gps_accuracy_m', 'precision_gps', 'accuracy'],
};

/** Complète les champs de correspondance non précisés par détection sur les noms de colonnes (jamais sur le nom affiché « name »). */
export function detectFields(features: RawFeature[], opt: ImportOptions): { opt: ImportOptions; columns: string[] } {
  const cols = new Set<string>();
  for (const f of features.slice(0, 200)) for (const k of Object.keys(f.props)) cols.add(k);
  const columns = [...cols];
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  const out: any = { ...opt };
  for (const [field, names] of Object.entries(CANDIDATES)) {
    if (out[field]) continue;
    for (const n of names) if (lower.has(n)) { out[field] = lower.get(n); break; }
  }
  return { opt: out, columns };
}

const txt = (v: any) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

@Injectable()
export class GeoImportService {
  constructor(private readonly geo: GeoService) {}

  /**
   * Analyse un lot d'objets géographiques SANS rien écrire : producteur reconnu, géométrie valide, doublons, chevauchements,
   * parcelles déjà connues (réimportation). Le résultat sert à la simulation comme à l'exécution.
   */
  async analyse(c: PoolClient, features: RawFeature[], opt: ImportOptions, mode: Mode, s: GeoSettings, progress?: (n: number) => Promise<void>): Promise<Item[]> {
    const producers = new Map<string, { id: string; status: string }>();
    for (const p of (await c.query(`SELECT id, internal_code, status FROM producers`)).rows) producers.set(String(p.internal_code).trim().toUpperCase(), { id: p.id, status: p.status });
    const chains = (await c.query(`SELECT id, code, name FROM value_chains`)).rows;
    // filière unique du producteur : utilisée quand le fichier n'en indique pas
    const soleChain = new Map<string, string>();
    const pvc = new Map<string, string[]>();
    for (const r of (await c.query(`SELECT producer_id, value_chain_id FROM producer_value_chains`)).rows) pvc.set(r.producer_id, [...(pvc.get(r.producer_id) ?? []), r.value_chain_id]);
    for (const [k, v] of pvc) if (v.length === 1) soleChain.set(k, v[0]);
    const chainBy = (v: string) => chains.find((x: any) => x.code.toLowerCase() === v.toLowerCase() || x.name.toLowerCase() === v.toLowerCase());
    const defaultChain = opt.value_chain_id ? chains.find((x: any) => x.id === opt.value_chain_id) : chains.length === 1 ? chains[0] : undefined;

    const items: Item[] = features.map((f, i) => ({
      row_no: i + 1, producer_code: opt.producer_field ? txt(f.props[opt.producer_field]) || null : null,
      parcel_code: !opt.ignore_parcel_code && opt.parcel_code_field ? txt(f.props[opt.parcel_code_field]) || null : null,
      outcome: 'create', reasons: [], properties: f.props, geometry: f.geometry, spatial: [], hard: false,
    }));

    // 1. contrôles unitaires
    for (let i = 0; i < items.length; i++) {
      const it = items[i], f = features[i];
      const reject = (r: string) => { it.reasons.push(r); it.hard = true; };
      // géométrie
      let g = f.geometry;
      if (!g) reject('géométrie_absente : objet sans géométrie');
      else {
        if (g.type === 'MultiPolygon' && g.coordinates.length === 1) g = { type: 'Polygon', coordinates: g.coordinates[0] };
        if (g.type !== 'Polygon') reject(`objet_incompatible : ${g.type === 'MultiPolygon' ? 'polygone à plusieurs parties' : g.type} (un polygone simple est attendu)`);
        else {
          const err = validatePolygon(g);
          if (err) reject(`géométrie_invalide : ${err}`);
          else { it.poly = g; it.hash = geometryHash(g); it.geometry = g; }
        }
      }
      // producteur
      if (!opt.producer_field) reject('producteur_non_renseigné : aucune colonne de code producteur choisie');
      else if (!it.producer_code) reject('producteur_non_renseigné : code producteur vide');
      else {
        const p = producers.get(it.producer_code.trim().toUpperCase());
        if (!p) reject(`producteur_inconnu : « ${it.producer_code} » n'existe pas dans cette coopérative${typeof f.props[opt.producer_field] === 'number' ? ' (code numérique : zéros initiaux peut-être perdus, utiliser un champ texte)' : ''}`);
        else if (p.status !== 'active') reject(`producteur_inactif : « ${it.producer_code} » (${p.status})`);
        else it.producerId = p.id;
      }
      // filière
      const vcRaw = opt.value_chain_field ? txt(f.props[opt.value_chain_field]) : '';
      if (vcRaw) { const v = chainBy(vcRaw); if (!v) reject(`filière_inconnue : « ${vcRaw} »`); else it.vcId = v.id; }
      else if (it.producerId && soleChain.has(it.producerId)) it.vcId = soleChain.get(it.producerId);
      else if (defaultChain) it.vcId = defaultChain.id;
      else reject('filière_non_renseignée : colonne filière vide et aucune filière par défaut');
      // surface déclarée (distincte de la surface mesurée, qui est calculée)
      const declRaw = opt.declared_area_field ? f.props[opt.declared_area_field] : undefined;
      const decl = num(declRaw);
      if (decl !== null && decl > 0) it.declared = String(decl);
      else if (decl !== null) reject('surface_déclarée_invalide : doit être supérieure à zéro');
      else if (opt.default_declared_from_measured && it.poly) { it.declared = polygonAreaHa(it.poly).toFixed(4); it.reasons.push('info : surface déclarée absente, surface mesurée utilisée sur demande expresse'); }
      else if (declRaw === undefined || declRaw === null || declRaw === '') it.reasons.push('surface_déclarée_manquante');
      it.ext = opt.external_id_field ? txt(f.props[opt.external_id_field]) || null : null;
      const sd = opt.survey_date_field ? txt(f.props[opt.survey_date_field]) : '';
      it.surveyed = /^\d{4}-\d{2}-\d{2}/.test(sd) ? sd.slice(0, 10) : null;
      const acc = opt.accuracy_field ? num(f.props[opt.accuracy_field]) : null;
      it.accuracy = acc !== null && acc >= 0 ? acc : null;
    }

    // 2. parcelles déjà connues (code, identifiant externe, ou même producteur + même tracé)
    const codes = items.map((i) => i.parcel_code).filter(Boolean) as string[];
    const exts = items.map((i) => i.ext).filter(Boolean) as string[];
    const hashes = items.map((i) => i.hash).filter(Boolean) as string[];
    const known = (await c.query(
      `SELECT id, code, external_id, producer_id, geometry_hash, declared_area_ha, geometry, status, value_chain_id, merged_into FROM parcels
        WHERE code = ANY($1) OR external_id = ANY($2) OR (geometry_hash = ANY($3) AND status = 'active')`, [codes, exts, hashes])).rows;
    const byCode = new Map(known.map((p: any) => [p.code, p]));
    const byExt = new Map(known.filter((p: any) => p.external_id).map((p: any) => [p.external_id, p]));
    for (const it of items) {
      if (it.hard) continue;
      let ex: any;
      if (it.parcel_code) {
        ex = byCode.get(it.parcel_code);
        if (!ex) { it.reasons.push(`code_parcelle_inconnu : « ${it.parcel_code} » (les codes sont attribués par le serveur ; laisser vide pour créer)`); it.hard = true; continue; }
        if (ex.producer_id !== it.producerId) { it.reasons.push(`code_parcelle_autre_producteur : « ${it.parcel_code} » appartient à un autre producteur`); it.hard = true; continue; }
      } else if (it.ext && byExt.has(it.ext)) {
        ex = byExt.get(it.ext);
        if (ex.producer_id !== it.producerId) { it.reasons.push(`identifiant_externe_autre_producteur : « ${it.ext} »`); it.hard = true; continue; }
      } else {
        ex = known.find((p: any) => p.producer_id === it.producerId && p.geometry_hash === it.hash && p.status === 'active');
      }
      if (ex) {
        if (ex.status !== 'active') { it.reasons.push(`parcelle_archivée : « ${ex.code} » (${ex.merged_into ? 'remplacée par fusion' : 'archivée'})`); it.hard = true; continue; }
        it.existing = ex; it.parcel_code = ex.code;
        const sameGeom = ex.geometry_hash === it.hash;
        const sameArea = !it.declared || Number(it.declared) === Number(ex.declared_area_ha);
        if (sameGeom && sameArea) it.outcome = 'unchanged';
        else if (mode === 'create_only') { it.reasons.push(`existe_déjà : « ${ex.code} » (mode création uniquement)`); it.hard = true; }
        else it.outcome = 'update';
      } else if (!it.declared) { it.reasons = it.reasons.filter((r) => r !== 'surface_déclarée_manquante'); it.reasons.push('surface_déclarée_manquante : obligatoire pour créer une parcelle'); it.hard = true; }
    }

    // 3. doublons et codes répétés dans le fichier
    const seenHash = new Map<string, number>(), seenCode = new Map<string, number>();
    for (const it of items) {
      if (it.hard) continue;
      if (it.parcel_code) { if (seenCode.has(it.parcel_code)) { it.reasons.push(`doublon_dans_le_fichier : code ${it.parcel_code} déjà vu ligne ${seenCode.get(it.parcel_code)}`); it.hard = true; continue; } seenCode.set(it.parcel_code, it.row_no); }
      const k = `${it.producerId}|${it.hash}`;
      if (seenHash.has(k)) { it.reasons.push(`doublon_dans_le_fichier : même tracé et même producteur que la ligne ${seenHash.get(k)}`); it.hard = true; continue; }
      seenHash.set(k, it.row_no);
    }
    for (const it of items) if (it.hard) it.outcome = 'rejected';

    // 4. contrôles spatiaux (uniquement pour ce qui serait créé ou modifié)
    const changing = items.filter((i) => !i.hard && (i.outcome === 'create' || i.outcome === 'update'));
    let done = 0;
    for (const it of changing) {
      const bb = bboxOf(it.poly!);
      const cands = (await c.query(
        `SELECT id, code, geometry FROM parcels WHERE status = 'active' AND geometry IS NOT NULL AND ($5::uuid IS NULL OR id <> $5)
            AND bbox && box(point($3, $4), point($1, $2))`, [bb[0], bb[1], bb[2], bb[3], it.existing?.id ?? null])).rows;
      for (const o of cands) {
        const r = analysePair(it.poly!, o.geometry, s);
        if (r.kind) it.spatial.push({ kind: r.kind, other: `parcelle ${o.code}`, intersection_m2: r.intersection_m2, pct_self: r.pct_a, pct_other: r.pct_b, iou: r.iou, blocking: isBlocking(r.kind, s) });
      }
      if (++done % 50 === 0 && progress) await progress(done);
    }
    for (let i = 0; i < changing.length; i++)
      for (let j = i + 1; j < changing.length; j++) {
        const a = changing[i], b = changing[j];
        if (!bboxesOverlap(bboxOf(a.poly!), bboxOf(b.poly!))) continue;
        const r = analysePair(a.poly!, b.poly!, s);
        if (!r.kind) continue;
        a.spatial.push({ kind: r.kind, other: `ligne ${b.row_no} du fichier`, intersection_m2: r.intersection_m2, pct_self: r.pct_a, pct_other: r.pct_b, iou: r.iou, blocking: isBlocking(r.kind, s) });
        b.spatial.push({ kind: r.kind, other: `ligne ${a.row_no} du fichier`, intersection_m2: r.intersection_m2, pct_self: r.pct_b, pct_other: r.pct_a, iou: r.iou, blocking: isBlocking(r.kind, s) });
      }
    for (const it of changing) {
      const blockers = it.spatial.filter((x) => x.blocking);
      if (blockers.length) {
        it.reasons.push(...blockers.map((b) => `${b.kind} avec ${b.other} (${b.intersection_m2} m², ${b.pct_self} % de cette parcelle)`));
        it.outcome = mode === 'quarantine' ? 'quarantined' : 'rejected';
      }
      for (const w of it.spatial.filter((x) => !x.blocking)) it.reasons.push(`avertissement : ${w.kind} avec ${w.other} (${w.intersection_m2} m²)`);
    }
    return items;
  }

  report(items: Item[]) {
    const c = (o: Item['outcome']) => items.filter((i) => i.outcome === o).length;
    const pairs = new Map<string, Spatial>();
    for (const it of items) for (const sp of it.spatial) pairs.set([it.row_no, sp.other, sp.kind].sort().join('|'), sp);
    const kinds = [...pairs.values()].map((p) => p.kind);
    const n = (...k: AnomalyKind[]) => kinds.filter((x) => k.includes(x)).length;
    const startsWith = (p: string) => items.filter((i) => i.reasons.some((r) => r.startsWith(p))).length;
    return {
      examined: items.length,
      valid: items.filter((i) => !i.hard).length,
      creatable: c('create'), updatable: c('update'), unchanged: c('unchanged'), rejected: c('rejected'), pending_correction: c('quarantined'),
      duplicates_potential: n('duplicate_near'), duplicates_confirmed: n('duplicate_identical', 'duplicate_equivalent') + startsWith('doublon_dans_le_fichier'),
      overlaps: n('overlap_partial', 'overlap_inclusion'),
      invalid_geometries: startsWith('géométrie_invalide') + startsWith('géométrie_absente') + startsWith('objet_incompatible'),
      unknown_producers: startsWith('producteur_inconnu'),
      anomalies: items.filter((i) => i.reasons.length).slice(0, 500).map((i) => ({ row: i.row_no, producer_code: i.producer_code, parcel_code: i.parcel_code, outcome: i.outcome, reasons: i.reasons })),
    };
  }

  /** Écrit les parcelles créées ou modifiées (dans la transaction de l'appelant) puis enregistre le détail de chaque ligne. */
  async apply(c: PoolClient, orgId: string, userId: string, importId: string, items: Item[], s: GeoSettings, write = true) {
    const touched: string[] = [];
    for (const it of items) {
      if (!write) continue;
      if (it.outcome === 'create') {
        const seq = (await c.query(`UPDATE producers SET parcel_seq = parcel_seq + 1 WHERE id = $1 RETURNING parcel_seq, internal_code`, [it.producerId])).rows[0];
        const code = `${seq.internal_code}-P${seq.parcel_seq}`;
        const cen = centroid(it.poly!);
        const row = (await c.query(
          `INSERT INTO parcels(organization_id, code, idempotency_key, producer_id, value_chain_id, declared_area_ha, latitude, longitude, geometry, geometry_area_ha,
                               geometry_hash, external_id, surveyed_on, gps_accuracy_m, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, code`,
          [orgId, code, `import:${importId}:${it.row_no}`, it.producerId, it.vcId, it.declared, Number(cen.lat.toFixed(6)), Number(cen.lon.toFixed(6)), JSON.stringify(it.poly),
           Number(polygonAreaHa(it.poly!).toFixed(4)), it.hash, it.ext ?? null, it.surveyed ?? null, it.accuracy ?? null, userId])).rows[0];
        await c.query(`INSERT INTO parcel_history(organization_id, parcel_id, event, to_status, details, actor_id) VALUES ($1,$2,'created','declared',$3,$4)`,
          [orgId, row.id, JSON.stringify({ import_id: importId, row: it.row_no }), userId]);
        it.parcel_id = row.id; it.parcel_code = row.code; touched.push(row.id);
      } else if (it.outcome === 'update') {
        const ex = it.existing;
        const cen = centroid(it.poly!);
        await c.query(
          `UPDATE parcels SET declared_area_ha = coalesce($2, declared_area_ha), latitude = $3, longitude = $4, geometry = $5, geometry_area_ha = $6, geometry_hash = $7,
                  external_id = coalesce($8, external_id), surveyed_on = coalesce($9, surveyed_on), gps_accuracy_m = coalesce($10, gps_accuracy_m),
                  verification_status = 'declared', controlled_at = NULL, controlled_by = NULL, verified_at = NULL, verified_by = NULL, verified_inspection_id = NULL, updated_at = now()
            WHERE id = $1`,
          [ex.id, it.declared ?? null, Number(cen.lat.toFixed(6)), Number(cen.lon.toFixed(6)), JSON.stringify(it.poly), Number(polygonAreaHa(it.poly!).toFixed(4)), it.hash,
           it.ext ?? null, it.surveyed ?? null, it.accuracy ?? null]);
        await c.query(`INSERT INTO parcel_history(organization_id, parcel_id, event, from_status, to_status, details, actor_id) VALUES ($1,$2,'updated',$3,'declared',$4,$5)`,
          [orgId, ex.id, ex.verification_status ?? null, JSON.stringify({
            import_id: importId, row: it.row_no, reason: 'mise à jour par import',
            old_geometry: ex.geometry, new_geometry: it.poly, old_declared_area_ha: ex.declared_area_ha, new_declared_area_ha: it.declared ?? ex.declared_area_ha,
          }), userId]);
        it.parcel_id = ex.id; touched.push(ex.id);
      } else if (it.outcome === 'unchanged') it.parcel_id = it.existing?.id;
    }
    // anomalies non bloquantes (politique « avertir ») enregistrées pour les parcelles écrites
    for (const id of touched) await this.geo.detectForParcel(c, orgId, id, userId, 'import', s);
    // détail de chaque ligne (y compris rejets et mises en quarantaine) : base du rapport
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      const vals: any[] = []; const ph = chunk.map((it, k) => {
        vals.push(orgId, importId, it.row_no, it.producer_code, it.parcel_code, it.outcome, JSON.stringify(it.reasons), JSON.stringify(it.properties), it.geometry ? JSON.stringify(it.geometry) : null, it.parcel_id ?? null);
        const b = k * 10; return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,$${b + 8}::jsonb,$${b + 9}::jsonb,$${b + 10})`;
      });
      await c.query(`INSERT INTO geo_import_items(organization_id, import_id, row_no, producer_code, parcel_code, outcome, reasons, properties, geometry, parcel_id) VALUES ${ph.join(',')}`, vals);
    }
  }
}
