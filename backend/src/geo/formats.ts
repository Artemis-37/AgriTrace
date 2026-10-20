import { DOMParser } from '@xmldom/xmldom';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import JSZip from 'jszip';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Polygon } from '../parcels/geo';

export type GeoFormat = 'geojson' | 'kml' | 'kmz' | 'shapefile' | 'gpkg';
export interface RawFeature { props: Record<string, any>; geometry: any | null }
export interface ParsedFile { format: GeoFormat; features: RawFeature[]; warnings: string[]; crs: string }
export class GeoFormatError extends Error {}

export const MAX_FEATURES = 5000;
const MAX_ZIP_ENTRIES = 100, MAX_ENTRY_BYTES = 40 * 1024 * 1024, MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const EXT: Record<string, GeoFormat> = { geojson: 'geojson', json: 'geojson', kml: 'kml', kmz: 'kmz', zip: 'shapefile', gpkg: 'gpkg' };

// ---------------------------------------------------------------------------------------------------------------------
// Archives ZIP (KMZ, Shapefile) : lecture en mémoire uniquement (aucune extraction sur le disque), chemins et tailles contrôlés.
// ---------------------------------------------------------------------------------------------------------------------
export async function openZip(buf: Buffer): Promise<JSZip> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new GeoFormatError('Archive ZIP corrompue ou illisible'); }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES) throw new GeoFormatError(`Archive refusée : plus de ${MAX_ZIP_ENTRIES} fichiers`);
  let total = 0;
  for (const n of names) {
    if (n.includes('..') || n.startsWith('/') || n.includes('\\') || /^[a-zA-Z]:/.test(n)) throw new GeoFormatError(`Archive refusée : chemin non autorisé (${n})`);
    const f: any = zip.files[n];
    if (f.dir) continue;
    const size = f._data?.uncompressedSize;
    if (typeof size === 'number') {
      if (size > MAX_ENTRY_BYTES) throw new GeoFormatError(`Archive refusée : « ${n} » dépasse ${MAX_ENTRY_BYTES / 1048576} Mo décompressé`);
      total += size;
    }
  }
  if (total > MAX_TOTAL_BYTES) throw new GeoFormatError('Archive refusée : taille décompressée excessive');
  return zip;
}
const findEntry = (zip: JSZip, ext: string) => Object.keys(zip.files).find((n) => !zip.files[n].dir && n.toLowerCase().endsWith(ext));

// ---------------------------------------------------------------------------------------------------------------------
// Détection et lecture
// ---------------------------------------------------------------------------------------------------------------------
export function detectFormat(buf: Buffer): GeoFormat | 'zip' | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
  if (buf.slice(0, 15).toString('latin1') === 'SQLite format 3') return 'gpkg';
  const head = buf.slice(0, 200).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'geojson';
  if (head.startsWith('<')) return 'kml';
  return null;
}

export async function parseGeoFile(buf: Buffer, filename: string, opts: { assumeWgs84?: boolean; layer?: string } = {}): Promise<ParsedFile> {
  const real = detectFormat(buf);
  if (!real) throw new GeoFormatError('Format non reconnu : GeoJSON, KML, KMZ, Shapefile (ZIP) ou GeoPackage attendus');
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const declared = EXT[ext];
  if (!declared) throw new GeoFormatError(`Extension « .${ext} » non prise en charge (.geojson, .json, .kml, .kmz, .zip, .gpkg)`);
  let parsed: ParsedFile;
  if (real === 'zip') {
    const zip = await openZip(buf);
    if (findEntry(zip, '.shp')) { if (declared !== 'shapefile') throw mismatch(ext, 'Shapefile'); parsed = await parseShapefile(zip, !!opts.assumeWgs84); }
    else if (findEntry(zip, '.kml')) { if (declared !== 'kmz') throw mismatch(ext, 'KMZ'); parsed = await parseKmz(zip); }
    else throw new GeoFormatError('Archive ZIP sans fichier .shp ni .kml');
  } else {
    if (declared !== real && !(real === 'geojson' && declared === 'geojson')) throw mismatch(ext, real === 'gpkg' ? 'GeoPackage' : real === 'kml' ? 'KML' : 'GeoJSON');
    if (real === 'geojson') parsed = parseGeoJson(buf.toString('utf8'));
    else if (real === 'kml') parsed = parseKml(buf.toString('utf8'));
    else parsed = parseGpkg(buf, opts.layer);
  }
  if (parsed.features.length > MAX_FEATURES) throw new GeoFormatError(`Fichier refusé : ${parsed.features.length} objets (maximum ${MAX_FEATURES} par import)`);
  if (!parsed.features.length) throw new GeoFormatError('Fichier sans aucun objet géographique');
  return parsed;
}
const mismatch = (ext: string, real: string) => new GeoFormatError(`L'extension « .${ext} » ne correspond pas au contenu réel du fichier (${real})`);

export function parseGeoJson(text: string): ParsedFile {
  let o: any;
  try { o = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new GeoFormatError('GeoJSON mal formé (JSON invalide)'); }
  const crsName = o?.crs?.properties?.name;
  if (crsName && !/(4326|CRS84)/i.test(String(crsName))) throw new GeoFormatError(`Système de coordonnées non pris en charge (${crsName}) : WGS84 (EPSG:4326) attendu`);
  const feats: any[] = o?.type === 'FeatureCollection' && Array.isArray(o.features) ? o.features
    : o?.type === 'Feature' ? [o] : o?.type && o.coordinates ? [{ type: 'Feature', properties: {}, geometry: o }] : [];
  if (!feats.length && !(o?.type === 'FeatureCollection')) throw new GeoFormatError('GeoJSON sans Feature exploitable');
  return { format: 'geojson', crs: 'EPSG:4326', warnings: [], features: feats.map((f) => ({ props: f?.properties && typeof f.properties === 'object' ? f.properties : {}, geometry: f?.geometry ?? null })) };
}

export function parseKml(text: string, format: GeoFormat = 'kml'): ParsedFile {
  if (/<!ENTITY|<!DOCTYPE/i.test(text)) throw new GeoFormatError('KML refusé : déclaration DOCTYPE/ENTITY interdite');
  let doc: any;
  try {
    doc = new DOMParser({ onError: (level: string, msg: string) => { if (level !== 'warning') throw new Error(msg); } } as any).parseFromString(text, 'text/xml');
  } catch (e: any) { throw new GeoFormatError(`KML mal formé : ${String(e.message).slice(0, 120)}`); }
  let fc: any;
  try { fc = kmlToGeoJson(doc); } catch { throw new GeoFormatError('KML illisible'); }
  const out: RawFeature[] = [];
  for (const f of fc.features as any[]) {
    const g = f.geometry;
    const props = { ...(f.properties ?? {}) };
    if (g?.type === 'GeometryCollection') {
      // MultiGeometry : on ne garde un polygone que s'il est unique ; sinon objet signalé comme multi-partie
      const polys = g.geometries.filter((x: any) => x.type === 'Polygon');
      out.push({ props, geometry: polys.length === 1 && g.geometries.length === 1 ? polys[0] : g });
    } else out.push({ props, geometry: g ?? null });
  }
  return { format, crs: 'EPSG:4326', warnings: ['KML : WGS84 par définition du format'], features: out };
}

async function parseKmz(zip: JSZip): Promise<ParsedFile> {
  const name = findEntry(zip, 'doc.kml') ?? findEntry(zip, '.kml')!;
  const text = await zip.files[name].async('string');
  return parseKml(text, 'kmz');
}

// ---- Shapefile -------------------------------------------------------------------------------------------------------
async function parseShapefile(zip: JSZip, assumeWgs84: boolean): Promise<ParsedFile> {
  const warnings: string[] = [];
  const shpName = findEntry(zip, '.shp')!;
  const base = shpName.slice(0, -4);
  const get = async (ext: string) => { const n = Object.keys(zip.files).find((x) => x.toLowerCase() === (base + ext).toLowerCase()); return n ? Buffer.from(await zip.files[n].async('uint8array')) : null; };
  const shp = Buffer.from(await zip.files[shpName].async('uint8array'));
  const dbf = await get('.dbf');
  if (!dbf) throw new GeoFormatError('Shapefile incomplet : fichier .dbf (attributs) manquant');
  if (!(await get('.shx'))) warnings.push('Fichier .shx absent (non bloquant)');
  const prj = await get('.prj');
  if (!prj) {
    if (!assumeWgs84) throw new GeoFormatError('Shapefile sans fichier .prj : système de coordonnées inconnu. Ajouter le .prj (WGS84) ou confirmer avec assume_wgs84=true');
    warnings.push('Pas de .prj : WGS84 supposé sur confirmation de l\'utilisateur');
  } else {
    const wkt = prj.toString('utf8');
    if (/PROJCS/i.test(wkt) || !/(WGS[_ ]?(19)?84|EPSG["',\s\[]*4326)/i.test(wkt))
      throw new GeoFormatError(`Système de coordonnées non pris en charge dans le .prj (${wkt.slice(0, 60)}…) : WGS84 géographique (EPSG:4326) attendu, aucune reprojection n'est effectuée`);
  }
  const cpg = await get('.cpg');
  const enc = cpg && /(1252|8859|latin)/i.test(cpg.toString('utf8')) ? 'latin1' : 'utf8';
  const geoms = readShp(shp);
  const rows = readDbf(dbf, enc);
  if (geoms.length !== rows.length) throw new GeoFormatError(`Shapefile incohérent : ${geoms.length} géométries pour ${rows.length} enregistrements d'attributs`);
  return { format: 'shapefile', crs: 'EPSG:4326', warnings, features: geoms.map((g, i) => ({ props: rows[i], geometry: g })) };
}

function readShp(b: Buffer): any[] {
  if (b.length < 100 || b.readInt32BE(0) !== 9994) throw new GeoFormatError('Fichier .shp invalide (code 9994 attendu)');
  const out: any[] = [];
  let off = 100;
  while (off + 8 <= b.length) {
    const len = b.readInt32BE(off + 4) * 2;
    const start = off + 8;
    if (start + len > b.length) throw new GeoFormatError('Fichier .shp tronqué');
    const type = b.readInt32LE(start);
    if (type === 0) out.push(null);
    else if (type === 5 || type === 15 || type === 25) {
      const nParts = b.readInt32LE(start + 36), nPts = b.readInt32LE(start + 40);
      if (nParts < 0 || nPts < 0 || nPts > 2_000_000 || nParts > 100_000) throw new GeoFormatError('Fichier .shp invalide (compteurs hors limites)');
      const partsOff = start + 44, ptsOff = partsOff + 4 * nParts;
      if (ptsOff + 16 * nPts > start + len) throw new GeoFormatError('Fichier .shp invalide (enregistrement incohérent)');
      const parts: number[] = []; for (let i = 0; i < nParts; i++) parts.push(b.readInt32LE(partsOff + 4 * i));
      const rings: number[][][] = [];
      for (let i = 0; i < nParts; i++) {
        const s = parts[i], e = i + 1 < nParts ? parts[i + 1] : nPts;
        const ring: number[][] = [];
        for (let j = s; j < e; j++) ring.push([b.readDoubleLE(ptsOff + 16 * j), b.readDoubleLE(ptsOff + 16 * j + 8)]);
        rings.push(ring);
      }
      const signed = (r: number[][]) => { let a = 0; for (let k = 0; k < r.length - 1; k++) a += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; return a; };
      const outers = rings.filter((r) => signed(r) < 0), holes = rings.filter((r) => signed(r) >= 0);
      const ccw = (r: number[][]) => (signed(r) < 0 ? r.slice().reverse() : r);
      if (rings.length === 1) out.push({ type: 'Polygon', coordinates: [ccw(rings[0])] });
      else if (!holes.length) out.push({ type: 'MultiPolygon', coordinates: outers.map((r) => [ccw(r)]) });
      else out.push({ type: 'Polygon', coordinates: rings }); // trous : refusé plus loin avec un message explicite
    } else if (type === 1 || type === 11 || type === 21) out.push({ type: 'Point', coordinates: [b.readDoubleLE(start + 4), b.readDoubleLE(start + 12)] });
    else if (type === 3 || type === 13 || type === 23) out.push({ type: 'LineString', coordinates: [] });
    else throw new GeoFormatError(`Type de forme Shapefile non pris en charge (${type})`);
    off = start + len;
  }
  return out;
}

function readDbf(b: Buffer, enc: 'utf8' | 'latin1'): Record<string, any>[] {
  if (b.length < 33) throw new GeoFormatError('Fichier .dbf invalide');
  const n = b.readUInt32LE(4), headerLen = b.readUInt16LE(8), recLen = b.readUInt16LE(10);
  const fields: { name: string; type: string; len: number }[] = [];
  for (let o = 32; o < headerLen - 1 && b[o] !== 0x0d; o += 32) {
    fields.push({ name: b.slice(o, o + 11).toString('latin1').replace(/\0.*$/, '').trim(), type: String.fromCharCode(b[o + 11]), len: b[o + 16] });
  }
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < n; i++) {
    const ro = headerLen + i * recLen;
    if (ro + recLen > b.length) throw new GeoFormatError('Fichier .dbf tronqué');
    let p = ro + 1; const row: Record<string, any> = {};
    for (const f of fields) {
      const raw = b.slice(p, p + f.len).toString(enc).replace(/\0/g, '').trim(); p += f.len;
      // Les codes en texte (type C) gardent leurs zéros initiaux ; un champ numérique (N) a déjà perdu les siens à l'origine.
      row[f.name] = f.type === 'N' || f.type === 'F' ? (raw === '' ? null : Number(raw)) : f.type === 'L' ? /^[TtYy]/.test(raw) : raw;
    }
    rows.push(row);
  }
  return rows;
}

// ---- GeoPackage ------------------------------------------------------------------------------------------------------
const sqlite = () => (require as any)('node:sqlite') as { DatabaseSync: new (path: string, opts?: any) => any };
const qIdent = (s: string) => '"' + s.replace(/"/g, '""') + '"';

function readWkb(b: Buffer, o: { p: number }): any {
  const le = b.readUInt8(o.p++) === 1;
  const u32 = () => { const v = le ? b.readUInt32LE(o.p) : b.readUInt32BE(o.p); o.p += 4; return v; };
  const f64 = () => { const v = le ? b.readDoubleLE(o.p) : b.readDoubleBE(o.p); o.p += 8; return v; };
  let t = u32();
  let dims = 2;
  if (t >= 1000) { const k = Math.floor(t / 1000); dims = k === 1 ? 3 : k === 2 ? 3 : 4; t %= 1000; }
  else { if (t & 0x80000000) dims++; if (t & 0x40000000) dims++; if (t & 0x20000000) u32(); t &= 0xff; }
  const pt = () => { const x = f64(), y = f64(); for (let i = 2; i < dims; i++) f64(); return [x, y]; };
  const ring = () => { const n = u32(); if (n > 2_000_000) throw new GeoFormatError('WKB invalide'); const r: number[][] = []; for (let i = 0; i < n; i++) r.push(pt()); return r; };
  if (t === 1) return { type: 'Point', coordinates: pt() };
  if (t === 2) return { type: 'LineString', coordinates: ring() };
  if (t === 3) { const n = u32(); const rings = []; for (let i = 0; i < n; i++) rings.push(ring()); return { type: 'Polygon', coordinates: rings }; }
  if (t === 6) { const n = u32(); const polys = []; for (let i = 0; i < n; i++) polys.push(readWkb(b, o).coordinates); return { type: 'MultiPolygon', coordinates: polys }; }
  if (t === 4 || t === 5 || t === 7) { const n = u32(); for (let i = 0; i < n; i++) readWkb(b, o); return { type: 'GeometryCollection', geometries: [] }; }
  throw new GeoFormatError(`Type de géométrie WKB non pris en charge (${t})`);
}

function gpkgBlobToGeometry(blob: Buffer): any | null {
  if (blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) throw new GeoFormatError('Géométrie GeoPackage invalide (en-tête GP absent)');
  const flags = blob[3];
  if (flags & 0x10) return null; // géométrie vide
  const envelope = (flags >> 1) & 7;
  const envBytes = [0, 32, 48, 48, 64][envelope];
  if (envBytes === undefined) throw new GeoFormatError('Géométrie GeoPackage invalide (enveloppe)');
  return readWkb(blob, { p: 8 + envBytes });
}

export function parseGpkg(buf: Buffer, layer?: string): ParsedFile {
  const dir = mkdtempSync(join(tmpdir(), 'agritrace-gpkg-'));
  const file = join(dir, 'in.gpkg');
  try {
    writeFileSync(file, buf, { mode: 0o600 });
    const { DatabaseSync } = sqlite();
    let db: any;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const app = db.prepare('PRAGMA application_id').get();
      const cols = db.prepare('SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns').all() as any[];
      if (!cols.length) throw new GeoFormatError('GeoPackage sans couche vectorielle');
      const c = layer ? cols.find((x) => x.table_name === layer) : cols[0];
      if (!c) throw new GeoFormatError(`Couche « ${layer} » introuvable (disponibles : ${cols.map((x) => x.table_name).join(', ')})`);
      const srs = db.prepare('SELECT organization, organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id = ?').get(c.srs_id) as any;
      const epsg = srs ? Number(srs.organization_coordsys_id) : c.srs_id;
      if (epsg !== 4326) throw new GeoFormatError(`Système de coordonnées non pris en charge (EPSG:${epsg}) : WGS84 (EPSG:4326) attendu, aucune reprojection n'est effectuée`);
      void app;
      const rows = db.prepare(`SELECT * FROM ${qIdent(c.table_name)} LIMIT ${MAX_FEATURES + 1}`).all() as any[];
      const features: RawFeature[] = rows.map((r) => {
        const props: Record<string, any> = {};
        for (const [k, v] of Object.entries(r)) if (k !== c.column_name && !(v instanceof Uint8Array)) props[k] = typeof v === 'bigint' ? Number(v) : v;
        const blob = r[c.column_name];
        return { props, geometry: blob ? gpkgBlobToGeometry(Buffer.from(blob)) : null };
      });
      return { format: 'gpkg', crs: 'EPSG:4326', warnings: cols.length > 1 ? [`Plusieurs couches : « ${c.table_name} » lue`] : [], features };
    } catch (e: any) {
      if (e instanceof GeoFormatError) throw e;
      throw new GeoFormatError(`GeoPackage illisible ou non conforme : ${String(e.message).slice(0, 120)}`);
    } finally { try { db?.close(); } catch { /* ignoré */ } }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------------------------------
export interface ExportColumn { key: string; shp: string; type: 'C' | 'N'; dec?: number }
export interface ExportRow { props: Record<string, any>; geometry: Polygon }
export interface BuiltExport { buffer: Buffer; contentType: string; extension: string }

const xml = (s: any) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function buildGeoJson(rows: ExportRow[]): BuiltExport {
  const fc = { type: 'FeatureCollection', name: 'parcelles', features: rows.map((r) => ({ type: 'Feature', properties: r.props, geometry: r.geometry })) };
  return { buffer: Buffer.from(JSON.stringify(fc)), contentType: 'application/geo+json', extension: 'geojson' };
}

export function buildKmlText(rows: ExportRow[], cols: ExportColumn[]): string {
  const pm = rows.map((r) => {
    const data = cols.map((c) => `<Data name="${xml(c.key)}"><value>${xml(r.props[c.key])}</value></Data>`).join('');
    const coords = r.geometry.coordinates[0].map((p) => `${p[0]},${p[1]},0`).join(' ');
    return `<Placemark><name>${xml(r.props.parcel_code)}</name><ExtendedData>${data}</ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>AgriTrace — parcelles</name>\n${pm}\n</Document></kml>\n`;
}
export const buildKml = (rows: ExportRow[], cols: ExportColumn[]): BuiltExport => ({ buffer: Buffer.from(buildKmlText(rows, cols)), contentType: 'application/vnd.google-earth.kml+xml', extension: 'kml' });

export async function buildKmz(rows: ExportRow[], cols: ExportColumn[]): Promise<BuiltExport> {
  const zip = new JSZip(); zip.file('doc.kml', buildKmlText(rows, cols));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), contentType: 'application/vnd.google-earth.kmz', extension: 'kmz' };
}

const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

export async function buildShapefile(rows: ExportRow[], cols: ExportColumn[]): Promise<BuiltExport> {
  const cw = (g: Polygon) => { const r = g.coordinates[0].slice(); let a = 0; for (let k = 0; k < r.length - 1; k++) a += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; return a > 0 ? r.reverse() : r; };
  const recs = rows.map((r) => cw(r.geometry));
  const sizes = recs.map((ring) => 8 + 44 + 4 + 16 * ring.length); // en-tête d'enregistrement + contenu
  const shpLen = 100 + sizes.reduce((s, x) => s + x, 0);
  const shp = Buffer.alloc(shpLen), shx = Buffer.alloc(100 + 8 * recs.length);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const ring of recs) for (const p of ring) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
  if (!recs.length) { minx = miny = maxx = maxy = 0; }
  for (const [buf, len] of [[shp, shpLen], [shx, shx.length]] as [Buffer, number][]) {
    buf.writeInt32BE(9994, 0); buf.writeInt32BE(len / 2, 24); buf.writeInt32LE(1000, 28); buf.writeInt32LE(5, 32);
    buf.writeDoubleLE(minx, 36); buf.writeDoubleLE(miny, 44); buf.writeDoubleLE(maxx, 52); buf.writeDoubleLE(maxy, 60);
  }
  let off = 100;
  recs.forEach((ring, i) => {
    const content = sizes[i] - 8;
    shx.writeInt32BE(off / 2, 100 + 8 * i); shx.writeInt32BE(content / 2, 104 + 8 * i);
    shp.writeInt32BE(i + 1, off); shp.writeInt32BE(content / 2, off + 4);
    let p = off + 8; shp.writeInt32LE(5, p); p += 4;
    const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
    shp.writeDoubleLE(Math.min(...xs), p); shp.writeDoubleLE(Math.min(...ys), p + 8); shp.writeDoubleLE(Math.max(...xs), p + 16); shp.writeDoubleLE(Math.max(...ys), p + 24); p += 32;
    shp.writeInt32LE(1, p); shp.writeInt32LE(ring.length, p + 4); shp.writeInt32LE(0, p + 8); p += 12;
    for (const q of ring) { shp.writeDoubleLE(q[0], p); shp.writeDoubleLE(q[1], p + 8); p += 16; }
    off += sizes[i];
  });
  // DBF : champs C (texte UTF-8) et N (numériques) ; noms limités à 10 caractères (limite du format)
  const text = (v: any) => Buffer.from(v === null || v === undefined ? '' : String(v), 'utf8');
  const lens = cols.map((c) => c.type === 'N' ? 20 : Math.min(254, Math.max(1, ...rows.map((r) => text(r.props[c.key]).length))));
  const recLen = 1 + lens.reduce((s, x) => s + x, 0), headerLen = 33 + 32 * cols.length;
  const dbf = Buffer.alloc(headerLen + recLen * rows.length + 1, 0x20);
  const now = new Date();
  dbf[0] = 0x03; dbf[1] = now.getUTCFullYear() - 1900; dbf[2] = now.getUTCMonth() + 1; dbf[3] = now.getUTCDate();
  dbf.writeUInt32LE(rows.length, 4); dbf.writeUInt16LE(headerLen, 8); dbf.writeUInt16LE(recLen, 10);
  dbf.fill(0, 12, 32);
  cols.forEach((c, i) => {
    const o = 32 + 32 * i; dbf.fill(0, o, o + 32);
    dbf.write(c.shp.slice(0, 10), o, 'latin1'); dbf[o + 11] = c.type.charCodeAt(0); dbf[o + 16] = lens[i]; dbf[o + 17] = c.type === 'N' ? (c.dec ?? 6) : 0;
  });
  dbf[headerLen - 1] = 0x0d;
  rows.forEach((r, ri) => {
    let p = headerLen + ri * recLen; dbf[p++] = 0x20;
    cols.forEach((c, i) => {
      const v = r.props[c.key];
      if (c.type === 'N') { const s = v === null || v === undefined || v === '' ? '' : Number(v).toFixed(c.dec ?? 6); dbf.write(s.padStart(lens[i], ' '), p, 'latin1'); }
      else { let t = text(v); if (t.length > lens[i]) { t = t.slice(0, lens[i]); while (t.length && (t[t.length - 1] & 0xc0) === 0x80) t = t.slice(0, -1); } t.copy(dbf, p); }
      p += lens[i];
    });
  });
  dbf[dbf.length - 1] = 0x1a;
  const zip = new JSZip();
  zip.file('parcelles.shp', shp); zip.file('parcelles.shx', shx); zip.file('parcelles.dbf', dbf); zip.file('parcelles.prj', PRJ_WGS84); zip.file('parcelles.cpg', 'UTF-8');
  zip.file('champs.txt', 'Correspondance des noms de champs (le format Shapefile limite les noms à 10 caractères) :\n' + cols.map((c) => `${c.shp} = ${c.key}`).join('\n') + '\n');
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), contentType: 'application/zip', extension: 'zip' };
}

function gpkgGeom(g: Polygon): Buffer {
  const ring = g.coordinates[0];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const head = Buffer.alloc(8 + 32); head[0] = 0x47; head[1] = 0x50; head[2] = 0; head[3] = 0x03; head.writeInt32LE(4326, 4);
  head.writeDoubleLE(Math.min(...xs), 8); head.writeDoubleLE(Math.max(...xs), 16); head.writeDoubleLE(Math.min(...ys), 24); head.writeDoubleLE(Math.max(...ys), 32);
  const wkb = Buffer.alloc(1 + 4 + 4 + 4 + 16 * ring.length); wkb[0] = 1; wkb.writeUInt32LE(3, 1); wkb.writeUInt32LE(1, 5); wkb.writeUInt32LE(ring.length, 9);
  ring.forEach((p, i) => { wkb.writeDoubleLE(p[0], 13 + 16 * i); wkb.writeDoubleLE(p[1], 21 + 16 * i); });
  return Buffer.concat([head, wkb]);
}

export function buildGpkg(rows: ExportRow[], cols: ExportColumn[]): BuiltExport {
  const dir = mkdtempSync(join(tmpdir(), 'agritrace-gpkg-'));
  const file = join(dir, 'out.gpkg');
  try {
    const { DatabaseSync } = sqlite();
    const db = new DatabaseSync(file);
    db.exec('PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;');
    db.exec(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name), CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name), CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));`);
    const ins = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)');
    ins.run('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system');
    ins.run('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system');
    ins.run('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]', 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');
    const colDefs = cols.map((c) => `${qIdent(c.key)} ${c.type === 'N' ? 'REAL' : 'TEXT'}`).join(', ');
    db.exec(`CREATE TABLE parcelles (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POLYGON, ${colDefs});`);
    let minx = 180, miny = 90, maxx = -180, maxy = -90;
    const names = cols.map((c) => qIdent(c.key)).join(', '), marks = cols.map(() => '?').join(', ');
    const insRow = db.prepare(`INSERT INTO parcelles (geom, ${names}) VALUES (?, ${marks})`);
    db.exec('BEGIN');
    for (const r of rows) {
      for (const p of r.geometry.coordinates[0]) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
      insRow.run(gpkgGeom(r.geometry), ...cols.map((c) => { const v = r.props[c.key]; return v === undefined || v === null ? null : c.type === 'N' ? Number(v) : String(v); }));
    }
    db.exec('COMMIT');
    if (!rows.length) { minx = miny = maxx = maxy = 0; }
    db.prepare(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES ('parcelles','features','parcelles','Parcelles AgriTrace',?,?,?,?,4326)`).run(minx, miny, maxx, maxy);
    db.exec(`INSERT INTO gpkg_geometry_columns VALUES ('parcelles','geom','POLYGON',4326,0,0)`);
    db.close();
    return { buffer: readFileSync(file), contentType: 'application/geopackage+sqlite3', extension: 'gpkg' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
