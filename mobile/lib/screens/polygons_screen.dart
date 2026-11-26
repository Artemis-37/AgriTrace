import 'package:flutter/material.dart';

import '../data/polygon_io.dart';
import '../geo/polygon.dart';
import '../geo/polygon_files.dart';
import '../main.dart';
import '../sync/sync_state.dart';
import 'download_screen.dart';
import 'map_pack_screen.dart';
import 'polygon_detail_screen.dart';

const _green = Color(0xFF0B5E3B);

/// « Polygones » : la liste des polygones de tous les producteurs, comme la liste des chemins de l'outil GPS Waypoint.
/// On ouvre un polygone pour le voir sur la carte et le reprendre ; on importe un ou plusieurs fichiers (KML, KMZ, GPX, GeoJSON)
/// et on exporte en KML « polygone plein » (intérieur jaune, contour rouge), un fichier par parcelle.
class PolygonsScreen extends StatefulWidget {
  const PolygonsScreen({super.key});
  @override
  State<PolygonsScreen> createState() => _PolygonsScreenState();
}

class _PolygonsScreenState extends State<PolygonsScreen> {
  List<Map<String, Object?>> _rows = [];
  String _q = '';
  bool _canCreate = false, _canUpdate = false, _busy = false, _selecting = false;
  final Set<String> _selected = {};
  String? _msg;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await services.repo.polygons(q: _q);
    final perms = await services.repo.permissions();
    if (!mounted) return;
    setState(() {
      _rows = rows;
      _canCreate = canSurveyParcel(perms);
      _canUpdate = canUpdateParcel(perms);
      _selected.removeWhere((id) => !rows.any((r) => r['id'] == id));
    });
  }

  String _title(Map<String, Object?> r) {
    final who = '${r['last_name'] ?? ''} ${r['first_names'] ?? ''}'.trim().toUpperCase();
    final code = '${r['producer_code'] ?? ''}'.trim();
    return [if (code.isNotEmpty) code, if (who.isNotEmpty) who].join('  ·  ').isEmpty ? 'Producteur inconnu' : [if (code.isNotEmpty) code, if (who.isNotEmpty) who].join('  ·  ');
  }

  String _sub(Map<String, Object?> r) {
    final ring = ringFromGeometry(r['geometry']);
    final ha = double.tryParse('${r['geometry_area_ha'] ?? ''}') ?? (ring == null ? null : areaHa(ring));
    return [
      if ('${r['code'] ?? ''}'.isNotEmpty) 'Parcelle ${r['code']}',
      if (ha != null) '${ha.toStringAsFixed(2)} ha',
      if (ring != null) '${ring.length} points',
    ].join('  ·  ');
  }

  Future<void> _open(Map<String, Object?> r) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PolygonDetailScreen(row: r, canUpdate: _canUpdate)));
    await _load();
  }

  Future<void> _export(List<Map<String, Object?>> rows) async {
    if (rows.isEmpty) {
      setState(() => _msg = 'Choisissez au moins un polygone à exporter.');
      return;
    }
    setState(() { _busy = true; _msg = null; });
    try {
      final done = await exportPolygons(rows);
      if (mounted) setState(() { _msg = done.isEmpty ? 'Aucun polygone exportable (tracés illisibles).' : done.length == 1 ? 'Enregistré dans Téléchargements : ${done.first}' : '${done.length} fichiers KML enregistrés dans Téléchargements (dernier : ${done.last}).'; _selecting = false; _selected.clear(); });
    } catch (_) {
      if (mounted) setState(() => _msg = "L'export a échoué : le fichier n'a pas pu être enregistré dans Téléchargements.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _import() async {
    if (!_canCreate) {
      setState(() => _msg = "Votre profil ne permet pas d'enregistrer des parcelles.");
      return;
    }
    final files = await pickPolygonFiles();
    if (files == null || !mounted) return;
    setState(() { _busy = true; _msg = null; });
    try {
      final producers = await services.repo.allProducers();
      final existing = await services.repo.polygons();
      final plan = <_Planned>[];
      for (final f in files) {
        if (f.error != null) { plan.add(_Planned(f.name, null, null, error: f.error)); continue; }
        Map<String, Object?>? fileProducer; // choisi à la main pour tout un fichier dont le producteur n'est pas reconnu
        for (final poly in f.polygons) {
          var prod = resolveProducer(f.name, poly, producers);
          if (prod == null && fileProducer == null && mounted) {
            fileProducer = await showDialog<Map<String, Object?>>(context: context, builder: (_) => _ProducerPicker(fileName: f.name));
            if (fileProducer == null) { // annulé : les polygones restent « non rattachés »
              plan.add(_Planned(f.name, poly, null, error: 'Producteur non reconnu : polygone ignoré.'));
              continue;
            }
          }
          prod ??= fileProducer;
          if (prod == null) { plan.add(_Planned(f.name, poly, null, error: 'Producteur non reconnu : polygone ignoré.')); continue; }
          final problem = polygonProblem(poly.points);
          final own = existing.where((e) => e['producer_id'] == prod!['id'] && e['pending_create'] == 0).toList();
          plan.add(_Planned(f.name, poly, prod, error: problem, existingId: own.length == 1 ? own.first['id'] as String : null));
        }
      }
      if (!mounted) return;
      final ok = plan.where((x) => x.error == null).toList();
      final replace = await showDialog<_ImportChoice>(context: context, builder: (_) => _ImportPreview(plan: plan, canReplace: _canUpdate));
      if (replace == null || !mounted || ok.isEmpty) return;
      var created = 0, replaced = 0, failed = 0;
      for (final x in ok) {
        final area = areaHa(x.poly!.points).toStringAsFixed(4);
        final geometry = toGeoJson(x.poly!.points);
        final producerId = x.producer!['id'] as String;
        try {
          if (replace.replaceSingle && x.existingId != null) {
            await services.repo.queueParcelUpdate(parcelId: x.existingId!, declaredAreaHa: area, geometry: geometry);
            replaced++;
          } else {
            final chain = await services.repo.defaultChainId(producerId);
            if (chain == null) { failed++; continue; }
            await services.repo.queueParcel(producerId: producerId, valueChainId: chain, declaredAreaHa: area, geometry: geometry);
            created++;
          }
        } catch (_) {
          failed++;
        }
      }
      services.sync.run();
      await _load();
      if (mounted) {
        final parts = [
          if (created > 0) '$created polygone(s) ajouté(s)',
          if (replaced > 0) '$replaced tracé(s) remplacé(s)',
          if (failed > 0) '$failed refusé(s) (aucune filière)',
          if (plan.length - ok.length > 0) '${plan.length - ok.length} ignoré(s)',
        ];
        setState(() => _msg = '${parts.join(' · ')}. Envoi à la prochaine connexion.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sel = _rows.where((r) => _selected.contains(r['id'])).toList();
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(
        title: Text(_selecting ? '${sel.length} sélectionné(s)' : 'Polygones'),
        leading: _selecting ? IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() { _selecting = false; _selected.clear(); })) : null,
        actions: _selecting
            ? [
                IconButton(tooltip: 'Tout sélectionner', icon: const Icon(Icons.select_all), onPressed: () => setState(() => _selected..clear()..addAll(_rows.map((r) => r['id'] as String)))),
                IconButton(tooltip: 'Exporter la sélection', icon: const Icon(Icons.ios_share), onPressed: _busy ? null : () => _export(sel)),
              ]
            : [
                IconButton(tooltip: 'Importer', icon: const Icon(Icons.file_download_outlined), onPressed: _busy ? null : _import),
                IconButton(tooltip: 'Exporter', icon: const Icon(Icons.ios_share), onPressed: _busy || _rows.isEmpty ? null : () => setState(() => _selecting = true)),
                PopupMenuButton<String>(
                  onSelected: (v) {
                    final page = v == 'sync' ? const DownloadScreen() : const MapPackScreen();
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'sync', child: Text('Télécharger les données')),
                    PopupMenuItem(value: 'map', child: Text('Fond de carte hors ligne')),
                  ],
                ),
              ],
      ),
      body: Column(children: [
        Container(
          color: _green, padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Producteur, code ou parcelle', filled: true, fillColor: Colors.white, isDense: true,
              suffixIcon: const Icon(Icons.search), border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none)),
            onChanged: (v) { _q = v; _load(); },
          ),
        ),
        if (_busy) const LinearProgressIndicator(),
        if (_msg != null) Container(width: double.infinity, color: const Color(0xFFE9EEE3), padding: const EdgeInsets.all(10), child: Text(_msg!)),
        Expanded(
          child: _rows.isEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(
                  _q.isEmpty ? 'Aucun polygone sur ce téléphone.\nSynchronisez pour charger ceux des producteurs, ou importez un fichier.' : 'Aucun polygone ne correspond.',
                  textAlign: TextAlign.center)))
              : ListView.separated(
                  itemCount: _rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final r = _rows[i];
                    final id = r['id'] as String;
                    final ring = ringFromGeometry(r['geometry']);
                    final pending = r['pending_create'] == 1 || ((r['pending_updates'] as int?) ?? 0) > 0;
                    return Material(
                      color: _selected.contains(id) ? const Color(0xFFE3EDB8) : Colors.white,
                      child: ListTile(
                        leading: SizedBox(width: 48, height: 48, child: CustomPaint(painter: _ThumbPainter(ring, ring == null ? null : centerOf(ring, lat: r['latitude'], lon: r['longitude'])))),
                        title: Text(_title(r), style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(_sub(r)),
                        trailing: _selecting
                            ? Checkbox(value: _selected.contains(id), onChanged: (_) => _toggle(id))
                            : pending ? const Tooltip(message: "À envoyer à la prochaine connexion", child: Icon(Icons.cloud_upload_outlined, color: Colors.orange)) : const Icon(Icons.chevron_right),
                        onTap: _selecting ? () => _toggle(id) : () => _open(r),
                        onLongPress: () => setState(() { _selecting = true; _selected.add(id); }),
                      ),
                    );
                  }),
        ),
      ]),
    );
  }

  void _toggle(String id) => setState(() { if (!_selected.remove(id)) _selected.add(id); });
}

/// Ce que l'import va faire d'un polygone lu.
class _Planned {
  final String file;
  final ImportedPolygon? poly;
  final Map<String, Object?>? producer;
  final String? error;
  final String? existingId; // parcelle unique déjà connue du producteur (remplaçable)
  const _Planned(this.file, this.poly, this.producer, {this.error, this.existingId});
}

class _ImportChoice {
  final bool replaceSingle;
  const _ImportChoice(this.replaceSingle);
}

/// Aperçu avant enregistrement : ce qui sera ajouté, ce qui sera ignoré et pourquoi.
class _ImportPreview extends StatefulWidget {
  final List<_Planned> plan;
  final bool canReplace;
  const _ImportPreview({required this.plan, required this.canReplace});
  @override
  State<_ImportPreview> createState() => _ImportPreviewState();
}

class _ImportPreviewState extends State<_ImportPreview> {
  bool _replace = false;

  @override
  Widget build(BuildContext context) {
    final ok = widget.plan.where((x) => x.error == null).toList();
    final replaceable = widget.canReplace && ok.any((x) => x.existingId != null);
    return AlertDialog(
      title: Text(ok.isEmpty ? 'Rien à importer' : '${ok.length} polygone(s) à importer'),
      content: SizedBox(width: double.maxFinite, child: ListView(shrinkWrap: true, children: [
        for (final x in widget.plan)
          ListTile(
            dense: true, contentPadding: EdgeInsets.zero,
            leading: Icon(x.error == null ? Icons.check_circle : Icons.error_outline, color: x.error == null ? _green : Colors.red.shade700),
            title: Text(x.producer == null ? x.file : '${x.producer!['internal_code'] ?? ''}  ${x.producer!['last_name'] ?? ''} ${x.producer!['first_names'] ?? ''}'.trim()),
            subtitle: Text(x.error ?? '${x.poly!.name} · ${areaHa(x.poly!.points).toStringAsFixed(2)} ha · ${x.poly!.points.length} points'
                '${x.existingId != null ? ' · le producteur a déjà une parcelle' : ''}'),
          ),
        if (replaceable)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero, value: _replace, onChanged: (v) => setState(() => _replace = v ?? false),
            title: const Text('Remplacer le tracé existant', style: TextStyle(fontSize: 14)),
            subtitle: const Text("Pour les producteurs qui n'ont qu'une parcelle ; sinon une nouvelle parcelle est ajoutée.", style: TextStyle(fontSize: 12)),
          ),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
        if (ok.isNotEmpty) FilledButton(onPressed: () => Navigator.pop(context, _ImportChoice(_replace)), child: const Text('Importer')),
      ],
    );
  }
}

/// Choix d'un producteur quand le fichier ne dit pas à qui appartient le polygone.
class _ProducerPicker extends StatefulWidget {
  final String fileName;
  const _ProducerPicker({required this.fileName});
  @override
  State<_ProducerPicker> createState() => _ProducerPickerState();
}

class _ProducerPickerState extends State<_ProducerPicker> {
  List<Map<String, Object?>> _rows = [];
  @override
  void initState() { super.initState(); _find(''); }
  Future<void> _find(String q) async {
    final r = await services.repo.searchProducers(q, limit: 40);
    if (mounted) setState(() => _rows = r);
  }
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('À quel producteur ?'),
        content: SizedBox(width: double.maxFinite, height: 360, child: Column(children: [
          Text('« ${widget.fileName} » ne désigne pas de producteur connu.', style: const TextStyle(fontSize: 13, color: Colors.black54)),
          const SizedBox(height: 8),
          TextField(decoration: const InputDecoration(hintText: 'Nom ou code', isDense: true, prefixIcon: Icon(Icons.search)), onChanged: _find),
          Expanded(child: ListView(children: [
            for (final p in _rows)
              ListTile(dense: true, title: Text('${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase()), subtitle: Text('${p['internal_code'] ?? ''}'), onTap: () => Navigator.pop(context, p)),
          ])),
        ])),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Ignorer ce fichier'))],
      );
}

/// Miniature du polygone dans la liste : même rendu que l'export (intérieur jaune, contour rouge).
class _ThumbPainter extends CustomPainter {
  final List<GeoPoint>? ring;
  final GeoPoint? center;
  const _ThumbPainter(this.ring, [this.center]);
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRRect(RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(6)), Paint()..color = const Color(0xFFE8ECE6));
    final r = ring;
    if (r == null || r.length < 3) return;
    final minLat = r.map((e) => e.lat).reduce((a, b) => a < b ? a : b), maxLat = r.map((e) => e.lat).reduce((a, b) => a > b ? a : b);
    final minLon = r.map((e) => e.lon).reduce((a, b) => a < b ? a : b), maxLon = r.map((e) => e.lon).reduce((a, b) => a > b ? a : b);
    final w = (maxLon - minLon).abs() < 1e-12 ? 1e-12 : maxLon - minLon, h = (maxLat - minLat).abs() < 1e-12 ? 1e-12 : maxLat - minLat;
    final k = (size.width - 8) / (w > h ? w : h);
    final dx = (size.width - w * k) / 2, dy = (size.height - h * k) / 2;
    Offset at(GeoPoint g) => Offset(dx + (g.lon - minLon) * k, size.height - dy - (g.lat - minLat) * k);
    final path = Path()..moveTo(at(r[0]).dx, at(r[0]).dy);
    for (var i = 1; i < r.length; i++) { path.lineTo(at(r[i]).dx, at(r[i]).dy); }
    path.close();
    canvas.drawPath(path, Paint()..color = const Color(0xFFFFEB00));
    canvas.drawPath(path, Paint()..color = const Color(0xFFE53935)..style = PaintingStyle.stroke..strokeWidth = 1.6);
    final c = center;
    if (c != null) {
      canvas.drawCircle(at(c), 4.2, Paint()..color = Colors.white);
      canvas.drawCircle(at(c), 3, Paint()..color = const Color(0xFFD32F2F));
    }
  }
  @override
  bool shouldRepaint(covariant _ThumbPainter old) => old.ring != ring || old.center != center;
}
