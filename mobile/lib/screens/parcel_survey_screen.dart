import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../geo/polygon.dart';
import '../main.dart';

/// Relevé du tracé d'une parcelle au GPS : le technicien fait le tour de la parcelle et ajoute un point à chaque angle.
/// Tout se calcule sur l'appareil (surface, périmètre, contrôle du tracé) ; l'enregistrement part à la synchronisation, réseau ou non.
class ParcelSurveyScreen extends StatefulWidget {
  /// Parcelle déjà connue dont on reprend le tracé (null : nouvelle parcelle).
  final Map<String, Object?>? existing;
  const ParcelSurveyScreen({super.key, this.existing});
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
  bool _locating = false, _saving = false;
  String? _message;

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
  }

  @override
  void dispose() {
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
    setState(() => _points.add(GeoPoint(pos.latitude, pos.longitude, accuracyM: pos.accuracy)));
  }

  double? get _declaredHa => double.tryParse(_declared.text.trim().replaceAll(',', '.'));
  String? get _traceError => _points.length < 3 ? null : validateTrace(_points);
  bool get _canSave => _producer != null && _chainId != null && (_declaredHa ?? 0) > 0 && _points.length >= 3 && _traceError == null && !_saving;

  Future<void> _save() async {
    setState(() => _saving = true);
    final e = widget.existing;
    if (e != null) {
      await services.repo.queueParcelUpdate(parcelId: e['id'] as String, declaredAreaHa: _declaredHa!.toStringAsFixed(4), geometry: toGeoJson(_points));
    } else {
      await services.repo.queueParcel(
        producerId: _producer!['id'] as String, valueChainId: _chainId!,
        declaredAreaHa: _declaredHa!.toStringAsFixed(4), geometry: toGeoJson(_points),
      );
    }
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final measured = areaHa(_points);
    final gap = _declaredHa == null || _points.length < 3 ? null : gapPct(_declaredHa!, measured);
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? 'Relever une parcelle' : 'Reprendre le tracé')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_producer == null) ...[
          TextField(controller: _search, decoration: const InputDecoration(labelText: 'Producteur (nom ou code)', prefixIcon: Icon(Icons.search)), onChanged: _find),
          for (final p in _producers.take(8))
            ListTile(dense: true, title: Text('${p['last_name']} ${p['first_names']}'), subtitle: Text('${p['internal_code']} · ${p['village'] ?? ''}'), onTap: () => _pick(p)),
        ] else ...[
          ListTile(
            contentPadding: EdgeInsets.zero, title: Text('${_producer!['last_name']} ${_producer!['first_names']}'), subtitle: Text('${_producer!['internal_code']}'),
            trailing: widget.existing != null ? null : TextButton(onPressed: _points.isEmpty ? () => setState(() { _producer = null; _chainId = null; }) : null, child: const Text('Changer')),
          ),
          if (_chains.length > 1)
            DropdownButtonFormField<String>(
              value: _chainId, decoration: const InputDecoration(labelText: 'Filière'),
              items: [for (final c in _chains) DropdownMenuItem(value: c['id'] as String, child: Text('${c['name']}'))], onChanged: (v) => setState(() => _chainId = v),
            ),
          TextField(controller: _declared, decoration: const InputDecoration(labelText: 'Superficie déclarée (ha)'), keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (_) => setState(() {})),
          if (widget.existing != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(
                'Tracé actuel : ${widget.existing!['geometry_area_ha'] ?? '—'} ha. Le nouveau tracé le remplace une fois envoyé ; le serveur le revérifie (chevauchements, écart de superficie) et la parcelle repasse « déclarée ».',
                style: const TextStyle(color: Colors.black54))),
          const SizedBox(height: 12),
          Container(
            height: 240, decoration: BoxDecoration(border: Border.all(color: Colors.black26), borderRadius: BorderRadius.circular(8)),
            child: ClipRRect(borderRadius: BorderRadius.circular(8), child: CustomPaint(painter: _TracePainter(_points), size: Size.infinite)),
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
          Row(children: [
            Expanded(child: FilledButton.icon(
              onPressed: _locating ? null : _addPoint,
              icon: _locating ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_location_alt_outlined),
              label: Text(_locating ? 'Recherche du GPS…' : 'Ajouter un point ici'),
            )),
            const SizedBox(width: 8),
            IconButton.outlined(tooltip: 'Annuler le dernier point', onPressed: _points.isEmpty ? null : () => setState(() => _points.removeLast()), icon: const Icon(Icons.undo)),
          ]),
          const SizedBox(height: 8),
          const Text("Placez-vous à chaque angle de la parcelle et ajoutez un point ; le tracé se ferme tout seul. Aucune connexion n'est nécessaire."),
          const SizedBox(height: 16),
          FilledButton(onPressed: _canSave ? _save : null, child: const Text("Enregistrer sur l'appareil")),
        ],
      ]),
    );
  }
}

/// Plan de la parcelle sans fond de carte (utilisable hors connexion) : points numérotés, tracé fermé, nord en haut.
class _TracePainter extends CustomPainter {
  final List<GeoPoint> pts;
  _TracePainter(this.pts);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFFF4F7F2));
    if (pts.isEmpty) return;
    final lat0 = pts.fold<double>(0, (s, p) => s + p.lat) / pts.length;
    final kx = math.cos(lat0 * math.pi / 180);
    final xs = pts.map((p) => p.lon * kx).toList(), ys = pts.map((p) => p.lat).toList();
    final minX = xs.reduce(math.min), maxX = xs.reduce(math.max), minY = ys.reduce(math.min), maxY = ys.reduce(math.max);
    final w = math.max(maxX - minX, 1e-9), h = math.max(maxY - minY, 1e-9);
    const pad = 28.0;
    final scale = math.min((size.width - 2 * pad) / w, (size.height - 2 * pad) / h);
    final ox = (size.width - w * scale) / 2, oy = (size.height - h * scale) / 2;
    Offset at(int i) => Offset(ox + (xs[i] - minX) * scale, size.height - (oy + (ys[i] - minY) * scale));
    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < pts.length; i++) {
      path.lineTo(at(i).dx, at(i).dy);
    }
    if (pts.length >= 3) {
      path.close();
      canvas.drawPath(path, Paint()..color = const Color(0x332E7D32));
    }
    canvas.drawPath(path, Paint()..color = const Color(0xFF2E7D32)..style = PaintingStyle.stroke..strokeWidth = 2);
    for (var i = 0; i < pts.length; i++) {
      canvas.drawCircle(at(i), 6, Paint()..color = i == 0 ? const Color(0xFF1B5E20) : const Color(0xFF6D4C41));
      final tp = TextPainter(text: TextSpan(text: '${i + 1}', style: const TextStyle(fontSize: 11, color: Colors.black87, fontWeight: FontWeight.w700)), textDirection: TextDirection.ltr)..layout();
      tp.paint(canvas, at(i) + const Offset(8, -16));
    }
    final n = TextPainter(text: const TextSpan(text: 'N ↑', style: TextStyle(fontSize: 12, color: Colors.black54)), textDirection: TextDirection.ltr)..layout();
    n.paint(canvas, Offset(size.width - n.width - 8, 6));
  }

  @override
  bool shouldRepaint(covariant _TracePainter old) => true;
}
