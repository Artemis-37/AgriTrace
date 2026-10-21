import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../data/map_tiles.dart';
import '../geo/polygon.dart';
import '../geo/tiles.dart';

/// Carte hors ligne : tuiles du paquet installé sur le téléphone, tracé de la parcelle par-dessus, déplacement au doigt, zoom à deux doigts ou boutons.
/// Aucune requête réseau : une tuile absente du paquet reste simplement vide.
class BasemapView extends StatefulWidget {
  final MapTiles tiles;
  final List<GeoPoint> points;
  /// Position actuelle du technicien (point bleu), si connue.
  final GeoPoint? me;
  final double height;
  /// Autres tracés à afficher (par exemple toutes les parcelles d'un producteur), sans numérotation.
  final List<List<GeoPoint>> shapes;
  const BasemapView({super.key, required this.tiles, required this.points, this.me, this.height = 260, this.shapes = const []});
  @override
  State<BasemapView> createState() => _BasemapViewState();
}

class _BasemapViewState extends State<BasemapView> {
  double _lat = 0, _lon = 0, _zoom = 15;
  bool _placed = false;
  Size _size = Size.zero;
  double _startZoom = 15;
  final Map<String, Future<Uint8List?>> _cache = {};
  late BaseLayer _layer = widget.tiles.available(BaseLayer.pack) ? BaseLayer.pack : BaseLayer.plan;

  /// Cadre la vue sur le tracé (ou la position, ou l'étendue du paquet) tant que l'utilisateur n'a pas touché à la carte.
  void _frame({bool force = false}) {
    if (_size == Size.zero || (_placed && !force)) return;
    final pts = <({double lat, double lon})>[
      for (final g in widget.points) (lat: g.lat, lon: g.lon),
      for (final sh in widget.shapes) for (final g in sh) (lat: g.lat, lon: g.lon),
      if (widget.points.isEmpty && widget.me != null) (lat: widget.me!.lat, lon: widget.me!.lon),
    ];
    final b = _layer == BaseLayer.pack ? widget.tiles.pack.bounds : null;
    if (pts.isEmpty && b != null) {
      pts.addAll([(lat: b.s, lon: b.w), (lat: b.n, lon: b.e)]);
    }
    if (pts.isEmpty) return;
    final minLat = pts.map((e) => e.lat).reduce(math.min), maxLat = pts.map((e) => e.lat).reduce(math.max);
    final minLon = pts.map((e) => e.lon).reduce(math.min), maxLon = pts.map((e) => e.lon).reduce(math.max);
    _lat = (minLat + maxLat) / 2;
    _lon = (minLon + maxLon) / 2;
    _zoom = fitZoom(pts, _size.width, _size.height, minZoom: widget.tiles.minZoom(_layer), maxZoom: math.min(widget.tiles.maxZoom(_layer), 19)).toDouble();
    _placed = true;
  }

  @override
  void didUpdateWidget(covariant BasemapView old) {
    super.didUpdateWidget(old);
    // Premier point ajouté : on cadre dessus ; ensuite la vue reste là où l'utilisateur l'a mise.
    if (old.points.isEmpty && widget.points.isNotEmpty) { _placed = false; _frame(); }
  }

  double get _minZ => widget.tiles.minZoom(_layer).toDouble();
  double get _maxZ => widget.tiles.maxZoom(_layer) + 1.5; // on autorise un peu de sur-agrandissement

  void _zoomBy(double dz) => setState(() { _zoom = (_zoom + dz).clamp(_minZ, _maxZ); _placed = true; });

  Future<Uint8List?> _tile(int z, int x, int y) {
    if (_cache.length > 300) _cache.clear();
    return _cache.putIfAbsent('${_layer.name}/$z/$x/$y', () => widget.tiles.tile(_layer, z, x, y));
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: LayoutBuilder(builder: (context, c) {
          _size = Size(c.maxWidth, c.maxHeight);
          _frame();
          final tileZ = _zoom.round().clamp(widget.tiles.minZoom(_layer), widget.tiles.maxZoom(_layer));
          final tiles = visibleTiles(lat: _lat, lon: _lon, zoom: _zoom, tileZ: tileZ, w: _size.width, h: _size.height);
          return Stack(children: [
            Positioned.fill(child: GestureDetector(
              onScaleStart: (_) => _startZoom = _zoom,
              onScaleUpdate: (d) => setState(() {
                _placed = true;
                final oldZ = _zoom;
                _zoom = (_startZoom + math.log(d.scale) / math.ln2).clamp(_minZ, _maxZ);
                final c0 = project(_lat, _lon, _zoom);
                final moved = unproject(c0.x - d.focalPointDelta.dx, c0.y - d.focalPointDelta.dy, _zoom);
                _lat = moved.lat; _lon = moved.lon;
                if (oldZ != _zoom) _cache.removeWhere((k, _) => !k.startsWith('${_layer.name}/${_zoom.round()}/'));
              }),
              child: ColoredBox(color: const Color(0xFFE8ECE6), child: Stack(clipBehavior: Clip.hardEdge, children: [
                for (final t in tiles)
                  Positioned(
                    left: t.left, top: t.top, width: t.size + 0.5, height: t.size + 0.5,
                    child: FutureBuilder<Uint8List?>(
                      key: ValueKey('${_layer.name}/${t.z}/${t.x}/${t.y}'),
                      future: _tile(t.z, t.x, t.y),
                      builder: (_, s) => s.data == null ? const SizedBox.shrink() : Image.memory(s.data!, fit: BoxFit.fill, gaplessPlayback: true, filterQuality: FilterQuality.medium),
                    ),
                  ),
                Positioned.fill(child: CustomPaint(painter: _OverlayPainter(widget.points, widget.me, _lat, _lon, _zoom, widget.shapes))),
              ])),
            )),
            Positioned(right: 8, top: 8, child: Column(children: [
              _MapButton(icon: Icons.add, tooltip: 'Agrandir', onTap: () => _zoomBy(1)),
              const SizedBox(height: 4),
              _MapButton(icon: Icons.remove, tooltip: 'Réduire', onTap: () => _zoomBy(-1)),
              const SizedBox(height: 4),
              _MapButton(icon: Icons.center_focus_strong_outlined, tooltip: 'Recentrer', onTap: () => setState(() { _placed = false; _frame(force: true); })),
            ])),
            Positioned(left: 8, top: 8, child: Material(
              color: Colors.white, elevation: 2, borderRadius: BorderRadius.circular(6),
              child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: DropdownButtonHideUnderline(child: DropdownButton<BaseLayer>(
                value: _layer, isDense: true, style: const TextStyle(fontSize: 13, color: Colors.black87),
                items: [for (final l in BaseLayer.values) if (widget.tiles.available(l)) DropdownMenuItem(value: l, child: Text(l.label))],
                onChanged: (l) => setState(() { if (l != null) { _layer = l; _cache.clear(); _zoom = _zoom.clamp(_minZ, _maxZ); } }),
              ))),
            )),
            Positioned(left: 8, right: 52, bottom: 6, child: ValueListenableBuilder<bool>(
              valueListenable: widget.tiles.offline,
              builder: (_, off, __) => Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: Colors.white70, borderRadius: BorderRadius.circular(4)),
                child: Text(
                  _layer == BaseLayer.pack
                      ? 'Fond hors ligne : ${widget.tiles.pack.local?.name ?? ''}'
                      : '${_layer.attribution}${off ? ' · hors connexion : zones déjà consultées seulement' : ''}',
                  style: const TextStyle(fontSize: 10.5, color: Colors.black87),
                ),
              ),
            )),
          ]);
        }),
      ),
    );
  }
}

class _MapButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  const _MapButton({required this.icon, required this.tooltip, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white, elevation: 2, borderRadius: BorderRadius.circular(6),
        child: InkWell(borderRadius: BorderRadius.circular(6), onTap: onTap, child: Tooltip(message: tooltip, child: SizedBox(width: 36, height: 36, child: Icon(icon, size: 20)))),
      );
}

/// Tracé, points numérotés et position actuelle, positionnés avec la même projection que les tuiles.
class _OverlayPainter extends CustomPainter {
  final List<GeoPoint> pts;
  final GeoPoint? me;
  final double lat, lon, zoom;
  final List<List<GeoPoint>> shapes;
  _OverlayPainter(this.pts, this.me, this.lat, this.lon, this.zoom, [this.shapes = const []]);

  Offset _at(GeoPoint g, Size size) {
    final c = project(lat, lon, zoom), p = project(g.lat, g.lon, zoom);
    return Offset(size.width / 2 + (p.x - c.x), size.height / 2 + (p.y - c.y));
  }

  @override
  void paint(Canvas canvas, Size size) {
    for (final sh in shapes) {
      if (sh.length < 3) continue;
      final path = Path()..moveTo(_at(sh[0], size).dx, _at(sh[0], size).dy);
      for (var i = 1; i < sh.length; i++) { final o = _at(sh[i], size); path.lineTo(o.dx, o.dy); }
      path.close();
      canvas.drawPath(path, Paint()..color = const Color(0x442E7D32));
      canvas.drawPath(path, Paint()..color = const Color(0xFFFFEB3B)..style = PaintingStyle.stroke..strokeWidth = 4);
      canvas.drawPath(path, Paint()..color = const Color(0xFF1B5E20)..style = PaintingStyle.stroke..strokeWidth = 2);
    }
    if (pts.isNotEmpty) {
      final path = Path()..moveTo(_at(pts[0], size).dx, _at(pts[0], size).dy);
      for (var i = 1; i < pts.length; i++) {
        final o = _at(pts[i], size);
        path.lineTo(o.dx, o.dy);
      }
      if (pts.length >= 3) {
        path.close();
        canvas.drawPath(path, Paint()..color = const Color(0x442E7D32));
      }
      canvas.drawPath(path, Paint()..color = const Color(0xFFFFEB3B)..style = PaintingStyle.stroke..strokeWidth = 4);
      canvas.drawPath(path, Paint()..color = const Color(0xFF1B5E20)..style = PaintingStyle.stroke..strokeWidth = 2);
      for (var i = 0; i < pts.length; i++) {
        final o = _at(pts[i], size);
        canvas.drawCircle(o, 7, Paint()..color = Colors.white);
        canvas.drawCircle(o, 5, Paint()..color = i == 0 ? const Color(0xFF1B5E20) : const Color(0xFF6D4C41));
        final tp = TextPainter(
          text: TextSpan(text: '${i + 1}', style: const TextStyle(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w800, shadows: [Shadow(blurRadius: 3, color: Colors.black)])),
          textDirection: TextDirection.ltr,
        )..layout();
        tp.paint(canvas, o + const Offset(8, -18));
      }
    }
    if (me != null) {
      final o = _at(me!, size);
      if (me!.accuracyM != null) {
        final mPerPx = 156543.03392 * math.cos(me!.lat * math.pi / 180) / math.pow(2, zoom);
        canvas.drawCircle(o, math.max(8, me!.accuracyM! / mPerPx), Paint()..color = const Color(0x221976D2));
      }
      canvas.drawCircle(o, 8, Paint()..color = Colors.white);
      canvas.drawCircle(o, 6, Paint()..color = const Color(0xFF1976D2));
    }
  }

  @override
  bool shouldRepaint(covariant _OverlayPainter old) => true;
}
