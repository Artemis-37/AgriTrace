import 'package:agritrace_mobile/geo/tiles.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Greenwich, équateur : centre du monde', () {
    final p = project(0, 0, 0);
    expect(p.x, closeTo(128, 1e-9));
    expect(p.y, closeTo(128, 1e-9));
  });

  test('projection puis retour : on retrouve la position (Hiré)', () {
    final p = project(6.0833, -5.2833, 17);
    final b = unproject(p.x, p.y, 17);
    expect(b.lat, closeTo(6.0833, 1e-9));
    expect(b.lon, closeTo(-5.2833, 1e-9));
  });

  test('tuile connue : Paris (48.8566, 2.3522) au zoom 10 est la tuile 518/352', () {
    final p = project(48.8566, 2.3522, 10);
    expect((p.x / tileSize).floor(), 518);
    expect((p.y / tileSize).floor(), 352);
  });

  test('ligne MBTiles : axe vertical inversé', () {
    expect(tmsRow(0, 0), 0);
    expect(tmsRow(352, 10), 671);
    expect(tmsRow(0, 3), 7);
  });

  test('le zoom ajusté fait tenir un champ d\'un hectare dans la vue', () {
    final pts = [(lat: 6.0833, lon: -5.2833), (lat: 6.0842, lon: -5.2824)];
    final z = fitZoom(pts, 360, 240);
    for (final p in pts) {
      expect(project(p.lat, p.lon, z.toDouble()).x - project(pts[0].lat, pts[0].lon, z.toDouble()).x, lessThan(360 - 48));
    }
    expect(z, greaterThan(15));
    // Un zoom de plus ne tiendrait plus.
    final a = project(pts[0].lat, pts[0].lon, z + 1.0), b = project(pts[1].lat, pts[1].lon, z + 1.0);
    expect((b.x - a.x).abs() > 360 - 48 || (b.y - a.y).abs() > 240 - 48, isTrue);
  });

  test('tuiles visibles : couvrent toute la vue, sans doublon, à la bonne échelle', () {
    final t = visibleTiles(lat: 6.0833, lon: -5.2833, zoom: 16.5, tileZ: 16, w: 360, h: 240);
    expect(t, isNotEmpty);
    expect(t.map((e) => '${e.x}/${e.y}').toSet().length, t.length);
    final s = t.first.size;
    expect(s, closeTo(256 * 1.4142135, 1e-3));
    expect(t.map((e) => e.left).reduce((a, b) => a < b ? a : b), lessThanOrEqualTo(0));
    expect(t.map((e) => e.left + e.size).reduce((a, b) => a > b ? a : b), greaterThanOrEqualTo(360));
    expect(t.map((e) => e.top).reduce((a, b) => a < b ? a : b), lessThanOrEqualTo(0));
    expect(t.map((e) => e.top + e.size).reduce((a, b) => a > b ? a : b), greaterThanOrEqualTo(240));
  });

  test('le centre de la vue tombe au milieu de l\'écran', () {
    final t = visibleTiles(lat: 6.0833, lon: -5.2833, zoom: 16, tileZ: 16, w: 300, h: 200);
    final c = project(6.0833, -5.2833, 16);
    final host = t.firstWhere((e) => (c.x / tileSize).floor() == e.x && (c.y / tileSize).floor() == e.y);
    expect(host.left + (c.x - host.x * tileSize), closeTo(150, 1e-6));
    expect(host.top + (c.y - host.y * tileSize), closeTo(100, 1e-6));
  });
}
