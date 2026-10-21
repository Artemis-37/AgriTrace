import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../main.dart';

const _green = Color(0xFF2F5D46);
const _crop = {'cacao': 'Cacao', 'cafe': 'Café'};
const _level = {'base': 'Base', 'intermediaire': 'Intermédiaire', 'avance': 'Avancé'};

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

  Future<File> _cacheFile() async => File(p.join((await getApplicationDocumentsDirectory()).path, 'training_modules.json'));

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final r = await services.api.get('/training-modules') as List;
      final list = r.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      try { await (await _cacheFile()).writeAsString(jsonEncode(list)); } catch (_) { /* copie facultative */ }
      if (mounted) setState(() { _all = list; _loading = false; _offlineCopy = false; });
    } catch (e) {
      try {
        final f = await _cacheFile();
        if (await f.exists()) {
          final list = (jsonDecode(await f.readAsString()) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
          if (mounted) setState(() { _all = list; _loading = false; _offlineCopy = true; });
          return;
        }
      } catch (_) {}
      if (mounted) setState(() { _loading = false; _error = 'Modules indisponibles : ouvrez cet écran une première fois avec du réseau.'; });
    }
  }

  List<Map<String, dynamic>> get _rows => _all.where((m) =>
      (_cropFilter == null || (m['crops'] as List).contains(_cropFilter)) && (_theme == null || m['theme'] == _theme) &&
      (_q.isEmpty || '${m['title']} ${m['summary']}'.toLowerCase().contains(_q.toLowerCase()))).toList();

  @override
  Widget build(BuildContext context) {
    final themes = {for (final m in _all) '${m['theme']}'}.toList()..sort();
    final rows = _rows;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Modules de formation')),
      body: Column(children: [
        Container(
          color: _green, padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: Column(children: [
            TextField(
              decoration: InputDecoration(hintText: 'Rechercher un module', filled: true, fillColor: Colors.white, isDense: true, suffixIcon: const Icon(Icons.search),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none)),
              onChanged: (v) => setState(() => _q = v.trim()),
            ),
            const SizedBox(height: 8),
            SizedBox(height: 36, child: ListView(scrollDirection: Axis.horizontal, children: [
              Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: const Text('Tous'), selected: _cropFilter == null, onSelected: (_) => setState(() => _cropFilter = null))),
              for (final e in _crop.entries) Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(e.value), selected: _cropFilter == e.key, onSelected: (_) => setState(() => _cropFilter = _cropFilter == e.key ? null : e.key))),
            ])),
            if (themes.length > 1) Padding(padding: const EdgeInsets.only(top: 8), child: DropdownButtonFormField<String?>(
              initialValue: _theme, isExpanded: true, decoration: const InputDecoration(filled: true, fillColor: Colors.white, isDense: true, border: OutlineInputBorder(borderSide: BorderSide.none)),
              hint: const Text('Tous les thèmes'),
              items: [const DropdownMenuItem<String?>(value: null, child: Text('Tous les thèmes')), for (final t in themes) DropdownMenuItem<String?>(value: t, child: Text(t, overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _theme = v),
            )),
          ]),
        ),
        if (_offlineCopy) Container(width: double.infinity, color: const Color(0xFFFFF3CD), padding: const EdgeInsets.all(8), child: const Text('Hors connexion : copie enregistrée sur ce téléphone (peut ne pas être à jour).', style: TextStyle(fontSize: 12))),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
                : rows.isEmpty
                    ? const Center(child: Text('Aucun module ne correspond.'))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          itemCount: rows.length, separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final m = rows[i];
                            return Material(color: Colors.white, child: ListTile(
                              title: Text('${m['title']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                              subtitle: Text('${m['summary']}\n${m['theme']} · ${(m['crops'] as List).map((c) => _crop[c] ?? c).join(', ')} · ${_level[m['level']] ?? ''} · ${m['duration_min']} min', maxLines: 4, overflow: TextOverflow.ellipsis),
                              isThreeLine: true, trailing: const Icon(Icons.chevron_right),
                              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TrainingModuleScreen(module: m))),
                            ));
                          })),
        ),
      ]),
    );
  }

}

/// Lecture d'un module : objectifs, sections, points à éviter, questions pour vérifier la compréhension.
class TrainingModuleScreen extends StatelessWidget {
  final Map<String, dynamic> module;
  const TrainingModuleScreen({super.key, required this.module});

  List<Widget> _list(String title, List items) => items.isEmpty
      ? const []
      : [
          Padding(padding: const EdgeInsets.only(top: 16, bottom: 4), child: Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: _green))),
          for (final it in items) Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('•  '), Expanded(child: Text('$it'))])),
        ];

  @override
  Widget build(BuildContext context) {
    final c = Map<String, dynamic>.from(module['content'] as Map);
    final certs = (module['certifications'] as List).join(', ');
    return Scaffold(
      appBar: AppBar(title: Text('${module['title']}', maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('${module['theme']} · ${(module['crops'] as List).map((x) => _crop[x] ?? x).join(', ')} · ${_level[module['level']] ?? ''} · ${module['duration_min']} min${certs.isEmpty ? '' : '\n$certs'}', style: const TextStyle(color: Colors.black54)),
        const SizedBox(height: 8),
        Text('${module['summary']}'),
        ..._list('Objectifs', c['objectifs'] as List),
        for (final s in (c['sections'] as List)) ..._list('${(s as Map)['titre']}', s['points'] as List),
        ..._list('À éviter', (c['a_eviter'] as List?) ?? const []),
        ..._list('Questions pour vérifier la compréhension', (c['verifier'] as List?) ?? const []),
        ..._list('Matériel', (c['materiel'] as List?) ?? const []),
      ]),
    );
  }
}
