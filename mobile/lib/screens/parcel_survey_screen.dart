import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../geo/polygon.dart';
import '../geo/track.dart';
import '../main.dart';
import 'basemap_view.dart';
import 'map_pack_screen.dart';

/// Relevé du tracé d'une parcelle au GPS : le technicien fait le tour de la parcelle et ajoute un point à chaque angle.
/// Tout se calcule sur l'appareil (surface, périmètre, contrôle du tracé) ; l'enregistrement part à la synchronisation, réseau ou non.
class ParcelSurveyScreen extends StatefulWidget {
  /// Parcelle déjà connue dont on reprend le tracé (null : nouvelle parcelle).
  final Map<String, Object?>? existing;
  /// Producteur déjà choisi (relevé lancé depuis sa fiche) : on ne le redemande pas.
  final Map<String, Object?>? producer;
  const ParcelSurveyScreen({super.key, this.existing, this.producer});
  @override
  State<ParcelSurveyScreen> createState() => _ParcelSurveyScreenState();
}

class _ParcelSurveyScreenState extends State<ParcelSurveyScreen> {
  static const _maxAccuracyM = 20.0; // au-delà, le point est signalé comme imprécis
  static const _gapWarnPct = 20.0; // même seuil que le serveur pour l'écart de superficie

  final _search = TextEditingController();
  final _declared = TextEditingController();
  List<Map<String, Object?>> _producers = [];
  Map<String, Object?>? _producer;
  List<Map<String, Object?>> _chains = [];
  String? _chainId;
  final List<GeoPoint> _points = [];
  GeoPoint? _me;
  bool _locating = false, _saving = false;
  String? _message;

  // Tour de la parcelle en continu (« marcher la limite »)
  final TrackRecorder _rec = TrackRecorder();
  StreamSubscription<Position>? _sub;
  bool _walking = false, _paused = false, _atStart = false;
  double? _walkAccuracy;

  /// Démarre l'enregistrement continu : le technicien longe la limite de la parcelle, un point est retenu tous les quelques mètres.
  Future<void> _startWalk() async {
    setState(() { _message = null; });
    if (_points.isNotEmpty) {
      final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
        title: const Text('Remplacer le tracé ?'),
        content: const Text('Le tour de la parcelle remplace les points déjà relevés.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Remplacer'))]));
      if (ok != true || !mounted) return;
    }
    final first = await _position();
    if (first == null || !mounted) return;
    _rec.reset();
    _points.clear();
    _atStart = false;
    setState(() { _walking = true; _paused = false; _walkAccuracy = first.accuracy; });
    _feed(first);
    _sub = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, distanceFilter: 1)).listen(_feed, onError: (_) => _say('Signal GPS perdu : continuez à marcher à découvert.'));
  }

  void _feed(Position p) {
    if (!mounted || _paused) return;
    final g = GeoPoint(p.latitude, p.longitude, accuracyM: p.accuracy);
    final kept = _rec.add(g);
    setState(() {
      _walkAccuracy = p.accuracy; _me = g;
      if (kept) { _points..clear()..addAll(_rec.points); }
      _atStart = _rec.nearStart();
    });
  }

  /// Fin du tour : le tracé est simplifié (points inutiles retirés) et fermé tout seul ; on peut l'enregistrer ou le reprendre.
  Future<void> _finishWalk() async {
    await _sub?.cancel(); _sub = null;
    final simple = simplifyTrack(_rec.points);
    setState(() {
      _walking = false; _paused = false;
      _points..clear()..addAll(simple);
      if (simple.length < 3) _message = 'Tour trop court : au moins 3 points sont nécessaires. Reprenez le tour de la parcelle.';
    });
  }

  Future<void> _cancelWalk() async {
    await _sub?.cancel(); _sub = null;
    _rec.reset();
    setState(() { _walking = false; _paused = false; _points.clear(); });
  }


  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _producer = {'id': e['producer_id'], 'last_name': (e['producer_name'] ?? '').toString(), 'first_names': '', 'internal_code': e['producer_code'] ?? ''};
      _chainId = e['value_chain_id'] as String?;
      _declared.text = (e['declared_area_ha'] ?? '').toString();
    }
    _find('');
    if (e == null && widget.producer != null) _pick(widget.producer!);
  }

  @override
  void dispose() {
    _sub?.cancel();
    _search.dispose();
    _declared.dispose();
    super.dispose();
  }

  Future<void> _find(String q) async {
    final r = await services.repo.searchProducers(q);
    if (mounted) setState(() => _producers = r);
  }

  Future<void> _pick(Map<String, Object?> p) async {
    final chains = await services.repo.chainsFor(p['id'] as String);
    if (!mounted) return;
    setState(() { _producer = p; _chains = chains; _chainId = chains.length == 1 ? chains.first['id'] as String : null; });
  }

  Future<Position?> _position() async {
    if (!await Geolocator.isLocationServiceEnabled()) { _say('Activez la localisation (GPS) du téléphone.'); return null; }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      _say("L'accès à la position est refusé : autorisez-le dans les réglages de l'application.");
      return null;
    }
    try {
      return await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 25)));
    } catch (_) {
      _say('Position introuvable : sortez à découvert et réessayez.');
      return null;
    }
  }

  void _say(String m) { if (mounted) setState(() => _message = m); }

  Future<void> _addPoint() async {
    setState(() { _locating = true; _message = null; });
    final pos = await _position();
    if (!mounted) return;
    setState(() => _locating = false);
    if (pos == null) return;
    if (pos.accuracy > _maxAccuracyM) {
      final keep = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
        title: const Text('Position imprécise'),
        content: Text('Précision de ${pos.accuracy.toStringAsFixed(0)} m (objectif : ${_maxAccuracyM.toStringAsFixed(0)} m ou moins). Attendez quelques secondes à découvert, ou gardez ce point.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Reprendre')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Garder'))],
      ));
      if (keep != true || !mounted) return;
    }
    final here = GeoPoint(pos.latitude, pos.longitude, accuracyM: pos.accuracy);
    setState(() { _points.add(here); _me = here; });
  }

  double? get _declaredHa => double.tryParse(_declared.text.trim().replaceAll(',', '.'));
  String? get _traceError => _points.length < 3 ? null : validateTrace(_points);
  /// Superficie déclarée facultative : à défaut, la surface mesurée par le relevé est enregistrée comme déclarée.
  bool get _declaredOk => _declared.text.trim().isEmpty || (_declaredHa ?? 0) > 0;
  bool get _canSave => _producer != null && _chainId != null && _declaredOk && _points.length >= 3 && _traceError == null && !_saving;
  String? get _whyNot {
    if (_saving || _canSave) return null;
    if (_chainId == null) return _chains.isEmpty ? 'Aucune filière disponible pour ce producteur : synchronisez puis réessayez.' : 'Choisissez la filière.';
    if (!_declaredOk) return 'La superficie déclarée doit être supérieure à zéro (ou laissez le champ vide).';
    if (_points.length < 3) return 'Ajoutez au moins 3 points (${_points.length}/3).';
    return null;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final e = widget.existing;
    if (e != null) {
      await services.repo.queueParcelUpdate(parcelId: e['id'] as String, declaredAreaHa: (_declaredHa ?? areaHa(_points)).toStringAsFixed(4), geometry: toGeoJson(_points));
    } else {
      await services.repo.queueParcel(
        producerId: _producer!['id'] as String, valueChainId: _chainId!,
        declaredAreaHa: (_declaredHa ?? areaHa(_points)).toStringAsFixed(4), geometry: toGeoJson(_points),
      );
    }
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  Widget _walkPanel() {
    final acc = _walkAccuracy;
    final good = acc != null && acc <= 15;
    return Card(color: const Color(0xFFE9F3EA), elevation: 0, child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Icon(_paused ? Icons.pause_circle : Icons.fiber_manual_record, color: _paused ? Colors.orange : Colors.red, size: 18), const SizedBox(width: 8),
        Text(_paused ? 'Enregistrement en pause' : 'Enregistrement du tour en cours', style: const TextStyle(fontWeight: FontWeight.w600)),
      ]),
      const SizedBox(height: 8),
      Text('${_rec.points.length} point(s) · ${_rec.walkedM.toStringAsFixed(0)} m parcourus${_rec.points.length >= 3 ? ' · ${_rec.areaHaNow.toStringAsFixed(2)} ha estimés' : ''}'),
      Text(acc == null ? 'Recherche du signal GPS…' : 'Précision du GPS : ${acc.toStringAsFixed(0)} m${good ? '' : ' — attendez un meilleur signal, les points trop imprécis sont ignorés'}', style: TextStyle(color: good ? Colors.black54 : Colors.orange.shade800)),
      if (_atStart) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Vous êtes revenu au point de départ : appuyez sur « Terminer le tour ».', style: TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF0B5E3B)))),
      const SizedBox(height: 4),
      const Text('Longez la limite de la parcelle à pied, lentement, en gardant l\'écran allumé. Revenez au point de départ.', style: TextStyle(fontSize: 12.5, color: Colors.black54)),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: FilledButton.icon(onPressed: _rec.points.length >= 3 ? _finishWalk : null, icon: const Icon(Icons.flag), label: const Text('Terminer le tour'))),
        const SizedBox(width: 8),
        IconButton.outlined(tooltip: _paused ? 'Reprendre' : 'Pause', onPressed: () => setState(() => _paused = !_paused), icon: Icon(_paused ? Icons.play_arrow : Icons.pause)),
        const SizedBox(width: 4),
        IconButton.outlined(tooltip: 'Annuler le tour', onPressed: _cancelWalk, icon: const Icon(Icons.close)),
      ]),
    ])));
  }

  @override
  Widget build(BuildContext context) {
    final measured = areaHa(_points);
    final gap = _declaredHa == null || _points.length < 3 ? null : gapPct(_declaredHa!, measured);
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? 'Relever une parcelle' : 'Reprendre le tracé'), actions: [
        IconButton(
          tooltip: 'Fond de carte hors ligne', icon: Icon(services.mapPack.ready ? Icons.layers : Icons.layers_outlined),
          onPressed: () async { await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MapPackScreen())); if (mounted) setState(() {}); },
        ),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_producer == null) ...[
          TextField(controller: _search, decoration: const InputDecoration(labelText: 'Producteur (nom ou code)', prefixIcon: Icon(Icons.search)), onChanged: _find),
          for (final p in _producers.take(8))
            ListTile(dense: true, title: Text('${p['last_name']} ${p['first_names']}'), subtitle: Text('${p['internal_code']} · ${p['village'] ?? ''}'), onTap: () => _pick(p)),
        ] else ...[
          ListTile(
            contentPadding: EdgeInsets.zero, title: Text('${_producer!['last_name']} ${_producer!['first_names']}'), subtitle: Text('${_producer!['internal_code']}'),
            trailing: widget.existing != null || widget.producer != null ? null : TextButton(onPressed: _points.isEmpty ? () => setState(() { _producer = null; _chainId = null; }) : null, child: const Text('Changer')),
          ),
          if (_chains.length > 1)
            DropdownButtonFormField<String>(
              value: _chainId, decoration: const InputDecoration(labelText: 'Filière'),
              items: [for (final c in _chains) DropdownMenuItem(value: c['id'] as String, child: Text('${c['name']}'))], onChanged: (v) => setState(() => _chainId = v),
            ),
          TextField(controller: _declared, decoration: const InputDecoration(labelText: 'Superficie déclarée (ha), facultative'), keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setState(() {})),
          if (widget.existing != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(
                'Tracé actuel : ${widget.existing!['geometry_area_ha'] ?? '—'} ha. Le nouveau tracé le remplace une fois envoyé ; le serveur le revérifie (chevauchements, écart de superficie) et la parcelle repasse « déclarée ».',
                style: const TextStyle(color: Colors.black54))),
          const SizedBox(height: 12),
          Container(
            height: 240, decoration: BoxDecoration(border: Border.all(color: Colors.black26), borderRadius: BorderRadius.circular(8)),
            child: BasemapView(tiles: services.tiles, points: _points, me: _me, height: 240),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 16, runSpacing: 4, children: [
            Text('${_points.length} point(s)'),
            if (_points.length >= 3) Text('Surface mesurée : ${measured.toStringAsFixed(2)} ha'),
            if (_points.length >= 3) Text('Périmètre : ${perimeterM(_points).toStringAsFixed(0)} m'),
          ]),
          if (_points.isNotEmpty && _points.last.accuracyM != null) Text('Dernier point : précision ${_points.last.accuracyM!.toStringAsFixed(0)} m', style: const TextStyle(color: Colors.black54)),
          if (gap != null && gap > _gapWarnPct)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text('Écart de ${gap.toStringAsFixed(0)} % avec la superficie déclarée : vérifiez le tracé ou la déclaration.', style: TextStyle(color: Colors.orange.shade800, fontWeight: FontWeight.w600))),
          if (_traceError != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_traceError!, style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w600))),
          if (_message != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_message!, style: TextStyle(color: Colors.red.shade700))),
          const SizedBox(height: 12),
          if (_walking) _walkPanel() else Padding(padding: const EdgeInsets.only(bottom: 8), child: SizedBox(width: double.infinity, child: FilledButton.tonalIcon(
            onPressed: _locating ? null : _startWalk, icon: const Icon(Icons.directions_walk), label: const Text('Marcher le tour de la parcelle (GPS continu)')))),
          if (!_walking) Row(children: [
            Expanded(child: FilledButton.icon(
              onPressed: _locating ? null : _addPoint,
              icon: _locating ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_location_alt_outlined),
              label: Text(_locating ? 'Recherche du GPS…' : 'Ajouter un point ici'),
            )),
            const SizedBox(width: 8),
            IconButton.outlined(tooltip: 'Annuler le dernier point', onPressed: _points.isEmpty ? null : () => setState(() => _points.removeLast()), icon: const Icon(Icons.undo)),
          ]),
          const SizedBox(height: 8),
          if (!_walking) const Text("Deux façons de relever : marchez le tour de la parcelle avec le GPS continu (un point tous les quelques mètres), ou placez-vous à chaque angle et ajoutez un point. Le tracé se ferme tout seul. Aucune connexion n'est nécessaire."),
          const SizedBox(height: 16),
          if (_whyNot != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_whyNot!, style: TextStyle(color: Colors.orange.shade800))),
          FilledButton(onPressed: _canSave && !_walking ? _save : null, child: const Text("Enregistrer sur l'appareil")),
        ],
      ]),
    );
  }
}
