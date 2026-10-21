import 'package:flutter/material.dart';

import '../main.dart';
import 'field_widgets.dart';
import 'photo_capture.dart';

const trainingThemes = [
  'Agriculture régénératrice', 'Alimentation saine et nutrition', 'Collecte de documents et tenue de registres', 'Culture commerciale et financière',
  'Diversification', 'Eau, assainissement, et hygiène', "Entreprise responsable et droits de l'homme", 'Genre, jeunesse, et inclusion',
  'Gestion des récoltes et des produits', 'Gouvernance coopérative', 'Maladies transmissibles et non transmissibles', 'Normes et réglementations de certification',
  'Santé et sécurité au travail', 'Santé générale', 'Santé maternelle et reproductive',
];

/// Modules proposés par thème (seul le thème « Agriculture régénératrice » est renseigné ; pour les autres, saisie libre).
const trainingModules = <String, List<String>>{
  'Agriculture régénératrice': [
    'Actions paysagères', 'Agroforesterie et arbres à la ferme', "Conservation de l'eau après la récolte", "Conservation de l'eau avant la récolte",
    "Contrôle de l'érosion des sols", 'Correction du sol', 'Couverture permanente du sol', 'Cultures intercalaires et rotations des cultures',
    'Gestion des eaux usées', 'Gestion des résidus de récolte et des déchets',
  ],
};

/// « Dossiers de formation » : formations enregistrées (en attente d'envoi sur l'appareil, puis confirmées par le serveur).
class TrainingListScreen extends StatefulWidget {
  const TrainingListScreen({super.key});
  @override
  State<TrainingListScreen> createState() => _TrainingListScreenState();
}

class _TrainingListScreenState extends State<TrainingListScreen> {
  List<Map<String, dynamic>> _local = [];
  List<dynamic>? _server;
  bool _offline = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final local = await services.repo.localFieldRecords('training');
    List<dynamic>? server;
    var off = false;
    try { server = await services.api.get('/field-records?kind=training') as List<dynamic>; } catch (_) { off = true; }
    if (mounted) setState(() { _local = local; _server = server; _offline = off; });
  }

  Future<void> _add() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const TrainingFormScreen()));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final localIds = _local.map((l) => l['id']).toSet();
    final serverRows = (_server ?? const []).where((s) => !localIds.contains(s['id'])).toList();
    final empty = _local.isEmpty && serverRows.isEmpty;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Gérer la formation')),
      body: Column(children: [
        Container(width: double.infinity, color: fieldGreen, padding: const EdgeInsets.fromLTRB(16, 10, 8, 10), child: Row(children: [
          const Expanded(child: Text('Dossiers de formation', style: TextStyle(color: Colors.white, fontSize: 20))),
          IconButton.filled(onPressed: _add, tooltip: 'Enregistrer une formation', style: IconButton.styleFrom(backgroundColor: const Color(0xFFF58A1F), foregroundColor: Colors.white), icon: const Icon(Icons.add, size: 30)),
        ])),
        Expanded(child: RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
          if (_offline) const Padding(padding: EdgeInsets.only(bottom: 8), child: Text("Hors connexion : seules les formations en attente d'envoi sont affichées.", style: TextStyle(color: Colors.black54, fontSize: 12))),
          if (empty) const Padding(padding: EdgeInsets.all(8), child: Text('Lorsque vous ajoutez des dossiers de formation, ils apparaîtront ici.', style: TextStyle(fontSize: 16))),
          for (final l in _local) _row('${l['title']}', _count(l['data']), "En attente d'envoi", Colors.orange.shade800),
          for (final s in serverRows) _row('${s['title']}', _count(s['data']), 'Envoyée', Colors.green.shade800),
        ]))),
      ]),
    );
  }

  String _count(Object? data) {
    final p = (data is Map ? data['participants'] : null);
    return p is List ? '${p.length} participant(s)' : '';
  }

  Widget _row(String title, String sub, String state, Color color) => Card(color: Colors.white, elevation: 0, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(2)),
      child: ListTile(title: Text(title), subtitle: Text([sub, state].where((e) => e.isNotEmpty).join('  •  '), style: TextStyle(color: color)), trailing: const Icon(Icons.school_outlined)));
}

class _Participant {
  final String? producerId;
  final String name, role;
  final String? phone;
  int? score;
  _Participant({this.producerId, required this.name, required this.role, this.phone});
  Map<String, Object?> toJson() => {if (producerId != null) 'producer_id': producerId, 'name': name, 'role': role, if (phone != null) 'phone': phone, if (score != null) 'score': score};
}

/// « Gérer le registre de formation » : thème, module, photo, participants (agriculteurs et parties prenantes) et scores.
class TrainingFormScreen extends StatefulWidget {
  const TrainingFormScreen({super.key});
  @override
  State<TrainingFormScreen> createState() => _TrainingFormScreenState();
}

class _TrainingFormScreenState extends State<TrainingFormScreen> {
  String? _theme;
  final _module = TextEditingController();
  final Set<String> _modules = {};
  final List<_Participant> _people = [];
  String? _photo, _msg;
  bool _openPrincipal = true, _openStake = false, _busy = false;

  @override
  void dispose() { _module.dispose(); super.dispose(); }

  Future<void> _pickModules() async {
    final all = trainingModules[_theme] ?? const <String>[];
    final chosen = {..._modules};
    var q = '';
    final ok = await showDialog<bool>(context: context, builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: const Text('Sélectionner'),
      content: SizedBox(width: double.maxFinite, child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(onChanged: (v) => set(() => q = v), decoration: const InputDecoration(hintText: 'Sélectionner')),
        Flexible(child: ListView(shrinkWrap: true, children: [
          for (final m in all.where((m) => m.toLowerCase().contains(q.toLowerCase())))
            CheckboxListTile(controlAffinity: ListTileControlAffinity.leading, title: Text(m), value: chosen.contains(m), onChanged: (v) => set(() { if (v == true) { chosen.add(m); } else { chosen.remove(m); } })),
        ])),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('OK'))])));
    if (ok == true) setState(() { _modules..clear()..addAll(chosen); });
  }

  Future<void> _addFarmer() async {
    final p = await pickProducer(context);
    if (p == null) return;
    if (_people.any((x) => x.producerId == p['id'])) { setState(() => _msg = 'Ce producteur est déjà dans la liste.'); return; }
    setState(() { _msg = null; _people.add(_Participant(producerId: p['id'] as String, name: '${p['last_name']} ${p['first_names']}'.trim().toUpperCase(), role: 'principal')); });
  }

  Future<void> _addStake() async {
    final n = TextEditingController(), ph = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: const Text('Participant partie prenante'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: n, decoration: const InputDecoration(labelText: 'Nom et prénoms')), TextField(controller: ph, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Téléphone (facultatif)'))]),
      actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Ajouter'))]));
    if (ok == true && n.text.trim().isNotEmpty) setState(() => _people.add(_Participant(name: n.text.trim(), role: 'partie_prenante', phone: ph.text.trim().isEmpty ? null : ph.text.trim())));
  }

  Future<void> _scores() async {
    if (_people.isEmpty) { setState(() => _msg = "Ajoutez d'abord des participants."); return; }
    final ctl = [for (final p in _people) TextEditingController(text: p.score?.toString() ?? '')];
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: const Text('Ajouter les scores'),
      content: SizedBox(width: double.maxFinite, child: ListView(shrinkWrap: true, children: [
        for (var i = 0; i < _people.length; i++) Padding(padding: const EdgeInsets.only(bottom: 8), child: TextField(controller: ctl[i], keyboardType: TextInputType.number, decoration: InputDecoration(labelText: '${_people[i].name} (0 à 100)', border: const OutlineInputBorder(), isDense: true))),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Valider'))]));
    if (ok == true) setState(() { for (var i = 0; i < _people.length; i++) { final v = int.tryParse(ctl[i].text.trim()); _people[i].score = v == null ? null : v.clamp(0, 100); } });
  }

  Future<void> _save() async {
    if (_theme == null) { setState(() => _msg = 'Choisissez le thème de la formation.'); return; }
    if (_people.isEmpty) { setState(() => _msg = 'Ajoutez au moins un participant.'); return; }
    setState(() { _busy = true; _msg = null; });
    final id = await services.repo.queueFieldRecord(kind: 'training', title: _theme!, data: {'theme': _theme, 'module': trainingModules.containsKey(_theme) ? _modules.join(', ') : _module.text.trim(), 'modules': _modules.toList(), 'participants': [for (final p in _people) p.toJson()]});
    if (_photo != null) await services.repo.queuePhoto(subjectType: 'field_record', subjectId: id, kind: 'Photo de la formation', sourcePath: _photo!);
    services.sync.run();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final farmers = _people.where((p) => p.role == 'principal').toList(), stakes = _people.where((p) => p.role != 'principal').toList();
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Gérer le registre de formation')),
      body: Column(children: [
        Expanded(child: ListView(padding: const EdgeInsets.only(bottom: 12), children: [
          const FieldBand('Gérer le registre de formation'),
          FieldCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('THÈME DE FORMATION', style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              FieldDropdown(value: _theme, hint: 'Sélectionner', items: trainingThemes, onChanged: (v) => setState(() { _theme = v; _modules.clear(); })),
              const SizedBox(height: 10),
              const Text('MODULE DE FORMATION', style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              if (trainingModules.containsKey(_theme))
                InkWell(onTap: _pickModules, child: Container(
                  width: double.infinity, constraints: const BoxConstraints(minHeight: 56), padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(border: Border.all(color: Colors.grey.shade400), borderRadius: BorderRadius.circular(8)),
                  child: Row(children: [Expanded(child: Text(_modules.isEmpty ? 'Sélectionner' : _modules.join(', '), style: TextStyle(color: _modules.isEmpty ? Colors.black54 : Colors.black87))), const Icon(Icons.expand_more)])))
              else TextField(controller: _module, decoration: fieldDeco('Module')),
            ])),
            const SizedBox(width: 12),
            GestureDetector(
              onTap: () async { final p = await takePhotoPath(); if (p != null && mounted) setState(() => _photo = p); },
              child: Container(width: 130, height: 120, color: const Color(0xFFE6E6E6), child: _photo == null ? const Icon(Icons.add_a_photo_outlined, size: 40, color: Colors.black45) : const Icon(Icons.check_circle, size: 44, color: fieldAction)),
            ),
          ])),
          Container(margin: const EdgeInsets.fromLTRB(12, 12, 12, 0), padding: const EdgeInsets.all(10), color: const Color(0xFFEDEDED), child: const Text('PARTICIPANTS', style: TextStyle(fontWeight: FontWeight.w800))),
          _group('Agriculteur principal', farmers, _openPrincipal, _addFarmer, (v) => setState(() => _openPrincipal = v)),
          _group('Participant partie prenante', stakes, _openStake, _addStake, (v) => setState(() => _openStake = v)),
          if (_msg != null) Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 0), child: Text(_msg!, style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w600))),
        ])),
        Material(color: Colors.white, elevation: 8, child: Padding(padding: const EdgeInsets.all(10), child: Row(children: [
          Expanded(child: FilledButton(onPressed: _scores, style: FilledButton.styleFrom(backgroundColor: const Color(0xFFF58A1F), minimumSize: const Size(0, 50)), child: const Text('AJOUTER LES SCORES'))),
          const SizedBox(width: 10),
          Expanded(child: FilledButton(onPressed: _busy ? null : _save, style: FilledButton.styleFrom(backgroundColor: fieldGreen, minimumSize: const Size(0, 50)), child: const Text('ENREGISTRER UNE FORMATION'))),
        ]))),
      ]),
    );
  }

  Widget _group(String title, List<_Participant> rows, bool open, VoidCallback onAdd, ValueChanged<bool> onToggle) => Container(
        margin: const EdgeInsets.fromLTRB(12, 10, 12, 0), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
        child: Column(children: [
          Row(children: [
            const CircleAvatar(backgroundColor: fieldGreen, child: Icon(Icons.person, color: Colors.white)),
            const SizedBox(width: 12),
            Expanded(child: Text('$title${rows.isEmpty ? '' : ' (${rows.length})'}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            IconButton.filled(onPressed: onAdd, style: IconButton.styleFrom(backgroundColor: const Color(0xFFF58A1F), foregroundColor: Colors.white), icon: const Icon(Icons.add)),
            IconButton(onPressed: () => onToggle(!open), icon: Icon(open ? Icons.expand_less : Icons.expand_more, color: const Color(0xFFF58A1F))),
          ]),
          if (open) for (final r in rows)
            Material(type: MaterialType.transparency, child: ListTile(dense: true, title: Text(r.name), subtitle: r.score == null ? null : Text('Score : ${r.score}'),
                trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _people.remove(r))))),
        ]),
      );
}
