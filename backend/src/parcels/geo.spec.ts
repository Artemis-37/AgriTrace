import { areaGapPct, centroid, interiorPoint, pointInRing, polygonAreaHa, validatePolygon } from './geo';

// Carré d'environ 100 m × 100 m près de l'équateur (≈ 1 ha)
const d = 0.0009;
const square = (lon = -6, lat = 6.8) => ({ type: 'Polygon' as const, coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });

describe('géométrie des parcelles', () => {
  it('calcule une surface d\'environ 1 ha pour un carré de 100 m', () => {
    expect(polygonAreaHa(square())).toBeGreaterThan(0.95);
    expect(polygonAreaHa(square())).toBeLessThan(1.05);
  });
  it('accepte un polygone valide', () => expect(validatePolygon(square())).toBeNull());
  it('refuse un anneau non fermé', () => {
    const g = square(); g.coordinates[0].pop();
    expect(validatePolygon(g)).toMatch(/fermé|4 points/);
  });
  it('refuse des coordonnées hors bornes, un mauvais type et une surface nulle', () => {
    expect(validatePolygon(square(200, 6))).toMatch(/hors bornes/);
    expect(validatePolygon({ type: 'Point', coordinates: [0, 0] })).toMatch(/Polygon/);
    expect(validatePolygon({ type: 'Polygon', coordinates: [[[1, 1], [2, 2], [3, 3], [1, 1]]] })).toMatch(/surface nulle/);
  });
  it('calcule le centre et l\'écart de surface', () => {
    const c = centroid(square());
    expect(c.lat).toBeCloseTo(6.80045, 4);
    expect(areaGapPct(1, 1.25)).toBeCloseTo(25, 5);
  });
  it('place le centre dans le polygone, même pour une parcelle en L ou en croissant', () => {
    const sq = interiorPoint(square());
    expect(pointInRing(square().coordinates[0], sq.lon, sq.lat)).toBe(true);
    // U très ouvert : le centre de gravité tombe dans le vide
    const u: any = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [8, 10], [8, 2], [2, 2], [2, 10], [0, 10], [0, 0]]] };
    expect(pointInRing(u.coordinates[0], 5, 6)).toBe(false);
    const c = interiorPoint(u);
    expect(pointInRing(u.coordinates[0], c.lon, c.lat)).toBe(true);
    const l: any = { type: 'Polygon', coordinates: [[[0, 0], [6, 0], [6, 1], [1, 1], [1, 6], [0, 6], [0, 0]]] };
    const d = interiorPoint(l);
    expect(pointInRing(l.coordinates[0], d.lon, d.lat)).toBe(true);
  });
});
