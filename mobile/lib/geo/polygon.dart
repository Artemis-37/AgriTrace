import 'dart:math' as math;

/// Point GPS relevé (WGS84).
class GeoPoint {
  final double lat, lon;
  final double? accuracyM;
  const GeoPoint(this.lat, this.lon, {this.accuracyM});
}

/// Anneau fermé GeoJSON [[lon, lat], …] : le premier point est répété à la fin.
List<List<double>> closedRing(List<GeoPoint> pts) {
  final ring = pts.map((p) => [p.lon, p.lat]).toList();
  if (ring.isNotEmpty) ring.add([ring.first[0], ring.first[1]]);
  return ring;
}

/// Surface en hectares : même méthode que le serveur (projection équirectangulaire locale + formule de l'arpenteur),
/// pour que la surface affichée sur le terrain soit celle que le serveur calculera.
double areaHa(List<GeoPoint> pts) {
  if (pts.length < 3) return 0;
  final ring = closedRing(pts);
  final lat0 = ring.fold<double>(0, (s, p) => s + p[1]) / ring.length;
  const r = 6371008.8, k = math.pi / 180;
  final xy = ring.map((p) => [r * p[0] * k * math.cos(lat0 * k), r * p[1] * k]).toList();
  var s = 0.0;
  for (var i = 0; i < xy.length - 1; i++) {
    s += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
  }
  return s.abs() / 2 / 10000;
}

/// Distance en mètres entre deux points (haversine).
double distanceM(GeoPoint a, GeoPoint b) {
  const r = 6371008.8, k = math.pi / 180;
  final dLat = (b.lat - a.lat) * k, dLon = (b.lon - a.lon) * k;
  final h = math.pow(math.sin(dLat / 2), 2) + math.cos(a.lat * k) * math.cos(b.lat * k) * math.pow(math.sin(dLon / 2), 2);
  return 2 * r * math.asin(math.sqrt(h));
}

/// Périmètre du tracé fermé, en mètres.
double perimeterM(List<GeoPoint> pts) {
  if (pts.length < 2) return 0;
  var s = 0.0;
  for (var i = 0; i < pts.length; i++) {
    s += distanceM(pts[i], pts[(i + 1) % pts.length]);
  }
  return s;
}

/// Vrai si deux côtés non adjacents se croisent (tracé en « papillon »).
bool selfIntersects(List<GeoPoint> pts) {
  final ring = closedRing(pts);
  final n = ring.length - 1;
  double ccw(List<double> a, List<double> b, List<double> c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  bool cross(List<double> a, List<double> b, List<double> c, List<double> d) {
    final d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  for (var i = 0; i < n; i++) {
    for (var j = i + 2; j < n; j++) {
      if (i == 0 && j == n - 1) continue;
      if (cross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

/// Message d'erreur si le tracé ne peut pas être enregistré, sinon null.
String? validateTrace(List<GeoPoint> pts) {
  if (pts.length < 3) return 'Au moins 3 points sont nécessaires pour fermer la parcelle.';
  if (pts.length > 999) return '1000 sommets maximum.';
  if (selfIntersects(pts)) return "Le tracé se croise lui-même : annulez le dernier point ou recommencez.";
  if (areaHa(pts) <= 0) return 'Surface nulle : les points sont alignés ou identiques.';
  return null;
}

/// GeoJSON Polygon à envoyer au serveur.
Map<String, Object> toGeoJson(List<GeoPoint> pts) => {'type': 'Polygon', 'coordinates': [closedRing(pts)]};

/// Écart relatif (%) entre la surface déclarée et la surface mesurée.
double gapPct(double declared, double measured) => declared <= 0 ? 0 : (declared - measured).abs() / declared * 100;
