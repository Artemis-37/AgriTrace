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
