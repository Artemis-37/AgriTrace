import 'package:flutter/material.dart';

import '../geo/polygon.dart';
import '../main.dart';
import 'basemap_view.dart';
import 'map_pack_screen.dart';

/// Carte d'un producteur : fond de carte (hors ligne si le paquet est installé) et tracé de ses parcelles.
/// Le fond de carte ne s'affiche qu'à partir de la fiche du producteur.
class ProducerMapScreen extends StatelessWidget {
  final String producerName;
  final List<List<GeoPoint>> shapes;
  const ProducerMapScreen({super.key, required this.producerName, required this.shapes});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(producerName.isEmpty ? 'Carte' : producerName), actions: [
        IconButton(tooltip: 'Fond de carte hors ligne', icon: const Icon(Icons.layers_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MapPackScreen()))),
      ]),
      body: LayoutBuilder(builder: (context, c) => Column(children: [
        Expanded(child: BasemapView(tiles: services.tiles, points: const [], shapes: shapes, height: c.maxHeight - 40)),
        Padding(padding: const EdgeInsets.all(10), child: Text(
          shapes.isEmpty ? 'Aucune parcelle relevée pour ce producteur.' : '${shapes.length} parcelle(s) tracée(s).', style: const TextStyle(color: Colors.black54))),
      ])),
    );
  }
}
