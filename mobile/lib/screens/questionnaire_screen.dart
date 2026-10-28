import 'package:flutter/material.dart';

import '../main.dart';

const _green = Color(0xFF0B5E3B);
const _action = Color(0xFF3F9B2E);

/// Questionnaire (tâche) à renseigner auprès du producteur : les réponses sont conservées sur l'appareil puis envoyées à la synchronisation.
/// [assignment] : élément du profil (title, instructions, questions, answers, status, target_id).
class QuestionnaireScreen extends StatefulWidget {
  final Map<String, dynamic> assignment;
  final Map<String, Object?> producer;
  const QuestionnaireScreen({super.key, required this.assignment, required this.producer, this.draft});
  /// Brouillon « non terminé » à reprendre (réponses déjà saisies).
  final Map<String, dynamic>? draft;
  @override
  State<QuestionnaireScreen> createState() => _QuestionnaireScreenState();
}

class _QuestionnaireScreenState extends State<QuestionnaireScreen> {
  final Map<String, dynamic> _ans = {};
  final Map<String, TextEditingController> _ctl = {};
  String? _error;
  bool _busy = false;
  String? _draftId;

  // ---- Inspection interne : champs renseignés automatiquement (comme le serveur) ----
  static final _req = RegExp(r'^(\d+(?:\.\d+)+)\s*(EF|ES|EAC)?\s*[—–-]\s*([\s\S]*)$');
  bool _isEval(Map<String, dynamic> q) {
    final o = ((q['options'] as List?) ?? const []).map((e) => '$e').toList();
    return q['type'] == 'choice' && o.contains('Conforme') && o.contains('Non conforme');
  }
  bool get _hasScore => _questions.any(_isEval);
  bool _isNcQ(Map<String, dynamic> q) => RegExp(r'^Non-conformités relevées', caseSensitive: false).hasMatch('${q['label']}');
  bool _isDecisionQ(Map<String, dynamic> q) => RegExp(r'^Recommandation de l.inspecteur', caseSensitive: false).hasMatch('${q['label']}');
  bool _isSketchQ(Map<String, dynamic> q) => RegExp(r'^Croquis de l.exploitation', caseSensitive: false).hasMatch('${q['label']}');
  bool _auto(Map<String, dynamic> q) => _hasScore && (_isNcQ(q) || _isDecisionQ(q) || _isSketchQ(q));

  ({int c, int nc, double? score, List<String> lines}) _eval(Map<String, dynamic> ans) {
    var c = 0, nc = 0;
    final lines = <String>[];
    for (var i = 0; i < _questions.length; i++) {
      final q = _questions[i];
      if (!_isEval(q)) continue;
      final a = ans['${q['id']}'];
      if (a == 'Conforme') { c++; }
      else if (a == 'Non conforme') {
        nc++;
        final label = '${q['label']}'.trim();
        final m = _req.firstMatch(label);
        final o = '${ans['obs.${q['id']}'] ?? ''}'.trim();
        var text = (o.isNotEmpty ? o : (m != null ? m.group(3)! : label)).replaceAll(RegExp(r'\s+'), ' ').replaceAll('*', '').trim();
        if (text.length > 200) text = '${text.substring(0, 197)}…';
        lines.add('${m != null ? '${m.group(1)}${m.group(2) != null ? ' ${m.group(2)}' : ''}' : 'Q${i + 1}'} — $text');
      }
    }
    return (c: c, nc: nc, score: c + nc == 0 ? null : (c / (c + nc) * 1000).round() / 10, lines: lines);
  }

  /// Renseigne « Non-conformités relevées » et la décision d'après les réponses (≥ 75 % : approuvé).
  void _applyAuto() {
    if (!_hasScore) return;
    final e = _eval(_ans);
    if (e.score == null) return;
    for (final q in _questions) {
      final id = '${q['id']}';
      if (_isNcQ(q)) { _ans[id] = e.lines.isEmpty ? 'Aucune non-conformité relevée.' : e.lines.join('\n'); }
      if (_isDecisionQ(q)) {
        final o = ((q['options'] as List?) ?? const []).map((x) => '$x').toList();
        if (e.score! >= 75 && o.contains('Approuvé')) { _ans[id] = 'Approuvé'; }
        else if (e.score! < 75) { final s = o.where((x) => x.startsWith('Sanctionn')); if (s.isNotEmpty && (_ans[id] == null || _ans[id] == 'Approuvé')) _ans[id] = s.first; }
      }
    }
  }

  /// Observation de l'exigence : liste déroulante selon le résultat (conforme, non conforme, non applicable), ou texte libre.
  Widget _obsField(Map<String, dynamic> q) {
    final id = '${q['id']}';
    final obs = q['observations'];
    const pos = {'Conforme', 'Conformes', 'oui', 'Oui'}, neg = {'Non conforme', 'Non conformes', 'non', 'Non', 'Partiels', 'Partielle', 'Insuffisant'};
    final a = _ans[id];
    final key = pos.contains(a) ? 'C' : neg.contains(a) ? 'NC' : a == 'Non applicable' ? 'NA' : null;
    if (obs is! Map || key == null) return const SizedBox.shrink();
    final options = ((obs[key] as List?) ?? const []).map((e) => '$e').toList();
    const other = 'Autre (saisir)…';
    final cur = _ans['obs.$id'] as String?;
    final shown = cur == null ? null : (options.contains(cur) ? cur : other);
    return Padding(padding: const EdgeInsets.only(top: 10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      DropdownButtonFormField<String>(
        key: ValueKey('obs-$id-${cur ?? ''}-$key'), isExpanded: true, initialValue: shown,
        decoration: const InputDecoration(labelText: 'Observation', border: OutlineInputBorder(), isDense: true),
        items: [for (final o in [...options, other]) DropdownMenuItem(value: o, child: Text(o, maxLines: 3, overflow: TextOverflow.ellipsis))],
        onChanged: (v) async {
          if (v == null) return;
          if (v != other) { setState(() => _ans['obs.$id'] = v); return; }
          final c = TextEditingController(text: shown == other ? cur : '');
          final t = await showDialog<String>(context: context, builder: (d) => AlertDialog(
            title: const Text('Observation'), content: TextField(controller: c, autofocus: true, maxLines: 3, maxLength: 300),
            actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('OK'))]));
          if (t != null && t.isNotEmpty) setState(() => _ans['obs.$id'] = t);
        }),
      if (shown == other && cur != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(cur, style: const TextStyle(color: Colors.black54))),
    ]));
  }

  Widget _autoPanel() {
    final e = _eval(_ans);
    final ok = e.score != null && e.score! >= 75;
    final colour = e.score == null ? Colors.black54 : ok ? _green : Colors.red.shade700;
    return Container(
      padding: const EdgeInsets.all(12), margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(color: colour.withAlpha(20), border: Border.all(color: colour), borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(e.score == null ? 'Conformité : répondez aux exigences' : 'Conformité : ${e.score.toString().replaceAll('.', ',')} % (${e.c} conforme(s), ${e.nc} non conforme(s))', style: TextStyle(fontWeight: FontWeight.w800, color: colour)),
        Text(e.score == null ? 'Le score est calculé automatiquement.' : ok ? 'Au moins 75 % : l\'inspection sera approuvée automatiquement.' : 'Moins de 75 % : le questionnaire vous sera renvoyé pour être repris avec le producteur.', style: TextStyle(color: colour)),
      ]));
  }

  @override
  void initState() {
    super.initState();
    final prev = widget.assignment['answers'];
    if (widget.draft == null && !_done && prev is Map && prev.isNotEmpty) {
      _ans.addAll(Map<String, dynamic>.from(prev));
      for (final q in _questions) {
        final id = '${q['id']}';
        if ((q['type'] == 'text' || q['type'] == 'number') && _ans[id] != null) _text(id).text = '${_ans[id]}';
      }
    }
    final d = widget.draft;
    if (d != null) {
      _draftId = d['id'] as String?;
      final a = Map<String, dynamic>.from(((d['state'] as Map?)?['answers'] as Map?) ?? const {});
      _ans.addAll(a);
      for (final q in _questions) {
        final id = '${q['id']}';
        if ((q['type'] == 'text' || q['type'] == 'number') && a[id] != null) _text(id).text = '${a[id]}';
      }
    }
  }

  /// Enregistre les réponses déjà saisies, sans obligation de tout renseigner.
  Future<void> _saveDraft() async {
    for (final q in _questions) {
      final id = '${q['id']}';
      if (q['type'] == 'text' || q['type'] == 'number') {
        final t = _text(id).text.trim();
        if (t.isNotEmpty) { _ans[id] = t; } else { _ans.remove(id); }
      }
    }
    await services.repo.saveDraft(id: _draftId, kind: 'task', title: '${widget.assignment['title']}', producerIds: ['${widget.producer['id']}'],
        targetId: widget.assignment['target_id'], state: {'answers': _ans});
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Brouillon enregistré : tâche non terminée.')));
    Navigator.of(context).pop(false);
  }

  List<Map<String, dynamic>> get _questions =>
      ((widget.assignment['questions'] as List?) ?? const []).map((q) => Map<String, dynamic>.from(q as Map)).toList();
  bool get _done => widget.assignment['status'] == 'done';
  Map<String, dynamic> get _saved => Map<String, dynamic>.from((widget.assignment['answers'] as Map?) ?? const {});

  @override
  void dispose() {
    for (final c in _ctl.values) { c.dispose(); }
    super.dispose();
  }

  TextEditingController _text(String id) => _ctl.putIfAbsent(id, () => TextEditingController());

  String _show(dynamic v) {
    if (v == null || v == '') return '—';
    if (v is List) return v.join(', ');
    if (v == 'oui') return 'Oui';
    if (v == 'non') return 'Non';
    return '$v';
  }

  bool _empty(dynamic v) => v == null || v == '' || (v is List && v.isEmpty);

  Future<void> _save() async {
    for (final q in _questions) {
      final id = '${q['id']}';
      if (q['type'] == 'text' || q['type'] == 'number') {
        final t = _text(id).text.trim();
        if (t.isNotEmpty) { _ans[id] = t; } else { _ans.remove(id); }
      }
      if (_auto(q)) continue;
      if (q['required'] == true && _empty(_ans[id])) {
        setState(() => _error = 'Réponse obligatoire : « ${q['label']} »');
        return;
      }
      if (q['type'] == 'number' && !_empty(_ans[id]) && double.tryParse('${_ans[id]}'.replaceAll(',', '.')) == null) {
        setState(() => _error = '« ${q['label']} » : un nombre est attendu');
        return;
      }
    }
    _applyAuto();
    setState(() { _busy = true; _error = null; });
    final targetId = widget.assignment['target_id'];
    await services.repo.queueOp('questionnaire.answer', {'id': targetId, 'answers': _ans});
    final e = _eval(_ans);
    final redo = _hasScore && e.score != null && e.score! < 75;
    if (redo) {
      await services.repo.patchCachedAssignment(targetId as Object, {'status': 'pending', 'needs_redo': true, 'redo_reason': 'Conformité de ${e.score.toString().replaceAll('.', ',')} % (minimum 75 %). Non-conformités : ${e.nc}.', 'answers': _ans});
    } else {
      await services.repo.patchCachedAssignment(targetId as Object, {'status': 'done', 'needs_redo': false, 'answers': _ans});
    }
    await services.repo.deleteDraft(_draftId);
    widget.assignment['status'] = redo ? 'pending' : 'done';
    widget.assignment['answers'] = _ans;
    services.sync.run();
    if (mounted) Navigator.of(context).pop(true);
  }

  Widget _field(Map<String, dynamic> q) {
    final id = '${q['id']}';
    final type = '${q['type']}';
    final options = ((q['options'] as List?) ?? const []).map((o) => '$o').toList();
    switch (type) {
      case 'number':
        return TextField(controller: _text(id), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(border: OutlineInputBorder()));
      case 'text':
        return TextField(controller: _text(id), minLines: 2, maxLines: 4, decoration: const InputDecoration(border: OutlineInputBorder()));
      case 'yesno':
        return Row(children: [
          for (final v in const ['oui', 'non'])
            Expanded(child: RadioListTile<String>(contentPadding: EdgeInsets.zero, dense: true, title: Text(v == 'oui' ? 'Oui' : 'Non'), value: v, groupValue: _ans[id] as String?, onChanged: (x) => setState(() => _ans[id] = x))),
        ]);
      case 'choice':
        return DropdownButtonFormField<String>(
          initialValue: _ans[id] as String?,
          decoration: const InputDecoration(border: OutlineInputBorder()),
          items: [for (final o in options) DropdownMenuItem(value: o, child: Text(o))],
          onChanged: (x) => setState(() { _ans[id] = x; _ans.remove('obs.$id'); }),
        );
      case 'multi':
        final cur = List<String>.from((_ans[id] as List?) ?? const []);
        return Column(children: [
          for (final o in options)
            CheckboxListTile(contentPadding: EdgeInsets.zero, dense: true, title: Text(o), value: cur.contains(o), onChanged: (on) => setState(() {
                  final n = List<String>.from(cur);
                  if (on == true) { n.add(o); } else { n.remove(o); }
                  _ans[id] = n;
                })),
        ]);
      case 'date':
        final v = _ans[id] as String?;
        return OutlinedButton.icon(
          icon: const Icon(Icons.event),
          label: Text(v ?? 'Choisir la date'),
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2100));
            if (d != null) setState(() => _ans[id] = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}');
          },
        );
      default:
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.producer;
    final saved = _saved;
    final instr = '${widget.assignment['instructions'] ?? ''}';
    return Scaffold(
      appBar: AppBar(title: Text('${widget.assignment['title']}'), backgroundColor: _green, foregroundColor: Colors.white,
          actions: [if (!_done) IconButton(onPressed: _busy ? null : _saveDraft, tooltip: 'Enregistrer en brouillon', icon: const Icon(Icons.save_outlined))]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('${p['last_name'] ?? ''} ${p['first_names'] ?? ''} · ${p['internal_code'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
        if (instr.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(instr, style: const TextStyle(color: Colors.black54))),
        if (_done) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Questionnaire déjà renseigné.', style: TextStyle(color: _green, fontWeight: FontWeight.w600))),
        if (widget.assignment['needs_redo'] == true && !_done) Container(
          padding: const EdgeInsets.all(12), margin: const EdgeInsets.only(top: 8), decoration: BoxDecoration(color: Colors.red.shade50, border: Border.all(color: Colors.red.shade300), borderRadius: BorderRadius.circular(8)),
          child: Text('À reprendre avec le producteur. ${widget.assignment['redo_reason'] ?? ''}', style: TextStyle(color: Colors.red.shade800, fontWeight: FontWeight.w700))),
        const SizedBox(height: 12),
        if (_hasScore && !_done) _autoPanel(),
        for (var i = 0; i < _questions.length; i++) ...[
          Text('${i + 1}. ${_questions[i]['label']}${_questions[i]['required'] == true ? ' *' : ''}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          if (_done) Text('${_show(saved['${_questions[i]['id']}'])}${(saved['obs.${_questions[i]['id']}'] ?? '').toString().isNotEmpty ? '\n${saved['obs.${_questions[i]['id']}']}' : ''}', style: const TextStyle(fontSize: 16))
          else if (_auto(_questions[i])) Text(_isSketchQ(_questions[i]) ? 'Rempli automatiquement à l\'exportation avec les parcelles du producteur.' : (_isNcQ(_questions[i]) ? (_eval(_ans).lines.isEmpty ? 'Renseigné automatiquement d\'après vos réponses.' : _eval(_ans).lines.join('\n')) : (_eval(_ans).score == null ? 'Calculée automatiquement : approuvé si la conformité atteint 75 %.' : (_eval(_ans).score! >= 75 ? 'Approuvé' : 'Non approuvé : reprise demandée')) ), style: const TextStyle(fontSize: 15, color: Colors.black87))
          else ...[_field(_questions[i]), _obsField(_questions[i])],
          const SizedBox(height: 16),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: TextStyle(color: Colors.red.shade700))),
        if (!_done)
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _action, minimumSize: const Size.fromHeight(52)),
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Enregistrement…' : 'Enregistrer les réponses'),
          ),
      ]),
    );
  }
}
