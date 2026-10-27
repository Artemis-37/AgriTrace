import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../main.dart';
import 'field_widgets.dart';
import 'photo_capture.dart';

const _defaultGroups = <String, List<String>>{
  'Finance': ['Bourses', 'Crédit', 'Primes', 'Prêts', 'Subventions'],
  'Intrants et Outils': [],
  'Services et Dépistages': [],
};
const _currencies = {'Unités': 'unit', 'Franc CFA (FCFA)': 'XOF', 'Euro (€)': 'EUR', 'Dollar (\$)': 'USD'};

/// Un article choisi, avec sa devise (ou « Unités »).
class _Pick {
  final Map<String, dynamic> article;
  String currencyLabel = 'Unités';
  _Pick(this.article);
  String get id => '${article['id']}';
  String get name => '${article['name']}';
  String get group => '${article['group_name']}';
  String get suffix => currencyLabel == 'Unités' ? 'unités' : (currencyLabel.contains('FCFA') ? 'FCFA' : currencyLabel.contains('€') ? '€' : '\$');
}


/// Référence partagée du brouillon en cours (une seule entrée de brouillon pour toute la chaîne d'écrans).
class _DraftRef {
  String? id;
  _DraftRef([this.id]);
}

Map<String, Object?> _plain(Map<String, Object?> m) => {for (final e in m.entries) if (e.value == null || e.value is String || e.value is num || e.value is bool) e.key: e.value};

/// « Distribution et services » commencée mais pas terminée : conservée sur l'appareil, jamais envoyée tant qu'elle n'est pas enregistrée.
Future<void> _saveDistDraft(BuildContext context, _DraftRef ref, {required List<_Pick> picks, required String category, String? group,
    List<Map<String, Object?>> producers = const [], List<_Beneficiary>? people, int index = 0}) async {
  final prods = people != null ? [for (final b in people) b.producer] : producers;
  final title = '${category.isEmpty ? 'Distribution' : category}${picks.isEmpty ? '' : ' — ${picks.map((p) => p.name).join(', ')}'}';
  ref.id = await services.repo.saveDraft(id: ref.id, kind: 'distribution', title: title, producerIds: [for (final p in prods) '${p['id']}'], state: {
    'category': category, 'group': group ?? (picks.isEmpty ? null : picks.first.group), 'index': index,
    'picks': [for (final p in picks) {'article': p.article, 'currency': p.currencyLabel}],
    'producers': [for (final p in prods) _plain(p)],
    if (people != null) 'people': [for (final b in people) {
      'id': b.id, 'signature': b.signature == null ? null : base64Encode(b.signature!),
      'lines': {for (final e in b.lines.entries) e.key: {'qty': e.value.qty.text, 'proof': e.value.proofPath}},
    }],
  });
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Brouillon enregistré : distribution non terminée.')));
  Navigator.of(context).popUntil((r) => r.isFirst);
}

Widget _draftAction(VoidCallback onTap) => IconButton(onPressed: onTap, tooltip: 'Enregistrer en brouillon', icon: const Icon(Icons.save_outlined));

/// Ce que le bénéficiaire reçoit : quantité par article, preuves photo et signature.
class _Line {
  final qty = TextEditingController();
  String? proofPath;
}

class _Beneficiary {
  final Map<String, Object?> producer;
  final Map<String, _Line> lines = {};
  Uint8List? signature;
  _Beneficiary(this.producer);
  String get id => '${producer['id']}';
  String get name => '${producer['last_name'] ?? ''} ${producer['first_names'] ?? ''}'.trim().toUpperCase();
  String get code => '${producer['internal_code'] ?? ''}';
}

/// Distribution et services — étape 1 : « Parcourir les articles ».
/// Catégorie, groupe, recherche, cases à cocher, articles choisis affichés en pastilles.
/// Le catalogue est tenu par l'administrateur (réseau nécessaire ; le dernier catalogue reçu reste disponible hors connexion).
class DistributionScreen extends StatefulWidget {
  const DistributionScreen({super.key, this.draft});
  final Map<String, dynamic>? draft;
  @override
  State<DistributionScreen> createState() => _DistributionScreenState();
}

class _DistributionScreenState extends State<DistributionScreen> {
  List<Map<String, dynamic>> _articles = [];
  String? _category, _group;
  String _q = '';
  final Map<String, Map<String, dynamic>> _chosen = {};
  bool _fromCache = false;
  late final _DraftRef _ref = _DraftRef(widget.draft?['id'] as String?);

  @override
  void initState() {
    super.initState();
    _load();
    if (widget.draft != null) WidgetsBinding.instance.addPostFrameCallback((_) => _resume());
  }

  /// Reprend le brouillon là où il s'est arrêté (bénéficiaires ou configuration), l'étape 1 est restaurée derrière.
  Future<void> _resume() async {
    final st = Map<String, dynamic>.from((widget.draft!['state'] as Map?) ?? const {});
    final picks = <_Pick>[for (final p in (st['picks'] as List? ?? const [])) _Pick(Map<String, dynamic>.from((p as Map)['article'] as Map))..currencyLabel = '${p['currency'] ?? 'Unités'}'];
    final category = '${st['category'] ?? ''}';
    setState(() {
      _category = category.isEmpty ? null : category; _group = st['group'] as String?;
      _chosen..clear()..addAll({for (final p in picks) p.id: p.article});
    });
    final producers = [for (final p in (st['producers'] as List? ?? const [])) Map<String, Object?>.from(p as Map)];
    if (picks.isEmpty || producers.isEmpty) return;
    final saved = {for (final p in (st['people'] as List? ?? const [])) '${(p as Map)['id']}': Map<String, dynamic>.from(p)};
    Widget next;
    if (saved.isEmpty) {
      next = _BeneficiariesScreen(ref: _ref, picks: picks, category: category, initial: producers);
    } else {
      final people = <_Beneficiary>[];
      for (final prod in producers) {
        final b = _Beneficiary(prod);
        final d = saved['${prod['id']}'];
        for (final p in picks) {
          final line = _Line();
          final l = (d?['lines'] as Map?)?[p.id] as Map?;
          if (l != null) { line.qty.text = '${l['qty'] ?? ''}'; line.proofPath = l['proof'] as String?; }
          b.lines[p.id] = line;
        }
        if (d?['signature'] != null) b.signature = base64Decode(d!['signature'] as String);
        people.add(b);
      }
      next = _ConfigScreen(ref: _ref, picks: picks, category: category, people: people, initialIndex: ((st['index'] as num?)?.toInt() ?? 0).clamp(0, people.length - 1));
    }
    if (!mounted) return;
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => next));
    if (done == true && mounted) Navigator.of(context).pop(true);
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

  // Les catégories et groupes viennent du catalogue de la coopérative (tenu par l'ADG) ; les valeurs de départ ne servent que si le catalogue est vide.
  List<String> get _categories => _articles.isEmpty ? _defaultGroups.keys.toList() : {..._articles.map((a) => '${a['category']}')}.toList();
  List<String> get _groups => _category == null ? [] : _articles.isEmpty ? [...?_defaultGroups[_category]] : {..._articles.where((a) => a['category'] == _category).map((a) => '${a['group_name']}')}.toList();
  List<Map<String, dynamic>> get _list => _articles.where((a) => a['category'] == _category && a['group_name'] == _group && (_q.isEmpty || '${a['name']}'.toLowerCase().contains(_q.toLowerCase()))).toList();

  Future<void> _next() async {
    final picks = [for (final a in _chosen.values) _Pick(a)];
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _VerifyScreen(ref: _ref, picks: picks, category: _category ?? '')));
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final ready = _category != null && _group != null;
    final list = ready ? _list : <Map<String, dynamic>>[];
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Parcourir les articles'), actions: [_draftAction(() => _saveDistDraft(context, _ref, picks: [for (final a in _chosen.values) _Pick(a)], category: _category ?? '', group: _group))]),
      body: Column(children: [
        Expanded(child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 12), children: [
          const Text('Parcourir les articles', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
          const Text('Sélectionner les articles à distribuer aux agriculteurs', style: TextStyle(color: Colors.black54)),
          fieldLabel('Catégorie', required: true),
          FieldDropdown(value: _category, hint: 'Sélectionner la catégorie', items: _categories, onChanged: (v) => setState(() { _category = v; _group = null; _chosen.clear(); })),
          fieldLabel('Groupe', required: true),
          FieldDropdown(value: _group, hint: 'Sélectionner le groupe', items: _groups, onChanged: (v) => setState(() { _group = v; _chosen.clear(); })),
          if (_fromCache) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Hors connexion : dernier catalogue reçu.', style: TextStyle(color: Colors.black54, fontSize: 12))),
          if (ready) ...[
            const SizedBox(height: 12),
            TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(
              hintText: 'Rechercher des articles…', filled: true, fillColor: const Color(0xFFEEEEEE), suffixIcon: const Icon(Icons.search),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(28), borderSide: BorderSide.none), contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14))),
            const SizedBox(height: 12),
            Row(children: [Expanded(child: Text(_group!, style: const TextStyle(fontWeight: FontWeight.w800, color: Colors.black54, fontSize: 16))), Text("Total des articles: ${_articles.where((a) => a['category'] == _category && a['group_name'] == _group).length}", style: const TextStyle(color: Colors.black54))]),
            if (_chosen.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Wrap(spacing: 8, runSpacing: 4, children: [
              for (final a in _chosen.values) InputChip(label: Text('${a['name']}'), onDeleted: () => setState(() => _chosen.remove(a['id']))),
            ])),
            const SizedBox(height: 10),
            if (list.isEmpty) Padding(padding: const EdgeInsets.all(20), child: Center(child: Text("Aucun article dans ce groupe : l'administrateur de la coopérative doit l'ajouter au catalogue.", textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade700))))
            else Material(
              color: Colors.white, shape: RoundedRectangleBorder(side: BorderSide(color: Colors.grey.shade400, width: 2), borderRadius: BorderRadius.circular(28)),
              child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Column(children: [
                for (final a in list) CheckboxListTile(
                  controlAffinity: ListTileControlAffinity.leading, title: Text('${a['name']}', style: const TextStyle(fontSize: 17)),
                  value: _chosen.containsKey(a['id']), onChanged: (v) => setState(() { if (v == true) { _chosen['${a['id']}'] = a; } else { _chosen.remove(a['id']); } })),
              ])),
            ),
          ] else ...[
            const SizedBox(height: 60),
            const Icon(Icons.manage_search, size: 90, color: Colors.black45),
            const Center(child: Text('Choisir la catégorie et le groupe', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
            const Center(child: Text('Sélectionnez une catégorie et un groupe pour charger la liste des articles disponibles pour la sélection.', textAlign: TextAlign.center, style: TextStyle(color: Colors.black54))),
          ],
        ])),
        if (_chosen.isNotEmpty) _BottomButton("VOIR L'ARTICLE SÉLECTIONNÉ (${_chosen.length})", _next),
      ]),
    );
  }
}

class _BottomButton extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  const _BottomButton(this.label, this.onTap);
  @override
  Widget build(BuildContext context) => SafeArea(top: false, child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
        child: FilledButton(onPressed: onTap, style: FilledButton.styleFrom(backgroundColor: fieldGreen, minimumSize: const Size(double.infinity, 54), shape: const StadiumBorder()), child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
      ));
}

/// Étape 2 : « Vérifier les articles » — devise (ou unités) de chaque article.
class _VerifyScreen extends StatefulWidget {
  final _DraftRef ref;
  final List<_Pick> picks;
  final String category;
  const _VerifyScreen({required this.ref, required this.picks, required this.category});
  @override
  State<_VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends State<_VerifyScreen> {
  @override
  Widget build(BuildContext context) {
    final n = widget.picks.length;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text("Vérifier l'article"), actions: [_draftAction(() => _saveDistDraft(context, widget.ref, picks: widget.picks, category: widget.category))]),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 8), child: Row(children: [
          const CircleAvatar(radius: 30, backgroundColor: Color(0xFFE8F3E4), child: Icon(Icons.view_list, color: fieldGreen, size: 30)),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Article de distribution', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
            Text('$n article${n > 1 ? 's' : ''} de ${widget.category} prêt${n > 1 ? 's' : ''} à distribuer', style: const TextStyle(color: Colors.black54)),
          ])),
        ])),
        Expanded(child: ListView(padding: const EdgeInsets.all(16), children: [
          for (final p in widget.picks) Container(
            margin: const EdgeInsets.only(bottom: 12), padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(28), border: Border.all(color: const Color(0xFFDDDDDD))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              Text('Groupe : ${p.group}', style: const TextStyle(color: Colors.black54, fontSize: 16)),
              fieldLabel('Devise', required: true),
              FieldDropdown(value: p.currencyLabel, hint: 'Devise', items: _currencies.keys.toList(), onChanged: (v) => setState(() => p.currencyLabel = v ?? p.currencyLabel)),
            ]),
          ),
        ])),
        _BottomButton('CONTINUER VERS LES AGRICULTEURS', () async {
          final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _BeneficiariesScreen(ref: widget.ref, picks: widget.picks, category: widget.category)));
          if (done == true && context.mounted) Navigator.of(context).pop(true);
        }),
      ]),
    );
  }
}

/// Étape 3 : « Sélectionner les bénéficiaires » (recherche, section, rôle, cases à cocher).
class _BeneficiariesScreen extends StatefulWidget {
  final _DraftRef ref;
  final List<_Pick> picks;
  final String category;
  final List<Map<String, Object?>> initial;
  const _BeneficiariesScreen({required this.ref, required this.picks, required this.category, this.initial = const []});
  @override
  State<_BeneficiariesScreen> createState() => _BeneficiariesScreenState();
}

class _BeneficiariesScreenState extends State<_BeneficiariesScreen> {
  List<Map<String, Object?>> _rows = [];
  final Map<String, Map<String, Object?>> _sel = {};
  String _q = '';
  String? _section;

  @override
  void initState() {
    super.initState();
    for (final p in widget.initial) { _sel['${p['id']}'] = p; }
    _find();
  }

  Future<void> _find() async {
    final r = await services.repo.searchProducers(_q);
    if (mounted) setState(() => _rows = r);
  }

  List<String> get _sections => {..._rows.map((r) => '${r['section'] ?? ''}').where((s) => s.isNotEmpty)}.toList()..sort();

  @override
  Widget build(BuildContext context) {
    final rows = _rows.where((r) => _section == null || r['section'] == _section).toList();
    final n = _sel.length;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Sélectionner les bénéficiaires'), actions: [_draftAction(() => _saveDistDraft(context, widget.ref, picks: widget.picks, category: widget.category, producers: _sel.values.toList()))]),
      body: Column(children: [
        FieldBand('Sélection des bénéficiaires', children: [
          const Text('Sélectionner le bénéficiaire pour la distribution', style: TextStyle(color: Colors.white)),
          const SizedBox(height: 10),
          TextField(onChanged: (v) { _q = v; _find(); }, decoration: fieldDeco('Rechercher par nom ou code du bénéficiaire').copyWith(filled: true, fillColor: Colors.white, suffixIcon: const Icon(Icons.search))),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: DropdownButtonFormField<String>(value: _sections.contains(_section) ? _section : null, isExpanded: true, decoration: fieldDeco('').copyWith(filled: true, fillColor: Colors.white), hint: const Text('Sélectionnez la section'),
                items: [for (final s in _sections) DropdownMenuItem(value: s, child: Text(s))], onChanged: (v) => setState(() => _section = v))),
            const SizedBox(width: 8),
            Expanded(child: DropdownButtonFormField<String>(value: 'Agriculteur principal', isExpanded: true, decoration: fieldDeco('').copyWith(filled: true, fillColor: Colors.white), hint: const Text('Rôle'),
                items: const [DropdownMenuItem(value: 'Agriculteur principal', child: Text('Agriculteur principal', overflow: TextOverflow.ellipsis))], onChanged: (_) {})),
          ]),
        ]),
        Expanded(child: ListView(padding: const EdgeInsets.all(12), children: [
          if (rows.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Aucun producteur. Synchronisez pour charger la liste.'))),
          for (final r in rows) Container(
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(color: _sel.containsKey(r['id']) ? const Color(0xFFF1F8EE) : Colors.white, border: Border.all(color: _sel.containsKey(r['id']) ? fieldGreen : Colors.grey.shade400), borderRadius: BorderRadius.circular(4)),
            child: Material(type: MaterialType.transparency, child: CheckboxListTile(
              controlAffinity: ListTileControlAffinity.leading, value: _sel.containsKey(r['id']),
              title: Text('${r['last_name'] ?? ''} ${r['first_names'] ?? ''}'.trim().toUpperCase(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              subtitle: Text('Agriculteur principal\n${r['internal_code'] ?? ''}'),
              isThreeLine: true,
              onChanged: (v) => setState(() { if (v == true) { _sel['${r['id']}'] = r; } else { _sel.remove(r['id']); } }),
            )),
          ),
        ])),
        Container(color: const Color(0xFFEDEDED), padding: const EdgeInsets.fromLTRB(16, 10, 24, 0), child: Row(children: [
          const Expanded(child: Text('Sélectionné :', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: Colors.black54))),
          Text('$n', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: fieldGreen)),
        ])),
        Container(color: const Color(0xFFEDEDED), child: _BottomButton('CONTINUER AVEC ${n == 0 ? 'LES BÉNÉFICIAIRES' : n == 1 ? 'LE (1) BÉNÉFICIAIRE' : 'LES ($n) BÉNÉFICIAIRES'}', n == 0 ? null : () async {
          final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _ConfigScreen(ref: widget.ref, picks: widget.picks, category: widget.category, people: [for (final p in _sel.values) _Beneficiary(p)])));
          if (done == true && context.mounted) Navigator.of(context).pop(true);
        })),
      ]),
    );
  }
}

/// Étape 4 : « Configuration de la distribution » — pour chaque bénéficiaire : quantités, preuve photo, signature.
class _ConfigScreen extends StatefulWidget {
  final _DraftRef ref;
  final List<_Pick> picks;
  final String category;
  final List<_Beneficiary> people;
  final int initialIndex;
  const _ConfigScreen({required this.ref, required this.picks, required this.category, required this.people, this.initialIndex = 0});
  @override
  State<_ConfigScreen> createState() => _ConfigScreenState();
}

class _ConfigScreenState extends State<_ConfigScreen> {
  late int _i = widget.initialIndex;
  String? _msg;

  _Beneficiary get _b => widget.people[_i];

  @override
  void initState() {
    super.initState();
    for (final b in widget.people) { for (final p in widget.picks) { b.lines.putIfAbsent(p.id, () => _Line()); } }
  }

  String? _check() {
    for (final p in widget.picks) {
      final v = double.tryParse(_b.lines[p.id]!.qty.text.replaceAll(',', '.'));
      if (v == null || v <= 0) return "Indiquez le nombre d'article pour « ${p.name} ».";
    }
    if (_b.signature == null) return 'La signature du bénéficiaire est obligatoire.';
    return null;
  }

  Future<void> _sign() async {
    final b = await askSignature(context);
    if (b != null) setState(() => _b.signature = b);
  }

  Future<void> _proof(_Pick p) async {
    final path = await takePhotoPath();
    if (path != null && mounted) setState(() => _b.lines[p.id]!.proofPath = path);
  }

  Future<void> _next() async {
    final e = _check();
    if (e != null) { setState(() => _msg = e); return; }
    setState(() => _msg = null);
    if (_i + 1 < widget.people.length) { setState(() => _i++); return; }
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _ReviewScreen(ref: widget.ref, picks: widget.picks, category: widget.category, people: widget.people)));
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.people.length;
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Configuration de la distribution'), actions: [_draftAction(() => _saveDistDraft(context, widget.ref, picks: widget.picks, category: widget.category, people: widget.people, index: _i))]),
      body: Column(children: [
        Container(color: Colors.white, padding: const EdgeInsets.fromLTRB(16, 12, 16, 10), child: Column(children: [
          Row(children: [
            const CircleAvatar(backgroundColor: Color(0xFFE8F3E4), child: Icon(Icons.person_outline, color: fieldGreen)),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_b.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
              Text('Code : ${_b.code}', style: const TextStyle(color: Colors.black54)),
            ])),
            Text('${_i + 1} sur $total', style: const TextStyle(color: Colors.black54)),
          ]),
          const SizedBox(height: 10),
          LinearProgressIndicator(value: (_i + 1) / total, minHeight: 5, color: fieldGreen, backgroundColor: const Color(0xFFDDDDDD)),
        ])),
        Expanded(child: ListView(padding: const EdgeInsets.all(12), children: [
          for (final p in widget.picks) Container(
            margin: const EdgeInsets.only(bottom: 12), padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
              Text('Groupe : ${p.group}', style: const TextStyle(color: Colors.black54)),
              fieldLabel("Nombre d'article", required: true),
              TextField(controller: _b.lines[p.id]!.qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: fieldDeco('0.00').copyWith(suffixText: p.suffix, suffixStyle: const TextStyle(fontWeight: FontWeight.w800))),
              fieldLabel('Capture de preuve'),
              InkWell(
                onTap: () => _proof(p),
                child: Container(
                  height: 100, width: double.infinity, alignment: Alignment.center,
                  decoration: BoxDecoration(color: const Color(0xFFF7FAF2), border: Border.all(color: Colors.grey.shade400), borderRadius: BorderRadius.circular(20)),
                  child: _b.lines[p.id]!.proofPath == null
                      ? const Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.upload, color: Colors.black54), SizedBox(height: 6), Text('Télécharger une preuve photographique', style: TextStyle(fontWeight: FontWeight.w700, color: Colors.black54))])
                      : ClipRRect(borderRadius: BorderRadius.circular(18), child: Image.file(File(_b.lines[p.id]!.proofPath!), height: 96, fit: BoxFit.cover)),
                ),
              ),
            ]),
          ),
          if (_msg != null) Padding(padding: const EdgeInsets.fromLTRB(4, 0, 4, 8), child: Text(_msg!, style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w600))),
        ])),
        Container(margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(32)), child: Row(children: [
          const Text('Signature', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          const Spacer(),
          if (_b.signature != null) Padding(padding: const EdgeInsets.only(right: 12), child: SizedBox(width: 70, height: 34, child: Image.memory(_b.signature!, fit: BoxFit.contain))),
          InkWell(onTap: _sign, child: Text(_b.signature == null ? 'Capturer' : 'Refaire', style: const TextStyle(color: fieldGreen, fontWeight: FontWeight.w800, decoration: TextDecoration.underline, fontSize: 16))),
        ])),
        SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 10), child: Row(children: [
          Expanded(child: OutlinedButton(
            onPressed: () { if (_i > 0) { setState(() => _i--); } else { Navigator.of(context).pop(); } },
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 54), shape: const StadiumBorder(), side: const BorderSide(color: fieldGreen, width: 2), foregroundColor: fieldGreen), child: const Text('ARRIÈRE', style: TextStyle(fontWeight: FontWeight.w700)))),
          const SizedBox(width: 12),
          Expanded(child: FilledButton(onPressed: _next, style: FilledButton.styleFrom(backgroundColor: fieldGreen, minimumSize: const Size(0, 54), shape: const StadiumBorder()), child: Text(_i + 1 < total ? 'SUIVANT' : 'CONFIRMER ET RÉVISER', style: const TextStyle(fontWeight: FontWeight.w700)))),
        ]))),
      ]),
    );
  }
}

/// Révision finale avant enregistrement : un dossier de distribution par bénéficiaire, conservé sur l'appareil puis envoyé.
class _ReviewScreen extends StatefulWidget {
  final _DraftRef ref;
  final List<_Pick> picks;
  final String category;
  final List<_Beneficiary> people;
  const _ReviewScreen({required this.ref, required this.picks, required this.category, required this.people});
  @override
  State<_ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<_ReviewScreen> {
  bool _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    for (final b in widget.people) {
      final items = [
        for (final p in widget.picks)
          {'article_id': p.id, 'name': p.name, 'group': p.group, 'currency': _currencies[p.currencyLabel], 'quantity': double.parse(b.lines[p.id]!.qty.text.replaceAll(',', '.'))},
      ];
      final id = await services.repo.queueFieldRecord(
        kind: 'distribution', title: '${widget.category} — ${widget.picks.map((p) => p.name).join(', ')}',
        data: {'category': widget.category, 'items': items, 'producer_id': b.id, 'producer_name': b.name});
      for (final p in widget.picks) {
        final path = b.lines[p.id]!.proofPath;
        if (path != null) await services.repo.queuePhoto(subjectType: 'field_record', subjectId: id, kind: 'Preuve de distribution', sourcePath: path);
      }
      final sig = File('${Directory.systemTemp.path}/signature-dist-$id.png');
      await sig.writeAsBytes(b.signature!);
      await services.repo.queuePhoto(subjectType: 'field_record', subjectId: id, kind: 'Signature du bénéficiaire', sourcePath: sig.path);
    }
    await services.repo.deleteDraft(widget.ref.id);
    services.sync.run();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF7FAF2),
        appBar: AppBar(title: const Text('Réviser la distribution'), actions: [_draftAction(() => _saveDistDraft(context, widget.ref, picks: widget.picks, category: widget.category, people: widget.people, index: widget.people.length - 1))]),
        body: Column(children: [
          Expanded(child: ListView(padding: const EdgeInsets.all(12), children: [
            for (final b in widget.people) Container(
              margin: const EdgeInsets.only(bottom: 12), padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(b.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                Text('Code : ${b.code}', style: const TextStyle(color: Colors.black54)),
                const Divider(),
                for (final p in widget.picks) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(children: [
                  Expanded(child: Text(p.name)), Text('${b.lines[p.id]!.qty.text} ${p.suffix}', style: const TextStyle(fontWeight: FontWeight.w800)),
                  if (b.lines[p.id]!.proofPath != null) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.photo_camera_outlined, size: 16, color: fieldGreen)),
                ])),
                const SizedBox(height: 6),
                Row(children: [const Text('Signature : '), if (b.signature != null) SizedBox(width: 80, height: 32, child: Image.memory(b.signature!, fit: BoxFit.contain))]),
              ]),
            ),
          ])),
          _BottomButton(_busy ? 'ENREGISTREMENT…' : 'ENREGISTRER LA DISTRIBUTION', _busy ? null : _save),
        ]),
      );
}
