import 'package:flutter/material.dart';

import '../data/field_templates.dart';
import '../main.dart';
import 'field_widgets.dart';

/// Ajouter une infrastructure sociale (école) avec sa position GPS. Conservée sur l'appareil puis envoyée à la synchronisation.
class SocialInfraScreen extends StatefulWidget {
  const SocialInfraScreen({super.key});
  @override
  State<SocialInfraScreen> createState() => _SocialInfraScreenState();
}

class _SocialInfraScreenState extends State<SocialInfraScreen> {
  final _name = TextEditingController(), _region = TextEditingController(), _village = TextEditingController(), _section = TextEditingController();
  final Map<String, TextEditingController> _ctl = {};
  final Map<String, String?> _sel = {};
  FieldTemplateSet? _tpl;
  InfraTemplate? _cat;
  double? _lat, _lon;
  bool _locating = false, _busy = false;
  String? _msg, _org;

  @override
  void initState() {
    super.initState();
    services.repo.identity().then((i) { if (mounted) setState(() => _org = i.org); });
    FieldTemplates.load().then((t) { if (mounted) setState(() { _tpl = t; if (t.infrastructures.length == 1) _choose(t.infrastructures.first); }); });
    _locate();
  }

  void _choose(InfraTemplate? c) {
    for (final x in _ctl.values) { x.dispose(); }
    _ctl.clear(); _sel.clear();
    _cat = c;
    if (c != null) { for (final q in c.questions) { _ctl[q.key] = TextEditingController(); } }
  }

  List<TemplateQuestion> get _qs => _cat?.questions ?? const [];

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
    if (_cat == null) return "Choisissez le type d'infrastructure.";
    for (final q in _qs) {
      if (!q.required) continue;
      final v = q.type == 'select' ? _sel[q.key] : _ctl[q.key]!.text.trim();
      if (v == null || v.isEmpty) return 'Réponse obligatoire : ${q.label}';
      if (q.type == 'number' && double.tryParse(v.replaceAll(',', '.')) == null) return 'Nombre invalide : ${q.label}';
    }
    if (_lat == null || _lon == null) return "La position GPS de l'infrastructure est obligatoire.";
    return null;
  }

  Future<void> _save() async {
    final p = _problem;
    if (p != null) { setState(() => _msg = p); return; }
    setState(() => _busy = true);
    final data = <String, Object?>{'type': _cat!.category, 'category': _cat!.category, 'region': _region.text.trim(), 'section': _section.text.trim(), 'village': _village.text.trim()};
    for (final q in _qs) {
      final v = q.type == 'select' ? _sel[q.key] : _ctl[q.key]!.text.trim();
      if (v == null || v.isEmpty) continue;
      data[q.key] = q.type == 'number' ? num.parse(v.replaceAll(',', '.')) : v;
    }
    final nom = (_ctl['nom']?.text ?? '').trim();
    final title = _name.text.trim().isNotEmpty ? _name.text.trim() : nom.isNotEmpty ? nom : _cat!.category;
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
          FieldDropdown(value: _cat?.category, hint: 'Type', items: [for (final c in _tpl?.infrastructures ?? const <InfraTemplate>[]) c.category],
              onChanged: (v) => setState(() => _choose(_tpl?.infrastructures.where((c) => c.category == v).firstOrNull))),
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
        if (_cat == null) const Padding(padding: EdgeInsets.all(20), child: Text("Choisissez le type d'infrastructure pour afficher son questionnaire.", style: TextStyle(color: Colors.black54))),
        for (var i = 0; i < _qs.length; i++) FieldCard(child: _question(i + 1, _qs[i])),
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

  Widget _question(int n, TemplateQuestion q) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text.rich(TextSpan(text: '$n. ${q.label}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15), children: [if (q.required) const TextSpan(text: ' *', style: TextStyle(color: Colors.red))])),
        const SizedBox(height: 8),
        if (q.type == 'select')
          FieldDropdown(value: _sel[q.key], hint: 'Réponse', items: q.options, onChanged: (v) => setState(() => _sel[q.key] = v))
        else
          TextField(controller: _ctl[q.key], keyboardType: q.type == 'number' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text, decoration: fieldDeco('Réponse')),
      ]);
}
