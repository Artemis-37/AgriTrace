import { describe, expect, it } from 'vitest';
import { latToY, lonToX, tileUrl, visibleTiles, xToLon, yToLat, zoomFor, MAX_TILES } from './tiles';

describe('tuiles Web Mercator', () => {
  it('connaît la tuile de Hiré (z10) et l\'aller-retour coordonnées ⇄ tuile', () => {
    const lon = -5.75, lat = 6.85;
    expect(Math.floor(lonToX(lon, 10))).toBe(495);
    expect(Math.floor(latToY(lat, 10))).toBe(492);
    expect(xToLon(lonToX(lon, 12), 12)).toBeCloseTo(lon, 9);
    expect(yToLat(latToY(lat, 12), 12)).toBeCloseTo(lat, 9);
  });
  it('tuile 0/0/0 : le monde entier', () => {
    expect(lonToX(-180, 0)).toBe(0); expect(lonToX(180, 0)).toBe(1);
    expect(latToY(0, 0)).toBeCloseTo(0.5, 9);
  });
  it('zoom plus fort pour une fenêtre plus petite, borné', () => {
    const big = zoomFor({ west: -6, east: -5, south: 6, north: 7 }, 900);
    const small = zoomFor({ west: -5.751, east: -5.75, south: 6.85, north: 6.851 }, 900);
    expect(small).toBeGreaterThan(big);
    expect(zoomFor({ west: 0, east: 1e-9, south: 0, north: 1e-9 }, 900)).toBe(18);
    expect(zoomFor({ west: -180, east: 180, south: -80, north: 80 }, 900)).toBeGreaterThanOrEqual(3);
  });
  it('ne demande jamais plus de tuiles que la limite et couvre la fenêtre', () => {
    for (const span of [0.0005, 0.01, 0.5, 5, 90]) {
      const b = { west: -5.8, east: -5.8 + span, south: 6.8, north: 6.8 + span };
      const t = visibleTiles(b, 1400);
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(MAX_TILES);
    }
    const b = { west: -5.7501, east: -5.7499, south: 6.8499, north: 6.8501 };
    const t = visibleTiles(b, 900);
    expect(t.some((x) => x.west <= b.west && x.east >= b.west && x.south <= b.south && x.north >= b.south)).toBe(true);
  });
  it('construit les adresses (le satellite inverse y et x)', () => {
    expect(tileUrl('plan', { z: 5, x: 3, y: 4 })).toBe('https://tile.openstreetmap.org/5/3/4.png');
    expect(tileUrl('satellite', { z: 5, x: 3, y: 4 })).toContain('/tile/5/4/3');
  });
});
