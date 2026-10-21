import 'dart:convert';

import 'package:flutter/material.dart';

import '../main.dart';
import 'field_widgets.dart';

const _defaultGroups = <String, List<String>>{
  'Finance': ['Bourses', 'Crédit', 'Primes', 'Prêts', 'Subventions'],
  'Intrants et Outils': [],
  'Services et Dépistages': [],
};

/// Distribution et services : on choisit la catégorie et le groupe, on retrouve les articles du catalogue de la coopérative,
/// on indique les quantités puis le producteur qui les reçoit. Le catalogue est tenu à jour par l'administrateur (réseau nécessaire ;
/// le dernier catalogue reçu reste disponible hors connexion).
class DistributionScreen extends StatefulWidget {
  const DistributionScreen({super.key});
  @override
  State<DistributionScreen> createState() => _DistributionScreenState();
}

class _DistributionScreenState extends State<DistributionScreen> {
  List<Map<String, dynamic>> _articles = [];
  String? _category, _group;
  final Map<String, int> _qty = {};
  Map<String, Object?>? _producer;
  bool _fromCache = false, _busy = false;
  String? _msg;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = (await services.api.get('/distribution-articles') as List).cast<Map<String, dynamic>>();
      await services.db.setKv('distribution_articles', jsonEncode(r));
      if (mounted) setState(() { _articles = r; _fromCache = false; });
    } catch (_) {
      final c = await services.db.getKv('distribution_articles');
      if (c != null && mounted) setState(() { _articles = (jsonDecode(c) as List).cast<Map<String, dynamic>>(); _fromCache = true; });
    }
  }

  List<String> get _categories => {..._defaultGroups.keys, ..._articles.map((a) => '${a['category']}')}.toList();
  List<String> get _groups => _category == null ? [] : {...?_defaultGroups[_category], ..._articles.where((a) => a['category'] == _category).map((a) => '${a['group_name']}')}.toList();
  List<Map<String, dynamic>> get _list => _articles.where((a) => a['category'] == _category && a['group_name'] == _group).toList();
  List<Map<String, dynamic>> get _chosen => _articles.where((a) => (_qty[a['id']] ?? 0) > 0).toList();

  Future<void> _save() async {
    if (_chosen.isEmpty) { setState(() => _msg = 'Choisissez au moins un article.'); return; }
    if (_producer == null) { setState(() => _msg = 'Choisissez le producteur qui reçoit.'); return; }
    setState(() => _busy = true);
    final items = [for (final a in _chosen) {'article_id': a['id'], 'name': a['name'], 'unit': a['unit'], 'quantity': _qty[a['id']]}];
    await services.repo.queueFieldRecord(
      kind: 'distribution', title: items.map((i) => '${i['name']} × ${i['quantity']}').join(', '),
      data: {'category': _category, 'group': _group, 'items': items, 'producer_id': _producer!['id'], 'producer_name': '${_producer!['last_name']} ${_producer!['first_names']}'.trim()});
    services.sync.run();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final list = _category != null && _group != null ? _list : <Map<String, dynamic>>[];
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Distribution et services')),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Parcourir les articles', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
          const Text('Sélectionner les articles à distribuer aux agriculteurs', style: TextStyle(color: Colors.black54)),
          fieldLabel('Catégorie', required: true),
          FieldDropdown(value: _category, hint: 'Sélectionner la catégorie', items: _categories, onChanged: (v) => setState(() { _category = v; _group = null; _qty.clear(); })),
          fieldLabel('Groupe', required: true),
          FieldDropdown(value: _group, hint: 'Sélectionner le groupe', items: _groups, onChanged: (v) => setState(() { _group = v; _qty.clear(); })),
          if (_fromCache) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Hors connexion : dernier catalogue reçu.', style: TextStyle(color: Colors.black54, fontSize: 12))),
        ])),
        const SizedBox(height: 8),
        Expanded(child: Container(
          width: double.infinity, color: const Color(0xFFEAEAEA),
          child: list.isEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.manage_search, size: 90, color: Colors.black54),
                  const SizedBox(height: 8),
                  Text(_category == null || _group == null ? 'Choisir la catégorie et le groupe' : 'Aucun article disponible', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                  Text(_category == null || _group == null ? 'Sélectionnez une catégorie et un groupe pour charger la liste des articles disponibles pour la sélection.' : "Le catalogue de ce groupe est vide : l'administrateur de la coopérative doit y ajouter des articles.",
                      textAlign: TextAlign.center, style: const TextStyle(color: Colors.black54)),
                ])))
              : ListView(children: [
                  for (final a in list)
                    Padding(padding: const EdgeInsets.only(bottom: 1), child: Material(color: Colors.white, child: ListTile(
                      title: Text('${a['name']}'), subtitle: a['unit'] == null ? null : Text('${a['unit']}'),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(onPressed: (_qty[a['id']] ?? 0) > 0 ? () => setState(() => _qty[a['id']] = _qty[a['id']]! - 1) : null, icon: const Icon(Icons.remove_circle_outline)),
                        Text('${_qty[a['id']] ?? 0}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                        IconButton(onPressed: () => setState(() => _qty[a['id']] = (_qty[a['id']] ?? 0) + 1), icon: const Icon(Icons.add_circle_outline)),
                      ]),
                    ))),
                ]),
        )),
        if (list.isNotEmpty) Material(color: Colors.white, elevation: 8, child: Padding(padding: const EdgeInsets.all(10), child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_msg != null) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(_msg!, style: TextStyle(color: Colors.red.shade700))),
          OutlinedButton.icon(
            onPressed: () async { final p = await pickProducer(context); if (p != null) setState(() => _producer = p); },
            icon: const Icon(Icons.person_outline), style: OutlinedButton.styleFrom(minimumSize: const Size(double.infinity, 46)),
            label: Text(_producer == null ? 'Choisir le producteur' : '${_producer!['last_name']} ${_producer!['first_names']}'.trim().toUpperCase())),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _save, style: FilledButton.styleFrom(backgroundColor: fieldAction, minimumSize: const Size(double.infinity, 48)), child: const Text('ENREGISTRER LA DISTRIBUTION')),
        ]))),
      ]),
    );
  }
}
