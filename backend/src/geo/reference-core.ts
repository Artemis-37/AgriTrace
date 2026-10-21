import area from '@turf/area';

/** Contours de zones de référence (zones protégées) : lecture des attributs, nettoyage et simplification. Pur, testable hors base. */
export type AreaGeometry = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface ReferenceFeatureInput {
  name: string; designation: string | null; category: string | null; status: string | null; year: number | null;
  properties: Record<string, string | number | boolean>;
  geometry: AreaGeometry; bbox: [number, number, number, number]; area_ha: number; vertices: number;
}
export interface PrepareResult { features: ReferenceFeatureInput[]; skipped: { reason: string; count: number }[]; vertices_before: number; vertices_after: number }

/** Tolérance de simplification : ~2 m. Les limites de zones protégées sont bien moins précises (souvent 50 à 500 m). */
export const SIMPLIFY_DEG = 0.00002;
export const MAX_REF_VERTICES = 400_000;

// Les fichiers WDPA existent en minuscules (HDX) ou en majuscules (WDPA officiel) : on cherche sans tenir compte de la casse.
const pick = (props: Record<string, any>, ...keys: string[]) => {
  const low = new Map(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) { const v = low.get(k.toLowerCase()); if (v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== 'Not Reported' && String(v) !== 'Not Applicable') return v; }
  return null;
};
const KEEP = ['site_pid', 'wdpaid', 'wdpa_pid', 'site_type', 'desig', 'desig_type', 'iucn_cat', 'realm', 'marine', 'status', 'status_yr', 'gov_type', 'own_type', 'mang_auth', 'verif', 'iso3', 'rep_area', 'gis_area'];

/** Douglas-Peucker sur un anneau fermé ; garde au moins 4 points et la fermeture. */
export function simplifyRing(ring: number[][], tol: number): number[][] {
  if (ring.length <= 4) return ring;
  const open = ring.slice(0, -1);
  const keep = new Array(open.length).fill(false);
  keep[0] = keep[open.length - 1] = true;
  const d2 = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const stack: [number, number][] = [[0, open.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let max = 0, idx = -1;
    for (let k = i + 1; k < j; k++) { const d = d2(open[k], open[i], open[j]); if (d > max) { max = d; idx = k; } }
    if (idx >= 0 && max > tol * tol) { keep[idx] = true; stack.push([i, idx], [idx, j]); }
  }
  const out = open.filter((_, k) => keep[k]);
  if (out.length < 3) return ring; // dégénéré : on garde l'anneau d'origine
  return [...out, out[0]];
}

const validRing = (r: any) => Array.isArray(r) && r.length >= 4 && r.every((p: any) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
const strip = (r: number[][]) => r.map((p) => [p[0], p[1]]);
const closed = (r: number[][]) => r.length > 0 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

function cleanPolygon(rings: any, tol: number): number[][][] | null {
  if (!Array.isArray(rings) || !rings.length || !rings.every(validRing)) return null;
  const out: number[][][] = [];
  for (let i = 0; i < rings.length; i++) {
    let r = strip(rings[i]);
    if (!closed(r)) r = [...r, r[0]];
    const s = simplifyRing(r, tol);
    if (i > 0 && s.length < 4) continue; // un trou devenu dégénéré est abandonné
    out.push(s);
  }
  return out;
}

export function prepareFeatures(raw: { props: Record<string, any>; geometry: any }[], tol = SIMPLIFY_DEG): PrepareResult {
  const skip = new Map<string, number>();
  const bad = (why: string) => skip.set(why, (skip.get(why) ?? 0) + 1);
  const features: ReferenceFeatureInput[] = [];
  let before = 0, after = 0;
  const count = (g: AreaGeometry) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()).reduce((s, r) => s + r.length, 0);
  for (const f of raw) {
    const g = f.geometry;
    if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) { bad(g ? `géométrie ${g.type} ignorée (polygone attendu)` : 'sans géométrie'); continue; }
    if (String(pick(f.props, 'marine') ?? '') === '2') { bad('zone entièrement marine'); continue; }
    let geometry: AreaGeometry | null = null;
    if (g.type === 'Polygon') { const p = cleanPolygon(g.coordinates, tol); if (p) geometry = { type: 'Polygon', coordinates: p }; }
    else { const ps = (g.coordinates as any[]).map((p) => cleanPolygon(p, tol)).filter(Boolean) as number[][][][]; if (ps.length) geometry = { type: 'MultiPolygon', coordinates: ps }; }
    if (!geometry) { bad('coordonnées invalides'); continue; }
    before += count(g as AreaGeometry); after += count(geometry);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const ring of geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()) for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    const props: Record<string, string | number | boolean> = {};
    for (const k of KEEP) { const v = pick(f.props, k); if (v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) props[k] = typeof v === 'string' ? v.slice(0, 200) : v; }
    const yr = Number(pick(f.props, 'status_yr', 'year'));
    features.push({
      name: String(pick(f.props, 'name', 'orig_name', 'name_eng', 'nom', 'libelle', 'site_name') ?? 'Zone sans nom').slice(0, 200),
      designation: pick(f.props, 'desig_eng', 'desig', 'designation', 'type') ? String(pick(f.props, 'desig_eng', 'desig', 'designation', 'type')).slice(0, 120) : null,
      category: pick(f.props, 'iucn_cat', 'categorie') ? String(pick(f.props, 'iucn_cat', 'categorie')).slice(0, 20) : null,
      status: pick(f.props, 'status', 'statut') ? String(pick(f.props, 'status', 'statut')).slice(0, 60) : null,
      year: Number.isInteger(yr) && yr > 1800 && yr < 2200 ? yr : null,
      properties: props, geometry, bbox: [minx, miny, maxx, maxy],
      area_ha: Math.round(area({ type: 'Feature', properties: {}, geometry } as any) / 100) / 100, vertices: count(geometry),
    });
  }
  return { features, skipped: [...skip].map(([reason, count]) => ({ reason, count })), vertices_before: before, vertices_after: after };
}
