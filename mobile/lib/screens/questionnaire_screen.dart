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

  @override
  void initState() {
    super.initState();
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
      if (q['required'] == true && _empty(_ans[id])) {
        setState(() => _error = 'Réponse obligatoire : « ${q['label']} »');
        return;
      }
      if (q['type'] == 'number' && !_empty(_ans[id]) && double.tryParse('${_ans[id]}'.replaceAll(',', '.')) == null) {
        setState(() => _error = '« ${q['label']} » : un nombre est attendu');
        return;
      }
    }
    setState(() { _busy = true; _error = null; });
    final targetId = widget.assignment['target_id'];
    await services.repo.queueOp('questionnaire.answer', {'id': targetId, 'answers': _ans});
    await services.repo.patchCachedAssignment(targetId as Object, {'status': 'done', 'answers': _ans});
    await services.repo.deleteDraft(_draftId);
    widget.assignment['status'] = 'done';
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
          onChanged: (x) => setState(() => _ans[id] = x),
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
        const SizedBox(height: 12),
        for (var i = 0; i < _questions.length; i++) ...[
          Text('${i + 1}. ${_questions[i]['label']}${_questions[i]['required'] == true ? ' *' : ''}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          if (_done) Text(_show(saved['${_questions[i]['id']}']), style: const TextStyle(fontSize: 16)) else _field(_questions[i]),
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
