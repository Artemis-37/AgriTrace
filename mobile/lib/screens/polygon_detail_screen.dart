import 'package:flutter/material.dart';

import '../data/polygon_io.dart';
import '../geo/polygon.dart';
import '../geo/polygon_files.dart';
import '../main.dart';
import 'basemap_view.dart';
import 'parcel_survey_screen.dart';

const _green = Color(0xFF0B5E3B);

/// Un polygone : le producteur, la carte (intérieur jaune, contour rouge), la surface et le périmètre.
/// On peut le reprendre (nouveau tracé au GPS, envoyé à la synchronisation) ou l'exporter en KML.
class PolygonDetailScreen extends StatefulWidget {
  final Map<String, Object?> row;
  final bool canUpdate;
  const PolygonDetailScreen({super.key, required this.row, required this.canUpdate});
  @override
  State<PolygonDetailScreen> createState() => _PolygonDetailScreenState();
}

class _PolygonDetailScreenState extends State<PolygonDetailScreen> {
  late Map<String, Object?> _row = widget.row;
  String? _msg;
  bool _busy = false;

  Future<void> _reload() async {
    final all = await services.repo.polygons();
    final fresh = all.where((r) => r['id'] == _row['id']).toList();
    if (mounted && fresh.isNotEmpty) setState(() => _row = fresh.first);
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ParcelSurveyScreen(existing: _row)));
    if (saved == true) {
      services.sync.run();
      if (mounted) setState(() => _msg = "Nouveau tracé conservé sur l'appareil, envoi à la prochaine connexion.");
    }
    await _reload();
  }

  Future<void> _export() async {
    setState(() { _busy = true; _msg = null; });
    try {
      final done = await exportPolygons([_row]);
      if (mounted) setState(() => _msg = done.isEmpty ? 'Tracé illisible : export impossible.' : 'Enregistré dans Téléchargements : ${done.first}');
    } catch (_) {
      if (mounted) setState(() => _msg = "L'export a échoué : le fichier n'a pas pu être enregistré dans Téléchargements.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ring = ringFromGeometry(_row['geometry']);
    final who = '${_row['last_name'] ?? ''} ${_row['first_names'] ?? ''}'.trim().toUpperCase();
    final code = '${_row['producer_code'] ?? ''}';
    final ha = double.tryParse('${_row['geometry_area_ha'] ?? ''}') ?? (ring == null ? null : areaHa(ring));
    final pendingNew = _row['pending_create'] == 1;
    final pendingUpd = ((_row['pending_updates'] as int?) ?? 0) > 0;
    Widget box(String t) => Container(
          width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), margin: const EdgeInsets.only(bottom: 6),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)), child: Text(t));
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Polygone')),
      body: ListView(children: [
        Container(
          color: _green, padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            box(who.isEmpty ? 'Producteur inconnu' : who),
            box(code.isEmpty ? '—' : code),
            if ('${_row['code'] ?? ''}'.isNotEmpty) box('Parcelle ${_row['code']}'),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: ring == null
              ? const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Tracé illisible.')))
              : BasemapView(tiles: services.tiles, points: const [], shapes: [ring], height: 320, crosshair: false),
        ),
        if (ring != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(spacing: 18, runSpacing: 6, children: [
              _stat('Surface', ha == null ? '—' : '${ha.toStringAsFixed(2)} ha'),
              _stat('Périmètre', '${perimeterM(ring).round()} m'),
              _stat('Points', '${ring.length}'),
              if (pendingNew || pendingUpd) _stat('État', 'À envoyer'),
            ]),
          ),
        if (_msg != null) Container(margin: const EdgeInsets.all(12), padding: const EdgeInsets.all(10), color: const Color(0xFFE9EEE3), child: Text(_msg!)),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(children: [
            if (widget.canUpdate && !pendingNew)
              SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: _edit, icon: const Icon(Icons.edit_location_alt), label: const Text('Modifier le tracé'))),
            if (widget.canUpdate && pendingNew)
              const Padding(padding: EdgeInsets.only(bottom: 6), child: Text('Ce polygone attend son envoi : il pourra être modifié une fois synchronisé.', style: TextStyle(color: Colors.black54))),
            const SizedBox(height: 8),
            SizedBox(width: double.infinity, child: OutlinedButton.icon(onPressed: _busy || ring == null ? null : _export, icon: const Icon(Icons.ios_share), label: const Text('Exporter en KML (Téléchargements)'))),
          ]),
        ),
      ]),
    );
  }

  Widget _stat(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(k, style: const TextStyle(fontSize: 12, color: Colors.black54)),
        Text(v, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      ]);
}
