import 'package:flutter/material.dart';

import '../geo/polygon.dart';
import '../main.dart';
import 'basemap_view.dart';

/// Placement à la main du centre d'une parcelle : la carte glisse sous la croix de visée (la même que pour le relevé des points),
/// on valide quand la croix est où l'on veut. Le centre doit rester à l'intérieur du polygone.
class CenterPlaceScreen extends StatefulWidget {
  final List<GeoPoint> ring;
  final GeoPoint start;
  final String title;
  const CenterPlaceScreen(
      {super.key,
      required this.ring,
      required this.start,
      required this.title});
  @override
  State<CenterPlaceScreen> createState() => _CenterPlaceScreenState();
}

class _CenterPlaceScreenState extends State<CenterPlaceScreen> {
  late final ValueNotifier<GeoPoint> _aim = ValueNotifier(widget.start);

  @override
  void dispose() {
    _aim.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(children: [
        Expanded(
            child: LayoutBuilder(
                builder: (context, c) => BasemapView(
                    tiles: services.tiles,
                    points: const [],
                    shapes: [widget.ring],
                    aim: _aim,
                    height: c.maxHeight))),
        ValueListenableBuilder<GeoPoint>(
          valueListenable: _aim,
          builder: (_, g, __) {
            final inside = pointInRing(widget.ring, g.lat, g.lon);
            return Padding(
              padding: const EdgeInsets.all(12),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(
                    inside
                        ? 'La croix est dans le polygone.'
                        : 'La croix est hors du polygone : déplacez la carte.',
                    style: TextStyle(
                        color: inside
                            ? const Color(0xFF0B5E3B)
                            : Colors.red.shade700,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(
                      child: OutlinedButton.icon(
                          onPressed: () => Navigator.of(context)
                              .pop(interiorPoint(widget.ring)),
                          icon: const Icon(Icons.auto_fix_high),
                          label: const Text('Centre automatique'))),
                  const SizedBox(width: 8),
                  Expanded(
                      child: FilledButton.icon(
                          onPressed: inside
                              ? () => Navigator.of(context).pop(g)
                              : null,
                          icon: const Icon(Icons.check),
                          label: const Text('Placer ici'))),
                ]),
              ]),
            );
          },
        ),
      ]),
    );
  }
}
