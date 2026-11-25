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

/// Vrai si le point est dans l'anneau (lancer de rayon) ; un point sur le bord compte comme dedans.
bool pointInRing(List<GeoPoint> ring, double lat, double lon) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    final xi = ring[i].lon, yi = ring[i].lat, xj = ring[j].lon, yj = ring[j].lat;
    final cross = (lon - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (cross == 0 && lon >= math.min(xi, xj) && lon <= math.max(xi, xj) && lat >= math.min(yi, yj) && lat <= math.max(yi, yj)) return true;
    if ((yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

double _distSeg(double px, double py, double ax, double ay, double bx, double by) {
  final dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  final t = l2 == 0 ? 0.0 : (((px - ax) * dx + (py - ay) * dy) / l2).clamp(0.0, 1.0);
  return math.sqrt(math.pow(px - (ax + t * dx), 2) + math.pow(py - (ay + t * dy), 2));
}

/// « Centroïde » de la parcelle, toujours DANS le polygone (même calcul que le serveur) : le centre de gravité s'il y tombe ;
/// sinon (parcelle en L, en U, en croissant) le point intérieur le plus éloigné des bords.
GeoPoint interiorPoint(List<GeoPoint> ring) {
  final lat0 = ring.fold<double>(0, (s, p) => s + p.lat) / ring.length;
  final kx = math.cos(lat0 * math.pi / 180);
  double a = 0, cx = 0, cy = 0;
  for (var i = 0; i < ring.length; i++) {
    final q = ring[(i + 1) % ring.length];
    final x0 = ring[i].lon * kx, y0 = ring[i].lat, x1 = q.lon * kx, y1 = q.lat, f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a != 0) {
    final lon = cx / (3 * a) / kx, lat = cy / (3 * a);
    if (pointInRing(ring, lat, lon)) return GeoPoint(lat, lon);
  }
  var x0 = ring.map((p) => p.lon).reduce(math.min), x1 = ring.map((p) => p.lon).reduce(math.max);
  var y0 = ring.map((p) => p.lat).reduce(math.min), y1 = ring.map((p) => p.lat).reduce(math.max);
  var best = GeoPoint(ring[0].lat, ring[0].lon);
  var bestD = -1.0;
  for (var pass = 0; pass < 4; pass++) {
    const n = 24;
    final sx = (x1 - x0) / n, sy = (y1 - y0) / n;
    for (var i = 0; i <= n; i++) {
      for (var j = 0; j <= n; j++) {
        final lon = x0 + i * sx, lat = y0 + j * sy;
        if (!pointInRing(ring, lat, lon)) continue;
        var d = double.infinity;
        for (var k = 0; k < ring.length; k++) {
          final q = ring[(k + 1) % ring.length];
          d = math.min(d, _distSeg(lon * kx, lat, ring[k].lon * kx, ring[k].lat, q.lon * kx, q.lat));
        }
        if (d > bestD) { bestD = d; best = GeoPoint(lat, lon); }
      }
    }
    if (bestD < 0) break;
    x0 = best.lon - 2 * sx; x1 = best.lon + 2 * sx; y0 = best.lat - 2 * sy; y1 = best.lat + 2 * sy;
  }
  return best;
}

/// Centre d'une parcelle : celui enregistré s'il est dans le tracé, sinon le point intérieur calculé.
GeoPoint centerOf(List<GeoPoint> ring, {Object? lat, Object? lon}) {
  final la = double.tryParse('${lat ?? ''}'), lo = double.tryParse('${lon ?? ''}');
  if (la != null && lo != null && pointInRing(ring, la, lo)) return GeoPoint(la, lo);
  return interiorPoint(ring);
}
