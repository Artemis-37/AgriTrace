/** Reprojection vers WGS84 des systèmes les plus courants dans les fichiers de terrain : UTM sur WGS84 (EPSG:326zz nord, 327zz sud) et Web Mercator. */

const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const N = F / (2 - F);
const RECT = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const BETA = [N / 2 - (2 / 3) * N ** 2 + (37 / 96) * N ** 3, N ** 2 / 48 + N ** 3 / 15, (17 / 480) * N ** 3];
const DELTA = [2 * N - (2 / 3) * N ** 2 - 2 * N ** 3, (7 / 3) * N ** 2 - (8 / 5) * N ** 3, (56 / 15) * N ** 3];

/** Fuseau UTM d'un code EPSG (32601-32660 nord, 32701-32760 sud), sinon null. */
export function utmZone(epsg: number): { zone: number; south: boolean } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

/** UTM (est, nord en mètres) → [longitude, latitude] en degrés (séries de Krüger, précision sous le millimètre dans le fuseau). */
export function utmToWgs84(easting: number, northing: number, zone: number, south: boolean): [number, number] {
  const xi0 = (south ? northing - 10000000 : northing) / (K0 * RECT);
  const eta0 = (easting - 500000) / (K0 * RECT);
  let xi = xi0, eta = eta0;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xi -= b * Math.sin(j * xi0) * Math.cosh(j * eta0);
    eta -= b * Math.cos(j * xi0) * Math.sinh(j * eta0);
  });
  const chi = Math.asin(Math.sin(xi) / Math.cosh(eta));
  let phi = chi;
  DELTA.forEach((d, i) => { phi += d * Math.sin(2 * (i + 1) * chi); });
  const lon0 = (zone * 6 - 183) * Math.PI / 180;
  const lam = lon0 + Math.atan2(Math.sinh(eta), Math.cos(xi));
  return [(lam * 180) / Math.PI, (phi * 180) / Math.PI];
}

/** Web Mercator (EPSG:3857) → [longitude, latitude]. */
export function mercatorPoint(x: number, y: number): [number, number] {
  return [(x / A) * 180 / Math.PI, (2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) * 180 / Math.PI];
}

const mapCoords = (g: any, f: (x: number, y: number) => [number, number]): any => {
  if (!g || !g.coordinates) return g;
  const conv = (c: any): any => (typeof c[0] === 'number' ? [...f(c[0], c[1]), ...c.slice(2)] : c.map(conv));
  return { ...g, coordinates: conv(g.coordinates) };
};

export interface Reprojector { label: string; apply: (geometry: any) => any }

/** Reprojecteur pour un code EPSG : Web Mercator si [allowWebMercator], UTM WGS84 toujours ; null pour tout autre système. */
export function reprojectorFor(epsg: number, opts: { allowWebMercator?: boolean } = {}): Reprojector | null {
  if (epsg === 3857 && opts.allowWebMercator) return { label: 'Web Mercator (EPSG:3857)', apply: (g) => mapCoords(g, mercatorPoint) };
  const u = utmZone(epsg);
  if (u) return { label: `UTM ${u.zone}${u.south ? 'S' : 'N'} (EPSG:${epsg})`, apply: (g) => mapCoords(g, (x, y) => utmToWgs84(x, y, u.zone, u.south)) };
  return null;
}

/** Code EPSG lu dans un nom de système ('EPSG:32630', 'urn:ogc:def:crs:EPSG::32630', 'WGS_1984_UTM_Zone_30N'…), sinon null. */
export function epsgFromName(name: string): number | null {
  const s = String(name);
  if (/(CRS84|OGC:1\.3:CRS84)/i.test(s)) return 4326;
  if (/(900913|Pseudo-Mercator)/i.test(s)) return 3857;
  const m = s.match(/EPSG[^0-9]{0,12}(\d{4,5})/i);
  if (m) return Number(m[1]);
  const z = s.match(/UTM[_ ]Zone[_ ](\d{1,2})([NS])/i);
  return z && /WGS[_ ]?(19)?84/i.test(s) ? Number(z[1]) + (z[2].toUpperCase() === 'N' ? 32600 : 32700) : null;
}
