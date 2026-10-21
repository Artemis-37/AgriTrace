import { prepareFeatures, simplifyRing } from './reference-core';
import { mercatorToWgs84 } from './formats';

const sq = (x: number, y: number, s = 0.01) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

describe('couches de référence : préparation des zones', () => {
  it('lit les attributs WDPA en minuscules ou en majuscules et ignore les valeurs « Not Reported »', () => {
    const r = prepareFeatures([
      { props: { NAME: 'Parc national de Taï', DESIG_ENG: 'National Park', IUCN_CAT: 'II', STATUS: 'Designated', STATUS_YR: 1972, WDPAID: 721, MANG_AUTH: 'Not Reported' }, geometry: { type: 'Polygon', coordinates: [sq(-7.5, 5.8)] } },
      { props: { name: 'Divo', desig_eng: 'Classified Forest', iucn_cat: 'Not Applicable', status_yr: 1930 }, geometry: { type: 'MultiPolygon', coordinates: [[sq(-5.3, 5.8)], [sq(-5.2, 5.8)]] } },
    ]);
    expect(r.features).toHaveLength(2);
    const [a, b] = r.features;
    expect(a).toMatchObject({ name: 'Parc national de Taï', designation: 'National Park', category: 'II', status: 'Designated', year: 1972 });
    expect(a.properties.wdpaid).toBe(721);
    expect(a.properties.mang_auth).toBeUndefined();
    expect(b).toMatchObject({ name: 'Divo', designation: 'Classified Forest', category: null, year: 1930 });
    expect(b.geometry.type).toBe('MultiPolygon');
    expect(a.area_ha).toBeGreaterThan(115);
    expect(a.area_ha).toBeLessThan(130);
    expect(a.bbox).toEqual([-7.5, 5.8, -7.49, 5.81]);
  });
  it('ignore points, lignes, objets sans géométrie, coordonnées hors bornes et zones marines, en le disant', () => {
    const r = prepareFeatures([
      { props: { name: 'Point' }, geometry: { type: 'Point', coordinates: [-5, 6] } },
      { props: { name: 'Vide' }, geometry: null },
      { props: { name: 'Hors bornes' }, geometry: { type: 'Polygon', coordinates: [[[500, 6], [501, 6], [501, 7], [500, 6]]] } },
      { props: { name: 'Mer', marine: 2 }, geometry: { type: 'Polygon', coordinates: [sq(-4, 5)] } },
      { props: { name: 'Bonne' }, geometry: { type: 'Polygon', coordinates: [sq(-4, 6)] } },
    ]);
    expect(r.features.map((f) => f.name)).toEqual(['Bonne']);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['coordonnées invalides', 'géométrie Point ignorée (polygone attendu)', 'sans géométrie', 'zone entièrement marine']);
  });
  it('la simplification réduit les sommets sans déplacer le contour de plus de la tolérance', () => {
    const ring: number[][] = [];
    for (let i = 0; i <= 1000; i++) ring.push([-5 + i * 0.00001, 6 + 0.000003 * Math.sin(i)]); // bruit de ~0,3 m
    ring.push([-4.99, 6.01], [-5, 6.01], [-5, ring[0][1]]);
    const out = simplifyRing(ring, 0.00002);
    expect(out.length).toBeLessThan(10);
    expect(out[0]).toEqual(out[out.length - 1]);
    const r = prepareFeatures([{ props: { name: 'Bruit' }, geometry: { type: 'Polygon', coordinates: [ring] } }]);
    expect(r.vertices_after).toBeLessThan(r.vertices_before / 50);
  });
  it('un anneau ouvert est refermé ; un petit carré garde ses 5 points', () => {
    const open = sq(-4, 6).slice(0, 4);
    const r = prepareFeatures([{ props: { name: 'Ouvert' }, geometry: { type: 'Polygon', coordinates: [open] } }]);
    expect(r.features[0].geometry.coordinates[0]).toHaveLength(5);
  });
  it('conversion Web Mercator → WGS84 (Taï : −799 697 m, 682 696 m ≈ −7,18°, 6,10°)', () => {
    const g = mercatorToWgs84({ type: 'Polygon', coordinates: [[[-799697.1037892492, 682695.5592469447], [-799000, 682695.5592469447], [-799000, 683000], [-799697.1037892492, 682695.5592469447]]] });
    const [lon, lat] = g.coordinates[0][0];
    expect(lon).toBeCloseTo(-7.1835, 3);
    expect(lat).toBeCloseTo(6.1, 1);
  });
});
