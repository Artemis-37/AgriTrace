export interface Polygon { type: 'Polygon'; coordinates: number[][][] }

/** Valide un GeoJSON Polygon WGS84 (anneau fermé, ≥ 4 points, ≤ 1000 sommets, coordonnées dans les bornes). Retourne un message d'erreur ou null. */
export function validatePolygon(g: any): string | null {
  if (!g || g.type !== 'Polygon' || !Array.isArray(g.coordinates) || g.coordinates.length < 1) return 'Géométrie : un GeoJSON de type Polygon est attendu';
  const ring = g.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return 'Géométrie : un anneau fermé de 4 points minimum est requis';
  if (ring.length > 1000) return 'Géométrie : 1000 sommets maximum';
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !isFinite(p[0]) || !isFinite(p[1])) return 'Géométrie : coordonnées invalides';
    if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) return 'Géométrie : coordonnées hors bornes (longitude, latitude attendues)';
  }
  const a = ring[0], z = ring[ring.length - 1];
  if (a[0] !== z[0] || a[1] !== z[1]) return "Géométrie : l'anneau doit être fermé (premier point = dernier point)";
  if (g.coordinates.length > 1) return 'Géométrie : les polygones à trous ne sont pas pris en charge (un seul anneau extérieur)';
  if (selfIntersects(ring)) return "Géométrie invalide : l'anneau se croise lui-même";
  if (polygonAreaHa(g) <= 0) return 'Géométrie : surface nulle';
  return null;
}

/** Surface en hectares (projection équirectangulaire locale + formule de l'arpenteur ; précision suffisante pour des parcelles agricoles). */
export function polygonAreaHa(g: Polygon): number {
  const ring = g.coordinates[0];
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const R = 6371008.8, k = Math.PI / 180;
  const pts = ring.map((p) => [R * p[0] * k * Math.cos(lat0 * k), R * p[1] * k]);
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.abs(s) / 2 / 10000;
}

export function centroid(g: Polygon): { lat: number; lon: number } {
  const ring = g.coordinates[0].slice(0, -1);
  return { lat: ring.reduce((s, p) => s + p[1], 0) / ring.length, lon: ring.reduce((s, p) => s + p[0], 0) / ring.length };
}

/** Vrai si le point (lon, lat) est dans l'anneau (lancer de rayon) ; un point sur le bord compte comme dedans. */
export function pointInRing(ring: number[][], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const cross = (lon - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (cross === 0 && lon >= Math.min(xi, xj) && lon <= Math.max(xi, xj) && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const distSeg = (px: number, py: number, a: number[], b: number[]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
};

/**
 * « Centroïde » de la parcelle, toujours DANS le polygone : le centre de gravité s'il y tombe ; sinon (parcelle en L, en U, en croissant) le point
 * intérieur le plus éloigné des bords, cherché sur une grille affinée.
 */
export function interiorPoint(g: Polygon): { lat: number; lon: number } {
  const ring = g.coordinates[0];
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length, kx = Math.cos((lat0 * Math.PI) / 180);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0] * kx, y0 = ring[i][1], x1 = ring[i + 1][0] * kx, y1 = ring[i + 1][1], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a !== 0) {
    const lon = cx / (3 * a) / kx, lat = cy / (3 * a);
    if (pointInRing(ring, lon, lat)) return { lat, lon };
  }
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const p of ring) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
  let best = { lat: ring[0][1], lon: ring[0][0], d: -1 };
  let x0 = w, x1 = e, y0 = s, y1 = n;
  for (let pass = 0; pass < 4; pass++) {
    const N = 24, sx = (x1 - x0) / N, sy = (y1 - y0) / N;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const lon = x0 + i * sx, lat = y0 + j * sy;
      if (!pointInRing(ring, lon, lat)) continue;
      let d = Infinity;
      for (let k = 0; k < ring.length - 1; k++) d = Math.min(d, distSeg(lon * kx, lat, [ring[k][0] * kx, ring[k][1]], [ring[k + 1][0] * kx, ring[k + 1][1]]));
      if (d > best.d) best = { lat, lon, d };
    }
    if (best.d < 0) break;
    x0 = best.lon - 2 * sx; x1 = best.lon + 2 * sx; y0 = best.lat - 2 * sy; y1 = best.lat + 2 * sy;
  }
  return { lat: best.lat, lon: best.lon };
}

/** Écart relatif entre surface déclarée et surface mesurée, en %. */
export const areaGapPct = (declared: number, measured: number) => (Math.abs(declared - measured) / declared) * 100;

/** Vrai si deux segments non adjacents de l'anneau se croisent (polygone « papillon »). O(n²), n ≤ 1000. */
export function selfIntersects(ring: number[][]): boolean {
  const n = ring.length - 1; // segments i : ring[i] -> ring[i+1]
  const ccw = (a: number[], b: number[], c: number[]) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  const cross = (a: number[], b: number[], c: number[], d: number[]) => {
    const d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // segments adjacents par la fermeture
      if (cross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  return false;
}
