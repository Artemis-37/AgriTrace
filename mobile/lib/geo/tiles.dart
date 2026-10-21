import 'dart:math' as math;

/// Calculs de tuiles « Web Mercator » (schéma XYZ, tuiles de 256 px) : pur Dart, sans dépendance, testable hors téléphone.
const tileSize = 256.0;
const maxLat = 85.0511287798;

/// Taille du monde en pixels au niveau de zoom [zoom] (peut être fractionnaire).
double worldPx(double zoom) => tileSize * math.pow(2, zoom);

/// Position en pixels du monde (origine en haut à gauche, x vers l'est, y vers le sud).
({double x, double y}) project(double lat, double lon, double zoom) {
  final la = lat.clamp(-maxLat, maxLat) * math.pi / 180;
  final ws = worldPx(zoom);
  return (x: (lon + 180) / 360 * ws, y: (1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * ws);
}

({double lat, double lon}) unproject(double x, double y, double zoom) {
  final ws = worldPx(zoom);
  final n = math.pi * (1 - 2 * y / ws);
  return (lat: 180 / math.pi * math.atan((math.exp(n) - math.exp(-n)) / 2), lon: x / ws * 360 - 180);
}

/// MBTiles numérote les lignes depuis le sud (schéma TMS) : on retourne l'axe vertical.
int tmsRow(int y, int z) => (1 << z) - 1 - y;

/// Plus fort zoom entier (borné par [minZoom], [maxZoom]) pour lequel tous les points tiennent dans une zone de [w] × [h] pixels avec [pad] de marge.
int fitZoom(List<({double lat, double lon})> pts, double w, double h, {double pad = 24, int minZoom = 0, int maxZoom = 22}) {
  if (pts.length < 2) return maxZoom;
  for (var z = maxZoom; z > minZoom; z--) {
    final ps = pts.map((p) => project(p.lat, p.lon, z.toDouble())).toList();
    final xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    if (xs.reduce(math.max) - xs.reduce(math.min) <= w - 2 * pad && ys.reduce(math.max) - ys.reduce(math.min) <= h - 2 * pad) return z;
  }
  return minZoom;
}

/// Tuile du paquet à dessiner et sa place à l'écran.
class TilePlacement {
  final int z, x, y;
  final double left, top, size;
  const TilePlacement(this.z, this.x, this.y, this.left, this.top, this.size);
}

/// Tuiles nécessaires pour couvrir une vue de [w] × [h] pixels centrée sur ([lat], [lon]) au zoom (éventuellement fractionnaire) [zoom].
/// Les tuiles sont prises au zoom entier [tileZ] et agrandies ou réduites pour atteindre [zoom].
List<TilePlacement> visibleTiles({required double lat, required double lon, required double zoom, required int tileZ, required double w, required double h}) {
  final c = project(lat, lon, tileZ.toDouble());
  final scale = math.pow(2, zoom - tileZ).toDouble();
  final size = tileSize * scale;
  final n = 1 << tileZ;
  // Coin haut-gauche de la vue, exprimé en pixels de tuile au zoom tileZ.
  final x0 = c.x - w / 2 / scale, y0 = c.y - h / 2 / scale;
  final x1 = c.x + w / 2 / scale, y1 = c.y + h / 2 / scale;
  final out = <TilePlacement>[];
  for (var ty = (y0 / tileSize).floor(); ty <= (y1 / tileSize).floor(); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (var tx = (x0 / tileSize).floor(); tx <= (x1 / tileSize).floor(); tx++) {
      final wrapped = ((tx % n) + n) % n;
      out.add(TilePlacement(tileZ, wrapped, ty, (tx * tileSize - x0) * scale, (ty * tileSize - y0) * scale, size));
    }
  }
  return out;
}
