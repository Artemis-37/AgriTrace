import 'package:flutter/material.dart';

import '../main.dart';
import 'field_widgets.dart';

enum _T { text, number, select }

class _Q {
  final String key, label;
  final _T type;
  final bool required;
  final List<String> options;
  const _Q(this.key, this.label, this.type, {this.required = true, this.options = const []});
}

const _yesNo = ['Oui', 'Non'];
const _school = <_Q>[
  _Q('nom', "Nom de l'école", _T.text),
  _Q('niveau', 'Niveau académique', _T.select, options: ['Maternelle', 'Primaire', 'Collège', 'Lycée']),
  _Q('type', "Type d'école", _T.select, options: ['Publique', 'Privée', 'Communautaire']),
  _Q('capacite', 'Capacité totale', _T.number),
  _Q('genre', 'Genre', _T.select, options: ['Mixte', 'Filles', 'Garçons']),
  _Q('classes', 'Nombre de classes', _T.number),
  _Q('inscrits_garcons', "Nombre d'étudiants inscrits", _T.number),
  _Q('inscrites_filles', "Nombre d'étudiantes inscrites", _T.number),
  _Q('enseignants', "Nombre d'enseignants", _T.number),
  _Q('frais', 'Frais de scolarité par an', _T.number),
  _Q('cantine', "L'école dispose-t-elle d'une cantine opérationnelle ?", _T.select, options: _yesNo),
  _Q('latrines', "L'école dispose-t-elle des latrines fonctionnelles ?", _T.select, options: _yesNo),
  _Q('pct_classe_suivante', "Pourcentage d'élèves ayant passé à la classe suivante (au cours de la dernière année scolaire)", _T.number),
  _Q('pct_examen', "Pourcentage d'élèves ayant passé l'examen CM2 ou ayant passé au lycée (au cours de la dernière année scolaire)", _T.number),
  _Q('finance_partenaire', 'Financé par un partenaire ?', _T.select, required: false, options: _yesNo),
  _Q('annee_ouverture', "Année d'ouverture", _T.number),
  _Q('finance_prime', 'Financé par la prime au cacao ?', _T.select, required: false, options: _yesNo),
];

/// Ajouter une infrastructure sociale (école) avec sa position GPS. Conservée sur l'appareil puis envoyée à la synchronisation.
class SocialInfraScreen extends StatefulWidget {
  const SocialInfraScreen({super.key});
  @override
  State<SocialInfraScreen> createState() => _SocialInfraScreenState();
}

class _SocialInfraScreenState extends State<SocialInfraScreen> {
  final _name = TextEditingController(), _region = TextEditingController(), _village = TextEditingController(), _section = TextEditingController();
  final Map<String, TextEditingController> _ctl = {for (final q in _school) q.key: TextEditingController()};
  final Map<String, String?> _sel = {};
  double? _lat, _lon;
  bool _locating = false, _busy = false;
  String? _msg, _org;

  @override
  void initState() {
    super.initState();
    services.repo.identity().then((i) { if (mounted) setState(() => _org = i.org); });
    _locate();
  }

  @override
  void dispose() {
    _name.dispose(); _region.dispose(); _village.dispose(); _section.dispose();
    for (final c in _ctl.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _locate() async {
    setState(() { _locating = true; _msg = null; });
    final r = await readPosition();
    if (!mounted) return;
    setState(() { _locating = false; if (r.pos != null) { _lat = r.pos!.latitude; _lon = r.pos!.longitude; } else { _msg = r.error; } });
  }

  String? get _problem {
    for (final q in _school) {
      if (!q.required) continue;
      final v = q.type == _T.select ? _sel[q.key] : _ctl[q.key]!.text.trim();
      if (v == null || v.isEmpty) return 'Réponse obligatoire : ${q.label}';
      if (q.type == _T.number && double.tryParse(v.replaceAll(',', '.')) == null) return 'Nombre invalide : ${q.label}';
    }
    if (_lat == null || _lon == null) return "La position GPS de l'infrastructure est obligatoire.";
    return null;
  }

  Future<void> _save() async {
    final p = _problem;
    if (p != null) { setState(() => _msg = p); return; }
    setState(() => _busy = true);
    final data = <String, Object?>{'type': 'Ecole', 'region': _region.text.trim(), 'section': _section.text.trim(), 'village': _village.text.trim()};
    for (final q in _school) {
      final v = q.type == _T.select ? _sel[q.key] : _ctl[q.key]!.text.trim();
      if (v == null || v.isEmpty) continue;
      data[q.key] = q.type == _T.number ? num.parse(v.replaceAll(',', '.')) : v;
    }
    final title = _name.text.trim().isEmpty ? _ctl['nom']!.text.trim() : _name.text.trim();
    await services.repo.queueFieldRecord(kind: 'social_infrastructure', title: title, latitude: _lat, longitude: _lon, data: data);
    services.sync.run();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Ajouter une infrastructure sociale')),
      body: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        FieldBand('Ajouter une infrastructure sociale', children: [
          const FieldDropdown(value: 'Ecole', hint: 'Type', items: ['Ecole'], onChanged: null),
          const SizedBox(height: 8),
          TextField(controller: _name, decoration: fieldDeco('Nom').copyWith(filled: true, fillColor: Colors.white)),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: InputDecorator(decoration: fieldDeco('').copyWith(filled: true, fillColor: Colors.white),
                child: Text(_lat == null ? 'Position GPS…' : '${_lat!.toStringAsFixed(7)},${_lon!.toStringAsFixed(7)}', style: const TextStyle(color: fieldGreen)))),
            const SizedBox(width: 10),
            IconButton.filled(onPressed: _locating ? null : _locate, style: IconButton.styleFrom(backgroundColor: const Color(0xFFF58A1F), foregroundColor: Colors.white),
                icon: _locating ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.my_location)),
          ]),
        ]),
        for (var i = 0; i < _school.length; i++) FieldCard(child: _question(i + 1, _school[i])),
        FieldCard(title: 'Localité et coopérative', child: Column(children: [
          TextField(controller: _region, decoration: fieldDeco('Région')),
          const SizedBox(height: 8),
          TextField(controller: _village, decoration: fieldDeco('Village ou quartier')),
          const SizedBox(height: 8),
          TextField(controller: _section, decoration: fieldDeco('Section')),
          const SizedBox(height: 8),
          InputDecorator(decoration: fieldDeco('').copyWith(filled: true, fillColor: const Color(0xFFEEEEEE)), child: Text(_org == null || _org!.isEmpty ? 'Ma coopérative' : _org!)),
        ])),
        if (_msg != null) Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: Text(_msg!, style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w600))),
        Align(alignment: Alignment.centerRight, child: Padding(padding: const EdgeInsets.fromLTRB(12, 12, 12, 0), child: FilledButton(
          onPressed: _busy ? null : _save, style: FilledButton.styleFrom(backgroundColor: fieldAction, padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14)), child: const Text('SAUVEGARDER')))),
      ]),
    );
  }

  Widget _question(int n, _Q q) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text.rich(TextSpan(text: '$n. ${q.label}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15), children: [if (q.required) const TextSpan(text: ' *', style: TextStyle(color: Colors.red))])),
        const SizedBox(height: 8),
        if (q.type == _T.select)
          FieldDropdown(value: _sel[q.key], hint: 'Réponse', items: q.options, onChanged: (v) => setState(() => _sel[q.key] = v))
        else
          TextField(controller: _ctl[q.key], keyboardType: q.type == _T.number ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text, decoration: fieldDeco('Réponse')),
      ]);
}
