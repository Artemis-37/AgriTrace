import 'dart:math' as math;

import 'polygon.dart';

/// Enregistrement continu du tour d'une parcelle (comme la fonction « calcul de surface » d'un GPS de randonnée) :
/// on marche le long de la limite, le téléphone retient des points réguliers et bien précis, puis le tracé est simplifié et fermé.
class TrackRecorder {
  /// Précision minimale acceptée pour retenir un point (mètres) : au-delà, la mesure est ignorée.
  final double maxAccuracyM;
  /// Distance minimale entre deux points retenus (mètres), relevée si la précision est médiocre.
  final double minStepM;
  /// Vitesse maximale plausible à pied (m/s) : un saut plus rapide est une erreur du GPS.
  final double maxSpeedMs;

  TrackRecorder({this.maxAccuracyM = 15, this.minStepM = 3, this.maxSpeedMs = 8});

  final List<GeoPoint> points = [];
  final List<DateTime> _times = [];
  int ignored = 0;
  double walkedM = 0;

  /// Ajoute une mesure ; renvoie vrai si elle est retenue.
  bool add(GeoPoint p, {DateTime? at}) {
    final t = at ?? DateTime.now();
    if ((p.accuracyM ?? 0) > maxAccuracyM) { ignored++; return false; }
    if (points.isNotEmpty) {
      final last = points.last;
      final d = distanceM(last, p);
      final step = math.max(minStepM, (p.accuracyM ?? 0) * 0.5);
      if (d < step) return false;
      final dt = t.difference(_times.last).inMilliseconds / 1000;
      if (dt > 0 && d / dt > maxSpeedMs) { ignored++; return false; }
      walkedM += d;
    }
    points.add(p);
    _times.add(t);
    return true;
  }

  /// Retour au point de départ : au moins 30 m parcourus, 8 points, et position actuelle à moins de [radiusM] du premier point.
  bool nearStart({double radiusM = 8}) => points.length >= 8 && walkedM >= 30 && distanceM(points.first, points.last) <= radiusM;

  /// Surface estimée avec les points déjà relevés (le tracé se ferme tout seul).
  double get areaHaNow => areaHa(points);

  void reset() { points.clear(); _times.clear(); ignored = 0; walkedM = 0; }
}

/// Simplification de Douglas-Peucker : retire les points qui s'écartent de moins de [toleranceM] mètres de la droite, pour garder un tracé léger.
List<GeoPoint> simplifyTrack(List<GeoPoint> pts, {double toleranceM = 1.5, int maxPoints = 200}) {
  if (pts.length < 4) return List.of(pts);
  var tol = toleranceM;
  var out = _dp(pts, tol);
  while (out.length > maxPoints && tol < 50) { tol *= 1.5; out = _dp(pts, tol); }
  return out;
}

List<GeoPoint> _dp(List<GeoPoint> pts, double tol) {
  // Projection locale en mètres.
  final lat0 = pts.fold<double>(0, (s, p) => s + p.lat) / pts.length;
  const r = 6371008.8, k = math.pi / 180;
  final xy = [for (final p in pts) [r * p.lon * k * math.cos(lat0 * k), r * p.lat * k]];
  final keep = List<bool>.filled(pts.length, false)..[0] = true..[pts.length - 1] = true;
  void rec(int a, int b) {
    if (b <= a + 1) return;
    var maxD = 0.0, idx = -1;
    final ax = xy[a][0], ay = xy[a][1], bx = xy[b][0], by = xy[b][1];
    final dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (var i = a + 1; i < b; i++) {
      final t = len2 == 0 ? 0.0 : (((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2).clamp(0.0, 1.0);
      final px = ax + t * dx, py = ay + t * dy;
      final d = math.sqrt(math.pow(xy[i][0] - px, 2) + math.pow(xy[i][1] - py, 2));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx >= 0) { keep[idx] = true; rec(a, idx); rec(idx, b); }
  }
  rec(0, pts.length - 1);
  return [for (var i = 0; i < pts.length; i++) if (keep[i]) pts[i]];
}
