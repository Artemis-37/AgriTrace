import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../data/api_client.dart';
import '../main.dart';
import 'photo_capture.dart';

/// Libellés d'état et de catégorie d'une mission (tâche du producteur).
const _status = {
  'open': 'À faire', 'in_progress': 'En cours', 'submitted': 'Soumise', 'to_correct': 'À corriger', 'validated': 'Validée', 'completed': 'Terminée',
  'closed': 'Clôturée', 'cancelled': 'Annulée', 'pending_sync': 'À envoyer',
};
const _cat = {'mapping': 'Cartographie', 'visit': 'Visite', 'survey': 'Enquête', 'collection': 'Collecte', 'training': 'Formation', 'control': 'Contrôle', 'other': 'Autre'};


String missionStatusLabel(Object? s) => _status[s] ?? '$s';
String missionCategoryLabel(Object? c) => _cat[c] ?? '';

/// Demande de mission d'un coach pour un producteur : titre, catégorie, précisions. La clé est créée une fois par demande : un renvoi ne crée pas de doublon.
/// Renvoie le message à afficher (null si la demande est annulée).
Future<String?> askMission(BuildContext context, {String? producerId}) async {
  final key = 'req-${const Uuid().v4()}';
  final title = TextEditingController(), desc = TextEditingController();
  var cat = 'visit';
  final go = await showDialog<bool>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, setS) => AlertDialog(
    title: const Text('Demander une mission'),
    content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
      TextField(controller: title, decoration: const InputDecoration(labelText: 'Titre'), onChanged: (_) => setS(() {})),
      DropdownButtonFormField<String>(value: cat, decoration: const InputDecoration(labelText: 'Catégorie'),
          items: [for (final e in _cat.entries) DropdownMenuItem(value: e.key, child: Text(e.value))], onChanged: (v) => setS(() => cat = v ?? cat)),
      TextField(controller: desc, minLines: 2, maxLines: 5, decoration: const InputDecoration(labelText: 'Précisions (facultatif)')),
    ])),
    actions: [
      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
      FilledButton(onPressed: title.text.trim().length >= 3 ? () => Navigator.pop(ctx, true) : null, child: const Text('Envoyer la demande')),
    ],
  )));
  if (go != true) return null;
  try {
    await services.api.post('/task-requests', {'idempotency_key': key, 'title': title.text.trim(), 'category': cat, if (producerId != null) 'producer_id': producerId, if (desc.text.trim().isNotEmpty) 'description': desc.text.trim()});
    return 'Demande envoyée : un responsable la décidera.';
  } on ApiException catch (e) {
    return e.message;
  } catch (_) {
    return 'Envoi impossible hors connexion. Réessayez avec du réseau.';
  }
}

class MissionScreen extends StatefulWidget {
  final Map<String, dynamic> task;
  const MissionScreen({super.key, required this.task});
  @override
  State<MissionScreen> createState() => _MissionScreenState();
}

class _MissionScreenState extends State<MissionScreen> {
  late Map<String, dynamic> _t = widget.task;
  final _text = TextEditingController();
  final _lat = TextEditingController();
  final _lon = TextEditingController();
  String _kind = 'observation';
  bool _busy = false;
  String? _msg;

  Future<void> _run(Future<void> Function() fn) async {
    setState(() { _busy = true; _msg = null; });
    try { await fn(); } on ApiException catch (e) { setState(() => _msg = e.message); } on NetworkException { setState(() => _msg = 'Action impossible sans réseau.'); } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _move(String to) => _run(() async {
        final r = await services.api.post('/tasks/${_t['id']}/transition', {'to': to});
        setState(() { _t = {..._t, ...Map<String, dynamic>.from(r as Map)}; _msg = 'Mission : ${_status[_t['status']] ?? _t['status']}.'; });
      });

  Future<void> _entry() => _run(() async {
        final body = <String, Object>{'idempotency_key': const Uuid().v4(), 'kind': _kind};
        if (_kind == 'gps') {
          final la = double.tryParse(_lat.text.replaceAll(',', '.')), lo = double.tryParse(_lon.text.replaceAll(',', '.'));
          if (la == null || lo == null) { setState(() => _msg = 'Latitude et longitude requises.'); return; }
          body['latitude'] = la; body['longitude'] = lo;
        } else {
          if (_text.text.trim().isEmpty) { setState(() => _msg = 'Saisissez un texte.'); return; }
          body['content'] = _text.text.trim();
        }
        await services.api.post('/tasks/${_t['id']}/entries', body);
        _text.clear(); _lat.clear(); _lon.clear();
        setState(() => _msg = 'Saisie enregistrée.');
      });

  /// Photo d'une mission (preuve de réalisation) : envoyée tout de suite, comme le reste de la mission (réseau nécessaire).
  Future<void> _photo() => _run(() async {
        final path = await takePhotoPath();
        if (path == null) { setState(() => _msg = 'Aucune photo prise.'); return; }
        await services.api.upload('/documents', filePath: path, filename: 'photo.jpg', fields: {
          'subject_type': 'task', 'subject_id': _t['id'] as String, 'kind': 'Photo de la mission', 'client_key': 'photo-${const Uuid().v4()}',
        });
        setState(() => _msg = 'Photo envoyée.');
      });

  @override
  Widget build(BuildContext context) {
    final st = _t['status'] as String;
    final canStart = ['open', 'to_correct'].contains(st), working = st == 'in_progress';
    return Scaffold(
      appBar: AppBar(title: Text('${_t['title']}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('${_cat[_t['category']] ?? ''} • ${_status[st] ?? st}', style: Theme.of(context).textTheme.titleSmall),
        if (_t['description'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${_t['description']}')),
        if (_t['due_date'] != null) Text('Échéance : ${_t['due_date'].toString().substring(0, 10)}'),
        const SizedBox(height: 16),
        if (canStart) FilledButton(onPressed: _busy ? null : () => _move('in_progress'), child: Text(st == 'to_correct' ? 'Reprendre' : 'Démarrer')),
        if (working) ...[
          const Text('Nouvelle saisie', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            value: _kind, decoration: const InputDecoration(labelText: 'Type', border: OutlineInputBorder()),
            items: const [DropdownMenuItem(value: 'observation', child: Text('Observation')), DropdownMenuItem(value: 'result', child: Text('Résultat')), DropdownMenuItem(value: 'gps', child: Text('Position (coordonnées)'))],
            onChanged: (v) => setState(() => _kind = v ?? 'observation')),
          const SizedBox(height: 8),
          if (_kind == 'gps') ...[
            TextField(controller: _lat, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: const InputDecoration(labelText: 'Latitude', border: OutlineInputBorder())),
            const SizedBox(height: 8),
            TextField(controller: _lon, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: const InputDecoration(labelText: 'Longitude', border: OutlineInputBorder())),
          ] else
            TextField(controller: _text, minLines: 3, maxLines: 6, decoration: const InputDecoration(labelText: 'Texte', border: OutlineInputBorder())),
          const SizedBox(height: 8),
          FilledButton.tonal(onPressed: _busy ? null : _entry, child: const Text('Enregistrer la saisie')),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _busy ? null : _photo, icon: const Icon(Icons.photo_camera_outlined), label: const Text('Joindre une photo (facultatif)')),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : () => _move('submitted'), child: const Text('Soumettre la mission')),
        ],
        if (_msg != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_msg!)),
      ]),
    );
  }
}
