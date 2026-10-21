import { classifyPair, PairMetrics, analysePair, DEFAULT_GEO_SETTINGS as S, geometryHash, normalizeRing } from './geo-core';
import { selfIntersects, validatePolygon } from '../parcels/geo';

const sq = (lon: number, lat: number, size = 0.001): any => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]] });

describe('géométrie : doublons et chevauchements', () => {
  it('même tracé, autre point de départ et autre sens → équivalent (même empreinte)', () => {
    const a = sq(-6, 6.8);
    const b: any = { type: 'Polygon', coordinates: [[[-6, 6.801], [-5.999, 6.801], [-5.999, 6.8], [-6, 6.8], [-6, 6.801]]] };
    expect(geometryHash(a)).toBe(geometryHash(b));
    expect(analysePair(a, b, S).kind).toBe('duplicate_equivalent');
    expect(analysePair(a, JSON.parse(JSON.stringify(a)), S).kind).toBe('duplicate_identical');
  });
  it('tracés presque identiques (IoU ≥ 0,95)', () => {
    const r = analysePair(sq(-6, 6.8), sq(-6 + 0.00002, 6.8), S);
    expect(r.kind).toBe('duplicate_near');
    expect(r.iou).toBeGreaterThan(0.95);
  });
  it('chevauchement partiel avec surface et pourcentages', () => {
    const r = analysePair(sq(-6, 6.8), sq(-5.9995, 6.8), S); // moitié de décalage
    expect(r.kind).toBe('overlap_partial');
    expect(r.pct_a).toBeGreaterThan(45); expect(r.pct_a).toBeLessThan(55);
    expect(r.intersection_m2).toBeGreaterThan(5000);
  });
  it('parcelle entièrement incluse dans une autre', () => {
    const r = analysePair(sq(-6, 6.8, 0.002), sq(-5.9995, 6.8005, 0.0005), S);
    expect(r.kind).toBe('overlap_inclusion');
    expect(Math.max(r.pct_a, r.pct_b)).toBeGreaterThan(99);
  });
  it('limite commune sans surface : pas de chevauchement', () => {
    expect(analysePair(sq(-6, 6.8), sq(-5.999, 6.8), S).kind).toBeNull();
  });
  it('recouvrement négligeable sous les seuils : pas de chevauchement', () => {
    const r = analysePair(sq(-6, 6.8), sq(-5.999005, 6.8), S); // ~0,5 m de recouvrement
    expect(r.kind).toBeNull();
  });
  it('parcelles éloignées', () => expect(analysePair(sq(-6, 6.8), sq(-5, 6.8), S).kind).toBeNull());
  it('normalisation : fermeture retirée, sens horaire', () => {
    const n = normalizeRing(sq(-6, 6.8).coordinates[0]);
    expect(n.length).toBe(4);
  });
  it('polygone papillon refusé', () => {
    const bow = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];
    expect(selfIntersects(bow)).toBe(true);
    expect(validatePolygon({ type: 'Polygon', coordinates: [bow] })).toMatch(/se croise/);
    expect(validatePolygon(sq(-6, 6.8))).toBeNull();
  });
});

describe('classement des couples à partir de mesures (commun aux moteurs Node et PostGIS)', () => {
  const m = (o: Partial<PairMetrics>): PairMetrics => ({ sameRaw: false, equivalent: false, areaA_m2: 10000, areaB_m2: 10000, intersection_m2: 0, ...o });
  it('tracés équivalents : doublon identique ou équivalent selon les sommets', () => {
    expect(classifyPair(m({ equivalent: true, sameRaw: true }), S).kind).toBe('duplicate_identical');
    expect(classifyPair(m({ equivalent: true }), S).kind).toBe('duplicate_equivalent');
  });
  it('intersection nulle ou limite commune : aucune anomalie', () => {
    expect(classifyPair(m({ intersection_m2: 0 }), S).kind).toBeNull();
    expect(classifyPair(m({ intersection_m2: NaN }), S).kind).toBeNull();
  });
  it('IoU au-dessus du seuil : presque identiques', () => {
    expect(classifyPair(m({ intersection_m2: 9800 }), S).kind).toBe('duplicate_near');
  });
  it('recouvrement partiel et inclusion', () => {
    expect(classifyPair(m({ intersection_m2: 4000 }), S).kind).toBe('overlap_partial');
    expect(classifyPair(m({ areaB_m2: 1000, intersection_m2: 1000 }), S).kind).toBe('overlap_inclusion');
  });
  it('sous les seuils (25 m² ou 1 %) : pas d\'anomalie', () => {
    expect(classifyPair(m({ intersection_m2: 20 }), S).kind).toBeNull();
    expect(classifyPair(m({ areaA_m2: 1e6, areaB_m2: 1e6, intersection_m2: 5000 }), S).kind).toBeNull();
  });
  it('le moteur Node donne le même classement que les mesures qu\'il calcule lui-même', () => {
    const a = sq(-6, 6.8), b = sq(-5.9995, 6.8);
    const r = analysePair(a, b, S);
    expect(r.kind).toBe('overlap_partial');
    expect(classifyPair({ sameRaw: false, equivalent: false, areaA_m2: 12300, areaB_m2: 12300, intersection_m2: r.intersection_m2 }, S).kind).toBe('overlap_partial');
  });
});
