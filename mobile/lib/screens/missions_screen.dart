import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../data/api_client.dart';
import '../main.dart';

/// Missions du coach (ou de l'agent de terrain) : liste, démarrage, saisie d'observations / résultats / position, soumission. Nécessite le réseau.
class MissionsScreen extends StatefulWidget {
  const MissionsScreen({super.key});
  @override
  State<MissionsScreen> createState() => _MissionsScreenState();
}

const _status = {
  'open': 'À faire', 'in_progress': 'En cours', 'submitted': 'Soumise', 'to_correct': 'À corriger', 'validated': 'Validée', 'completed': 'Terminée',
  'closed': 'Clôturée', 'cancelled': 'Annulée', 'pending_sync': 'À envoyer',
};
const _cat = {'mapping': 'Cartographie', 'visit': 'Visite', 'survey': 'Enquête', 'collection': 'Collecte', 'training': 'Formation', 'control': 'Contrôle', 'other': 'Autre'};

class _MissionsScreenState extends State<MissionsScreen> {
  List<dynamic>? _rows;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await services.api.get('/tasks');
      if (!mounted) return;
      setState(() { _rows = (r as List<dynamic>).where((t) => !['closed', 'cancelled'].contains(t['status'])).toList(); _error = null; });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Indisponible hors connexion. Réessayez avec du réseau.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Scaffold(
      appBar: AppBar(title: const Text('Mes missions')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
          if (rows == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (rows != null && rows.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Aucune mission.'))),
          for (final t in rows ?? const [])
            ListTile(
              leading: Icon(t['overdue'] == true ? Icons.warning_amber_rounded : Icons.assignment_outlined, color: t['overdue'] == true ? Colors.red : null),
              title: Text('${t['title']}'),
              subtitle: Text('${_cat[t['category']] ?? ''}${t['due_date'] != null ? ' • échéance ${t['due_date'].toString().substring(0, 10)}' : ''}${t['section'] != null ? ' • ${t['section']}' : ''}'),
              trailing: Text(_status[t['status']] ?? '${t['status']}', style: const TextStyle(fontSize: 12)),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => MissionScreen(task: Map<String, dynamic>.from(t as Map))));
                _load();
              }),
        ]),
      ),
    );
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
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : () => _move('submitted'), child: const Text('Soumettre la mission')),
        ],
        if (_msg != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_msg!)),
      ]),
    );
  }
}
