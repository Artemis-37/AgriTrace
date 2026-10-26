// Tour de parcelle en continu : filtrage des mesures, retour au départ, simplification, surface.
import 'dart:math' as math;

import 'package:agritrace_mobile/geo/polygon.dart';
import 'package:agritrace_mobile/geo/track.dart';
import 'package:flutter_test/flutter_test.dart';

/// Carré de [side] mètres, parcouru à pied (un point tous les [step] m), à partir de (7.0, -5.9).
List<GeoPoint> square(double side, {double step = 2, double acc = 5}) {
  const k = math.pi / 180, r = 6371008.8;
  const lat0 = 7.0, lon0 = -5.9;
  final dLat = 1 / (r * k), dLon = 1 / (r * k * math.cos(lat0 * k));
  final out = <GeoPoint>[];
  void leg(double x0, double y0, double x1, double y1) {
    final n = (math.sqrt(math.pow(x1 - x0, 2) + math.pow(y1 - y0, 2)) / step).round();
    for (var i = 0; i < n; i++) { out.add(GeoPoint(lat0 + (y0 + (y1 - y0) * i / n) * dLat, lon0 + (x0 + (x1 - x0) * i / n) * dLon, accuracyM: acc)); }
  }
  leg(0, 0, side, 0); leg(side, 0, side, side); leg(side, side, 0, side); leg(0, side, 0, 0);
  out.add(GeoPoint(lat0, lon0, accuracyM: acc));
  return out;
}

void main() {
  test('tour d\'un carré de 100 m : environ 1 ha, retour au départ détecté', () {
    final rec = TrackRecorder();
    var t = DateTime(2026, 10, 26, 10);
    for (final p in square(100)) { rec.add(p, at: t); t = t.add(const Duration(seconds: 2)); }
    expect(rec.nearStart(), isTrue);
    expect(rec.walkedM, closeTo(400, 8));
    final simple = simplifyTrack(rec.points);
    expect(simple.length, lessThan(12)); // 4 coins + points d'extrémité
    expect(areaHa(simple), closeTo(1.0, 0.03));
  });

  test('mesures imprécises ou en saut ignorées', () {
    final rec = TrackRecorder();
    final t = DateTime(2026, 10, 26, 10);
    expect(rec.add(const GeoPoint(7.0, -5.9, accuracyM: 5), at: t), isTrue);
    expect(rec.add(const GeoPoint(7.00005, -5.9, accuracyM: 40), at: t.add(const Duration(seconds: 3))), isFalse); // trop imprécis
    expect(rec.add(const GeoPoint(7.001, -5.9, accuracyM: 5), at: t.add(const Duration(seconds: 4))), isFalse); // 110 m en 4 s : saut du GPS
    expect(rec.add(const GeoPoint(7.00005, -5.9, accuracyM: 5), at: t.add(const Duration(seconds: 10))), isTrue);
    expect(rec.ignored, 2);
  });

  test('pas de retour au départ avant d\'avoir marché', () {
    final rec = TrackRecorder();
    rec.add(const GeoPoint(7.0, -5.9, accuracyM: 5));
    expect(rec.nearStart(), isFalse);
  });

  test('simplification : une ligne droite se réduit à ses deux extrémités', () {
    final line = [for (var i = 0; i < 50; i++) GeoPoint(7.0 + i * 0.00002, -5.9, accuracyM: 4)];
    expect(simplifyTrack(line).length, 2);
  });
}
