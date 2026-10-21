import { epsgFromName, mercatorPoint, reprojectorFor, utmToWgs84, utmZone } from './projection';

// Valeurs de référence calculées avec PROJ (pyproj) : WGS84 → UTM.
const REF: [number, number, number, number, number, boolean][] = [
  // lon, lat, est, nord, fuseau, sud
  [-5.75, 6.85, 196049.55183183117, 758037.4355434281, 30, false],
  [-3.0, 0.0, 500000, 0, 30, false],
  [-6.2, 5.3, 145249.7930020953, 586741.7846442636, 30, false],
  [-4.0, 9.5, 390235.79320507875, 1050289.6523312645, 30, false],
  [-6.5, 7.2, 776093.7686350622, 796613.5643473548, 29, false],
  [-4.0, -12.0, 391135.82662981143, 8673248.829283066, 30, true],
];

describe('projection UTM → WGS84', () => {
  it.each(REF)('(%f, %f) retrouvé à moins de 1 cm près', (lon, lat, e, n, zone, south) => {
    const [l, p] = utmToWgs84(e, n, zone, south);
    expect(Math.abs(l - lon)).toBeLessThan(1e-7); // 1e-7° ≈ 1 cm
    expect(Math.abs(p - lat)).toBeLessThan(1e-7);
  });
  it('reconnaît les fuseaux et refuse le reste', () => {
    expect(utmZone(32630)).toEqual({ zone: 30, south: false });
    expect(utmZone(32730)).toEqual({ zone: 30, south: true });
    expect(utmZone(32661)).toBeNull();
    expect(utmZone(2043)).toBeNull(); // datum local (Locodjo/Abidjan) : non pris en charge
    expect(reprojectorFor(2043)).toBeNull();
    expect(reprojectorFor(3857)).toBeNull();
    expect(reprojectorFor(3857, { allowWebMercator: true })).not.toBeNull();
  });
  it('lit le code dans les noms usuels', () => {
    expect(epsgFromName('EPSG:32630')).toBe(32630);
    expect(epsgFromName('urn:ogc:def:crs:EPSG::32630')).toBe(32630);
    expect(epsgFromName('urn:ogc:def:crs:OGC:1.3:CRS84')).toBe(4326);
    expect(epsgFromName('WGS_1984_UTM_Zone_30N')).toBe(32630);
    expect(epsgFromName('Abidjan_1987_UTM_Zone_30N')).toBeNull();
  });
  it('transforme une géométrie complète et garde l\'altitude éventuelle', () => {
    const r = reprojectorFor(32630)!;
    const g = r.apply({ type: 'Polygon', coordinates: [[[196049.55183183117, 758037.4355434281, 120], [196149.5, 758037.4, 120], [196149.5, 758137.4, 120], [196049.55183183117, 758037.4355434281, 120]]] });
    expect(g.coordinates[0][0][2]).toBe(120);
    expect(Math.abs(g.coordinates[0][0][0] + 5.75)).toBeLessThan(1e-7);
    expect(r.label).toContain('UTM 30N');
  });
  it('Web Mercator : origine et antiméridien', () => {
    expect(mercatorPoint(0, 0)).toEqual([0, 0]);
    expect(mercatorPoint(20037508.342789244, 0)[0]).toBeCloseTo(180, 9);
  });
});
