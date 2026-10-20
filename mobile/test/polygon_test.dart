import 'package:agritrace_mobile/geo/polygon.dart';
import 'package:flutter_test/flutter_test.dart';

List<GeoPoint> square(double lon, double lat, double d) =>
    [GeoPoint(lat, lon), GeoPoint(lat, lon + d), GeoPoint(lat + d, lon + d), GeoPoint(lat + d, lon)];

void main() {
  test('carré de 0,0009° vers Hiré : environ 1 ha, comme le calcule le serveur', () {
    final a = areaHa(square(-4.2, 5.5, 0.0009));
    expect(a, greaterThan(0.95));
    expect(a, lessThan(1.05));
  });

  test("l'anneau GeoJSON est fermé et en ordre longitude, latitude", () {
    final g = toGeoJson(square(-4.2, 5.5, 0.001));
    final ring = ((g['coordinates'] as List).first as List).cast<List<double>>();
    expect(ring.length, 5);
    expect(ring.first, ring.last);
    expect(ring.first, [-4.2, 5.5]);
  });

  test('le périmètre d\'un carré de 100 m de côté est proche de 400 m', () {
    final p = perimeterM(square(-4.2, 5.5, 0.0009));
    expect(p, greaterThan(380));
    expect(p, lessThan(420));
  });

  test('un tracé en papillon est refusé', () {
    final bow = [const GeoPoint(5.5, -4.2), const GeoPoint(5.501, -4.199), const GeoPoint(5.5, -4.199), const GeoPoint(5.501, -4.2)];
    expect(selfIntersects(bow), isTrue);
    expect(validateTrace(bow), contains('se croise'));
  });

  test('moins de 3 points ou points alignés : refusé ; carré : accepté', () {
    expect(validateTrace([const GeoPoint(5.5, -4.2), const GeoPoint(5.5, -4.19)]), isNotNull);
    expect(validateTrace([const GeoPoint(5.5, -4.2), const GeoPoint(5.5, -4.19), const GeoPoint(5.5, -4.18)]), contains('Surface nulle'));
    expect(validateTrace(square(-4.2, 5.5, 0.0009)), isNull);
  });

  test('écart entre surface déclarée et mesurée', () {
    expect(gapPct(1.0, 1.25), closeTo(25, 1e-9));
    expect(gapPct(0, 1), 0);
  });
}
