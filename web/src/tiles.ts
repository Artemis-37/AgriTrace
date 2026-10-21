/** Fonds de carte du portail : calcul des tuiles Web Mercator (z/x/y) visibles dans la fenêtre de la carte. */
export type BaseLayer = 'none' | 'plan' | 'satellite';

export const TILE_URL: Record<Exclude<BaseLayer, 'none'>, string> = {
  plan: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};
export const ATTRIBUTION: Record<Exclude<BaseLayer, 'none'>, string> = {
  plan: '© contributeurs OpenStreetMap',
  satellite: 'Imagerie : Esri, Maxar, Earthstar Geographics',
};
export const MAX_ZOOM = 18, MIN_ZOOM = 3, MAX_TILES = 36;

export const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const latToY = (lat: number, z: number) => {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const xToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const yToLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export interface Bounds { west: number; south: number; east: number; north: number }
export interface Tile { z: number; x: number; y: number; west: number; east: number; north: number; south: number }

/** Niveau de zoom dont les tuiles de 256 px ont à peu près la définition de l'écran, borné à [3, 18]. */
export function zoomFor(b: Bounds, widthPx: number): number {
  const span = Math.max(b.east - b.west, 1e-9);
  const z = Math.round(Math.log2((360 * Math.max(widthPx, 256)) / (span * 256)));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Tuiles couvrant la fenêtre. Si elles sont trop nombreuses, on baisse le zoom (jamais de chargement massif). */
export function visibleTiles(b: Bounds, widthPx: number): Tile[] {
  let z = zoomFor(b, widthPx);
  for (;;) {
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor(lonToX(b.west, z))), x1 = Math.min(n - 1, Math.floor(lonToX(b.east, z)));
    const y0 = Math.max(0, Math.floor(latToY(b.north, z))), y1 = Math.min(n - 1, Math.floor(latToY(b.south, z)));
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count <= MAX_TILES || z <= MIN_ZOOM) {
      const out: Tile[] = [];
      for (let x = x0; x <= x1 && out.length < MAX_TILES; x++) for (let y = y0; y <= y1 && out.length < MAX_TILES; y++) {
        out.push({ z, x, y, west: xToLon(x, z), east: xToLon(x + 1, z), north: yToLat(y, z), south: yToLat(y + 1, z) });
      }
      return out;
    }
    z--;
  }
}

export const tileUrl = (layer: Exclude<BaseLayer, 'none'>, t: { z: number; x: number; y: number }) =>
  TILE_URL[layer].replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
