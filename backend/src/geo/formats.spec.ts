import JSZip from 'jszip';
import { buildGeoJson, buildGpkg, buildKml, buildKmz, buildShapefile, ExportColumn, ExportRow, GeoFormatError, parseGeoFile } from './formats';

const sq = (lon: number, lat: number, s = 0.001): any => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
const cols: ExportColumn[] = [
  { key: 'parcel_code', shp: 'parcel_cod', type: 'C' }, { key: 'producer_code', shp: 'prod_code', type: 'C' },
  { key: 'filiere', shp: 'filiere', type: 'C' }, { key: 'declared_area_ha', shp: 'decl_ha', type: 'N', dec: 4 },
];
const rows: ExportRow[] = [
  { props: { parcel_code: '000125-P1', producer_code: '000125', filiere: 'Cacao', declared_area_ha: 3.5 }, geometry: sq(-6, 6.8) },
  { props: { parcel_code: '000126-P1', producer_code: '000126', filiere: 'Café é&<>', declared_area_ha: 2.1 }, geometry: sq(-5.9, 6.81, 0.002) },
];

async function check(buf: Buffer, name: string) {
  const p = await parseGeoFile(buf, name);
  expect(p.features).toHaveLength(2);
  const f0 = p.features[0];
  expect(f0.geometry.type).toBe('Polygon');
  const ring = f0.geometry.coordinates[0];
  expect(ring[0][0]).toBeCloseTo(-6, 9);
  expect(Math.max(...ring.map((c: number[]) => c[1]))).toBeCloseTo(6.801, 9);
  // le code producteur en texte garde ses zéros initiaux
  const key = p.features[0].props.producer_code !== undefined ? 'producer_code' : 'prod_code';
  expect(p.features[0].props[key]).toBe('000125');
  expect(p.features[1].props.filiere).toBe('Café é&<>');
  return p;
}

describe('formats cartographiques : écriture puis relecture', () => {
  it('GeoJSON', async () => { await check(buildGeoJson(rows).buffer, 'p.geojson'); });
  it('KML', async () => { await check(buildKml(rows, cols).buffer, 'p.kml'); });
  it('KMZ', async () => { await check((await buildKmz(rows, cols)).buffer, 'p.kmz'); });
  it('Shapefile (ZIP avec .prj)', async () => {
    const out = await buildShapefile(rows, cols);
    const p = await check(out.buffer, 'p.zip');
    expect(p.format).toBe('shapefile');
    expect(Number(p.features[0].props.decl_ha)).toBeCloseTo(3.5, 4);
  });
  it('GeoPackage', async () => {
    const out = buildGpkg(rows, cols);
    const p = await check(out.buffer, 'p.gpkg');
    expect(p.format).toBe('gpkg');
    expect(p.features[1].props.declared_area_ha).toBeCloseTo(2.1, 6);
  });
});

describe('fichiers refusés', () => {
  it('extension différente du contenu réel', async () => {
    await expect(parseGeoFile(buildKml(rows, cols).buffer, 'p.geojson')).rejects.toThrow(/ne correspond pas/);
  });
  it('GeoJSON mal formé', async () => { await expect(parseGeoFile(Buffer.from('{"type":'), 'p.geojson')).rejects.toThrow(GeoFormatError); });
  it('GeoJSON dans un autre système de coordonnées', async () => {
    const g = JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32630' } }, features: [] });
    await expect(parseGeoFile(Buffer.from(g), 'p.geojson')).rejects.toThrow(/Système de coordonnées/);
  });
  it('KML avec ENTITY (XXE) refusé', async () => {
    const x = '<?xml version="1.0"?><!DOCTYPE k [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>';
    await expect(parseGeoFile(Buffer.from(x), 'p.kml')).rejects.toThrow(/DOCTYPE|ENTITY/);
  });
  it('archive avec chemin dangereux refusée', async () => {
    const z = new JSZip(); z.file('../evil.kml', '<kml/>');
    await expect(parseGeoFile(await z.generateAsync({ type: 'nodebuffer' }), 'p.kmz')).rejects.toThrow(/chemin non autorisé/);
  });
  it('Shapefile sans .prj refusé, accepté avec confirmation', async () => {
    const full = await JSZip.loadAsync((await buildShapefile(rows, cols)).buffer);
    full.remove('parcelles.prj');
    const buf = await full.generateAsync({ type: 'nodebuffer' });
    await expect(parseGeoFile(buf, 'p.zip')).rejects.toThrow(/\.prj/);
    expect((await parseGeoFile(buf, 'p.zip', { assumeWgs84: true })).warnings.join(' ')).toMatch(/WGS84 supposé/);
  });
  it('Shapefile projeté (UTM) refusé', async () => {
    const full = await JSZip.loadAsync((await buildShapefile(rows, cols)).buffer);
    full.file('parcelles.prj', 'PROJCS["WGS_1984_UTM_Zone_30N",GEOGCS["GCS_WGS_1984"]]');
    await expect(parseGeoFile(await full.generateAsync({ type: 'nodebuffer' }), 'p.zip')).rejects.toThrow(/Système de coordonnées/);
  });
  it('fichier inconnu / archive corrompue', async () => {
    await expect(parseGeoFile(Buffer.from('hello world'), 'p.geojson')).rejects.toThrow(/Format non reconnu/);
    await expect(parseGeoFile(Buffer.from('PK\x03\x04nope'), 'p.zip')).rejects.toThrow(/corrompue|illisible/);
  });
});
