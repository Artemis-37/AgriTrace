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
