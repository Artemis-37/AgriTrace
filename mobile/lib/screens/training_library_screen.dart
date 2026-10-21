import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../data/api_client.dart';
import '../main.dart';

const _green = Color(0xFF2F5D46);
const _crop = {'cacao': 'Cacao', 'cafe': 'Café'};
const _level = {
  'base': 'Base',
  'intermediaire': 'Intermédiaire',
  'avance': 'Avancé'
};

/// Bibliothèque de modules de formation agricole (cacao puis café) : lecture seule pour le coach, copie conservée sur l'appareil pour le travail sans réseau.
/// Le contenu est géré par l'ADG (conserver, modifier, supprimer) depuis le portail.
class TrainingLibraryScreen extends StatefulWidget {
  const TrainingLibraryScreen({super.key});
  @override
  State<TrainingLibraryScreen> createState() => _TrainingLibraryScreenState();
}

class _TrainingLibraryScreenState extends State<TrainingLibraryScreen> {
  List<Map<String, dynamic>> _all = [];
  bool _loading = true, _offlineCopy = false;
  String? _error;
  String _q = '';
  String? _cropFilter, _theme;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<File> _cacheFile() async => File(p.join(
      (await getApplicationDocumentsDirectory()).path,
      'training_modules.json'));

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await services.api.get('/training-modules') as List;
      final list = r.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      try {
        await (await _cacheFile()).writeAsString(jsonEncode(list));
      } catch (_) {/* copie facultative */}
      if (mounted)
        setState(() {
          _all = list;
          _loading = false;
          _offlineCopy = false;
        });
    } catch (e) {
      try {
        final f = await _cacheFile();
        if (await f.exists()) {
          final list = (jsonDecode(await f.readAsString()) as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
          if (mounted)
            setState(() {
              _all = list;
              _loading = false;
              _offlineCopy = true;
            });
          return;
        }
      } catch (_) {}
      if (mounted)
        setState(() {
          _loading = false;
          _error =
              'Modules indisponibles : ouvrez cet écran une première fois avec du réseau.';
        });
    }
  }

  List<Map<String, dynamic>> get _rows => _all
      .where((m) =>
          (_cropFilter == null || (m['crops'] as List).contains(_cropFilter)) &&
          (_theme == null || m['theme'] == _theme) &&
          (_q.isEmpty ||
              '${m['title']} ${m['summary']}'
                  .toLowerCase()
                  .contains(_q.toLowerCase())))
      .toList();

  @override
  Widget build(BuildContext context) {
    final themes = {for (final m in _all) '${m['theme']}'}.toList()..sort();
    final rows = _rows;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Modules de formation')),
      body: Column(children: [
        Container(
          color: _green,
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: Column(children: [
            TextField(
              decoration: InputDecoration(
                  hintText: 'Rechercher un module',
                  filled: true,
                  fillColor: Colors.white,
                  isDense: true,
                  suffixIcon: const Icon(Icons.search),
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: BorderSide.none)),
              onChanged: (v) => setState(() => _q = v.trim()),
            ),
            const SizedBox(height: 8),
            SizedBox(
                height: 36,
                child: ListView(scrollDirection: Axis.horizontal, children: [
                  Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                          label: const Text('Tous'),
                          selected: _cropFilter == null,
                          onSelected: (_) =>
                              setState(() => _cropFilter = null))),
                  for (final e in _crop.entries)
                    Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                            label: Text(e.value),
                            selected: _cropFilter == e.key,
                            onSelected: (_) => setState(() => _cropFilter =
                                _cropFilter == e.key ? null : e.key))),
                ])),
            if (themes.length > 1)
              Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: DropdownButtonFormField<String?>(
                    initialValue: _theme,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        filled: true,
                        fillColor: Colors.white,
                        isDense: true,
                        border:
                            OutlineInputBorder(borderSide: BorderSide.none)),
                    hint: const Text('Tous les thèmes'),
                    items: [
                      const DropdownMenuItem<String?>(
                          value: null, child: Text('Tous les thèmes')),
                      for (final t in themes)
                        DropdownMenuItem<String?>(
                            value: t,
                            child: Text(t, overflow: TextOverflow.ellipsis))
                    ],
                    onChanged: (v) => setState(() => _theme = v),
                  )),
          ]),
        ),
        if (_offlineCopy)
          Container(
              width: double.infinity,
              color: const Color(0xFFFFF3CD),
              padding: const EdgeInsets.all(8),
              child: const Text(
                  'Hors connexion : copie enregistrée sur ce téléphone (peut ne pas être à jour).',
                  style: TextStyle(fontSize: 12))),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(
                      child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(_error!, textAlign: TextAlign.center)))
                  : rows.isEmpty
                      ? const Center(child: Text('Aucun module ne correspond.'))
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.separated(
                              itemCount: rows.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (_, i) {
                                final m = rows[i];
                                return Material(
                                    color: Colors.white,
                                    child: ListTile(
                                      title: Text('${m['title']}',
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w600)),
                                      subtitle: Text(
                                          '${m['summary']}${m['submission_id'] != null ? '\nProposé par ${m['proposed_by_name'] ?? 'un exportateur'}' : ''}\n${m['theme']} · ${(m['crops'] as List).map((c) => _crop[c] ?? c).join(', ')} · ${_level[m['level']] ?? ''} · ${m['duration_min']} min',
                                          maxLines: 5,
                                          overflow: TextOverflow.ellipsis),
                                      isThreeLine: true,
                                      trailing: const Icon(Icons.chevron_right),
                                      onTap: () => Navigator.of(context).push(
                                          MaterialPageRoute(
                                              builder: (_) =>
                                                  TrainingModuleScreen(
                                                      module: m))),
                                    ));
                              })),
        ),
      ]),
    );
  }
}

/// Lecture d'un module : objectifs, sections, points à éviter, questions pour vérifier la compréhension.
/// Pour un module proposé par un exportateur : saisie des résultats de la séance (transmis à l'ADG, qui les fait suivre à l'exportateur).
class TrainingModuleScreen extends StatefulWidget {
  final Map<String, dynamic> module;
  const TrainingModuleScreen({super.key, required this.module});
  @override
  State<TrainingModuleScreen> createState() => _TrainingModuleScreenState();
}

class _TrainingModuleScreenState extends State<TrainingModuleScreen> {
  bool _canReport = false;
  List<Map<String, dynamic>> _mine = [];

  Map<String, dynamic> get module => widget.module;
  bool get _fromExporter => module['submission_id'] != null;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    if (!_fromExporter) return;
    final perms = await services.repo.permissions();
    if (!perms.contains('training:report')) return;
    if (mounted) setState(() => _canReport = true);
    await _loadMine();
  }

  Future<void> _loadMine() async {
    try {
      final r = await services.api.get('/training-results') as List;
      final l = r
          .map((e) => Map<String, dynamic>.from(e as Map))
          .where((e) => e['module_id'] == module['id'])
          .toList();
      if (mounted) setState(() => _mine = l);
    } catch (_) {/* hors connexion : la liste n'est pas essentielle */}
  }

  Future<void> _report() async {
    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => TrainingResultScreen(module: module)));
    if (ok == true) _loadMine();
  }

  List<Widget> _list(String title, List items) => items.isEmpty
      ? const []
      : [
          Padding(
              padding: const EdgeInsets.only(top: 16, bottom: 4),
              child: Text(title,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: _green))),
          for (final it in items)
            Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('•  '),
                      Expanded(child: Text('$it'))
                    ])),
        ];

  @override
  Widget build(BuildContext context) {
    final c = Map<String, dynamic>.from(module['content'] as Map);
    final certs = (module['certifications'] as List).join(', ');
    return Scaffold(
      appBar: AppBar(
          title: Text('${module['title']}',
              maxLines: 1, overflow: TextOverflow.ellipsis)),
      floatingActionButton: _canReport
          ? FloatingActionButton.extended(
              onPressed: _report,
              icon: const Icon(Icons.fact_check),
              label: const Text('Saisir les résultats'))
          : null,
      body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            if (_fromExporter)
              Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(8),
                  color: const Color(0xFFE8F0E6),
                  child: Text(
                      'Module proposé par ${module['proposed_by_name'] ?? 'un exportateur'}, transmis par l\'ADG tel quel. Vos résultats sont envoyés à l\'ADG, qui les transmet à l\'exportateur.',
                      style: const TextStyle(fontSize: 12))),
            Text(
                '${module['theme']} · ${(module['crops'] as List).map((x) => _crop[x] ?? x).join(', ')} · ${_level[module['level']] ?? ''} · ${module['duration_min']} min${certs.isEmpty ? '' : '\n$certs'}',
                style: const TextStyle(color: Colors.black54)),
            const SizedBox(height: 8),
            Text('${module['summary']}'),
            ..._list('Objectifs', c['objectifs'] as List),
            for (final s in (c['sections'] as List))
              ..._list('${(s as Map)['titre']}', s['points'] as List),
            ..._list('À éviter', (c['a_eviter'] as List?) ?? const []),
            ..._list('Questions pour vérifier la compréhension',
                (c['verifier'] as List?) ?? const []),
            ..._list('Matériel', (c['materiel'] as List?) ?? const []),
            if (_mine.isNotEmpty) ...[
              const Padding(
                  padding: EdgeInsets.only(top: 16, bottom: 4),
                  child: Text('Mes résultats saisis',
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          color: _green))),
              for (final r in _mine)
                ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                        '${r['session_date'].toString().substring(0, 10)} · ${r['village'] == '' ? 'sans village' : r['village']} · ${r['participants']} participant(s)'),
                    subtitle: Text(r['status'] == 'forwarded'
                        ? 'Transmis à l\'exportateur'
                        : 'Envoyé à l\'ADG')),
            ],
          ]),
    );
  }
}

/// Formulaire des résultats d'une séance (réseau requis : l'envoi est refusé avec un message clair sinon).
class TrainingResultScreen extends StatefulWidget {
  final Map<String, dynamic> module;
  const TrainingResultScreen({super.key, required this.module});
  @override
  State<TrainingResultScreen> createState() => _TrainingResultScreenState();
}

class _TrainingResultScreenState extends State<TrainingResultScreen> {
  DateTime _date = DateTime.now();
  final _village = TextEditingController(),
      _participants = TextEditingController(),
      _score = TextEditingController(),
      _notes = TextEditingController();
  bool _busy = false;
  String? _error;

  String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _send() async {
    final n = int.tryParse(_participants.text.trim());
    final sc = _score.text.trim().isEmpty
        ? null
        : double.tryParse(_score.text.trim().replaceAll(',', '.'));
    if (n == null || n < 0) {
      setState(() => _error = 'Indiquez le nombre de participants.');
      return;
    }
    if (_score.text.trim().isNotEmpty && (sc == null || sc < 0 || sc > 100)) {
      setState(() => _error = 'Le score moyen est un nombre de 0 à 100.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await services.api.post('/training-results', {
        'module_id': widget.module['id'],
        'session_date': _iso(_date),
        'village': _village.text.trim(),
        'participants': n,
        if (sc != null) 'avg_score': sc,
        'notes': _notes.text.trim()
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Résultats envoyés à l\'ADG.')));
        Navigator.of(context).pop(true);
      }
    } on NetworkException {
      setState(() {
        _busy = false;
        _error =
            'Pas de réseau : l\'envoi des résultats demande une connexion. Réessayez quand le réseau est disponible.';
      });
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Résultats de la formation')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Text('${widget.module['title']}',
              style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Date de la séance'),
              subtitle: Text(_iso(_date)),
              trailing: const Icon(Icons.calendar_today),
              onTap: () async {
                final d = await showDatePicker(
                    context: context,
                    initialDate: _date,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now());
                if (d != null) setState(() => _date = d);
              }),
          TextField(
              controller: _village,
              decoration: const InputDecoration(labelText: 'Village ou lieu')),
          TextField(
              controller: _participants,
              keyboardType: TextInputType.number,
              decoration:
                  const InputDecoration(labelText: 'Nombre de participants')),
          TextField(
              controller: _score,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                  labelText: 'Score moyen de 0 à 100 (facultatif)')),
          TextField(
              controller: _notes,
              maxLines: 4,
              maxLength: 2000,
              decoration: const InputDecoration(labelText: 'Observations')),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.only(top: 8),
                child:
                    Text(_error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 12),
          FilledButton(
              onPressed: _busy ? null : _send,
              child: Text(_busy ? 'Envoi…' : 'Envoyer à l\'ADG')),
          const SizedBox(height: 8),
          const Text(
              'Les résultats ne sont plus modifiables après l\'envoi : l\'ADG les transmet tels quels à l\'exportateur.',
              style: TextStyle(fontSize: 12, color: Colors.black54)),
        ]),
      );
}
