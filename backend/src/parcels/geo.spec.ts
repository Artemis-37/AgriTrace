import { areaGapPct, centroid, polygonAreaHa, validatePolygon } from './geo';

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
});
