import { createHash } from 'crypto';
import area from '@turf/area';
import intersect from '@turf/intersect';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { Polygon } from '../parcels/geo';

export interface GeoSettings {
  overlap_min_m2: number;      // surface minimale d'intersection pour parler de chevauchement
  overlap_min_pct: number;     // % minimal de la plus petite parcelle
  near_duplicate_iou: number;  // seuil d'IoU (intersection / union) pour « presque identique »
  overlap_policy: 'block' | 'warn';
}
export const DEFAULT_GEO_SETTINGS: GeoSettings = { overlap_min_m2: 25, overlap_min_pct: 1, near_duplicate_iou: 0.95, overlap_policy: 'block' };

export type AnomalyKind = 'duplicate_identical' | 'duplicate_equivalent' | 'duplicate_near' | 'overlap_partial' | 'overlap_inclusion' | 'protected_overlap';

const r7 = (n: number) => Math.round(n * 1e7) / 1e7; // ~1 cm : sert à comparer des géométries équivalentes

/** Forme canonique d'un anneau : sans point de fermeture, sens horaire, départ au plus petit sommet. */
export function normalizeRing(ring: number[][]): number[][] {
  let pts = ring.slice(0, -1).map((p) => [r7(p[0]), r7(p[1])]);
  // retire les sommets consécutifs identiques
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  if (s > 0) pts.reverse(); // sens horaire
  let m = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[m][0] || (pts[i][0] === pts[m][0] && pts[i][1] < pts[m][1])) m = i;
  return [...pts.slice(m), ...pts.slice(0, m)];
}

/** Empreinte de la géométrie normalisée (deux tracés équivalents donnent la même empreinte). */
export function geometryHash(g: Polygon): string {
  return createHash('sha256').update(JSON.stringify(normalizeRing(g.coordinates[0]))).digest('hex').slice(0, 32);
}

export const sameRawGeometry = (a: Polygon, b: Polygon) => JSON.stringify(a.coordinates[0]) === JSON.stringify(b.coordinates[0]);

export interface PairAnalysis {
  kind: AnomalyKind | null; intersection_m2: number; pct_a: number; pct_b: number; iou: number;
}

export const areaM2 = (g: Polygon): number => area(turfPolygon(g.coordinates));

export function bboxOf(g: Polygon): [number, number, number, number] {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of g.coordinates[0]) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  return [minx, miny, maxx, maxy];
}
export const bboxesOverlap = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Mesures d'un couple de parcelles, quel que soit le moteur qui les a calculées (Node ou PostGIS). */
export interface PairMetrics {
  /** Mêmes sommets dans le même ordre. */
  sameRaw: boolean;
  /** Même tracé après normalisation (sens, point de départ, arrondi au centimètre). */
  equivalent: boolean;
  areaA_m2: number; areaB_m2: number; intersection_m2: number;
}

/**
 * Règles de classement (CDC §10.4), identiques pour les deux moteurs : seules les mesures changent de provenance.
 * Une limite commune (intersection nulle ou sous les seuils) n'est jamais un chevauchement problématique.
 */
export function classifyPair(m: PairMetrics, s: GeoSettings): PairAnalysis {
  const none: PairAnalysis = { kind: null, intersection_m2: 0, pct_a: 0, pct_b: 0, iou: 0 };
  const aa = m.areaA_m2, ab = m.areaB_m2;
  if (m.equivalent) {
    return { kind: m.sameRaw ? 'duplicate_identical' : 'duplicate_equivalent', intersection_m2: Math.min(aa, ab), pct_a: 100, pct_b: 100, iou: 1 };
  }
  const inter = m.intersection_m2;
  if (!(inter > 0) || !(aa > 0) || !(ab > 0)) return none;
  const pctA = (inter / aa) * 100, pctB = (inter / ab) * 100;
  const iou = inter / (aa + ab - inter);
  const base = { intersection_m2: Number(inter.toFixed(2)), pct_a: Number(pctA.toFixed(3)), pct_b: Number(pctB.toFixed(3)), iou: Number(iou.toFixed(5)) };
  if (iou >= s.near_duplicate_iou) return { kind: 'duplicate_near', ...base };
  const smallerPct = Math.max(pctA, pctB); // part de la plus petite parcelle couverte par l'intersection
  if (inter < s.overlap_min_m2 || smallerPct < s.overlap_min_pct) return { ...none, ...base, kind: null };
  return { kind: smallerPct >= 99 ? 'overlap_inclusion' : 'overlap_partial', ...base };
}

/**
 * Compare deux polygones avec le moteur Node (repli quand PostGIS n'est pas disponible).
 * Surfaces calculées sur la sphère par @turf/area ; l'intersection par clipping de polygones (polygon-clipping).
 */
export function analysePair(a: Polygon, b: Polygon, s: GeoSettings): PairAnalysis {
  const none: PairAnalysis = { kind: null, intersection_m2: 0, pct_a: 0, pct_b: 0, iou: 0 };
  if (!bboxesOverlap(bboxOf(a), bboxOf(b))) return none;
  const equivalent = geometryHash(a) === geometryHash(b);
  const aa = areaM2(a), ab = areaM2(b);
  let inter = 0;
  if (!equivalent) {
    try {
      const x = intersect(featureCollection([turfPolygon(a.coordinates), turfPolygon(b.coordinates)]));
      inter = x ? area(x) : 0;
    } catch { inter = 0; }
  }
  return classifyPair({ sameRaw: sameRawGeometry(a, b), equivalent, areaA_m2: aa, areaB_m2: ab, intersection_m2: inter }, s);
}

export const isBlocking = (kind: AnomalyKind, s: GeoSettings) => kind.startsWith('duplicate') || s.overlap_policy === 'block';

export const RECOMMENDED: Record<AnomalyKind, string> = {
  duplicate_identical: 'Vérifier s\'il s\'agit de la même parcelle, puis remplacer le doublon (fusion contrôlée)',
  duplicate_equivalent: 'Même tracé après normalisation : remplacer le doublon (fusion contrôlée)',
  duplicate_near: 'Tracés presque identiques : comparer sur la carte, puis remplacer le doublon ou corriger un tracé',
  overlap_partial: 'Corriger le polygone d\'une des deux parcelles (nouveau relevé GPS) ou enregistrer une exception motivée',
  protected_overlap: 'Parcelle en partie dans une zone protégée : vérifier le tracé et la limite de la zone (souvent peu précise), documenter la situation (EUDR, certification), corriger le tracé ou enregistrer une exception motivée',
  overlap_inclusion: 'Une parcelle est incluse dans l\'autre : vérifier le terrain, corriger ou enregistrer une exception motivée',
};
