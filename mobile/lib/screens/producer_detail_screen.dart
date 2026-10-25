import 'dart:convert';

import 'package:flutter/material.dart';

import '../geo/polygon.dart';
import '../main.dart';
import '../sync/sync_state.dart';
import 'missions_screen.dart';
import 'parcel_survey_screen.dart';
import 'photo_capture.dart';
import 'producer_map_screen.dart';
import 'questionnaire_screen.dart';

const _green = Color(0xFF2F5D46);
const _action = Color(0xFF3F9B2E);

/// Profil d'un producteur :
/// onglet « Liste des tâches » (les missions de ce producteur) et onglet « Informations sur le producteur »
/// (identité, parcelles capturées, relevé d'une parcelle, carte).
class ProducerDetailScreen extends StatefulWidget {
  final Map<String, Object?> producer;
  const ProducerDetailScreen({super.key, required this.producer});
  @override
  State<ProducerDetailScreen> createState() => _ProducerDetailScreenState();
}

class _ProducerDetailScreenState extends State<ProducerDetailScreen> {
  List<Map<String, Object?>> _parcels = [];
  List<dynamic>? _tasks;
  List<dynamic> _assigned = [];
  bool _canDone = false;
  bool _canSurvey = false, _canEdit = false, _canRequest = false, _canMissions = false;
  String? _taskError, _msg;

  @override
  void initState() {
    super.initState();
    _load();
    _loadTasks();
  }

  Future<void> _load() async {
    final all = await services.repo.parcels();
    final perms = await services.repo.permissions();
    final code = widget.producer['internal_code'];
    if (mounted) setState(() {
      _parcels = all.where((r) => r['producer_code'] == code).toList();
      _canSurvey = canSurveyParcel(perms); _canEdit = canUpdateParcel(perms); _canRequest = canRequestMission(perms); _canMissions = canSeeMissions(perms); _canDone = perms.contains('training:report');
    });
  }

  /// Les tâches viennent du serveur : réseau nécessaire.
  Future<void> _loadTasks() async {
    try {
      final r = await services.api.get('/tasks?producer_id=${widget.producer['id']}') as List<dynamic>;
      if (!mounted) return;
      setState(() { _tasks = r.where((t) => !['closed', 'cancelled'].contains(t['status'])).toList(); _taskError = null; });
      // Formations, distributions et tâches ajoutées au profil par l'Administrateur de groupe (facultatif : ignoré si le droit manque).
      try {
        final a = await services.api.get('/producer-assignments?producer_id=${widget.producer['id']}') as List<dynamic>;
        if (mounted) setState(() => _assigned = a);
      } catch (_) {}
      await _applyLocalAssignments();
    } catch (_) {
      // Hors connexion : tâches copiées lors de la dernière synchronisation.
      try {
        {
          final all = (await services.repo.cachedTasks()).where((t) => t['producer_id'] == widget.producer['id'] && !['closed', 'cancelled'].contains(t['status'])).toList();
          await _applyLocalAssignments();
          if (mounted) setState(() { _tasks = all; _taskError = null; _msg = 'Hors connexion : tâches de la dernière synchronisation.'; });
          return;
        }
      } catch (_) {}
      if (mounted) setState(() => _taskError = 'Les tâches demandent le réseau. Réessayez en ligne.');
    }
  }

  /// Éléments du profil : copie de la dernière synchronisation (avec les « fait » encore en attente d'envoi).
  Future<void> _applyLocalAssignments() async {
    final all = await services.repo.cachedAssignments();
    final mine = all.where((a) => a['producer_id'] == widget.producer['id']).toList();
    if (mounted && (mine.isNotEmpty || _assigned.isEmpty)) setState(() => _assigned = mine);
  }

  Future<void> _survey([Map<String, Object?>? existing]) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ParcelSurveyScreen(existing: existing, producer: existing == null ? widget.producer : null)));
    if (saved == true) { services.sync.run(); if (mounted) setState(() => _msg = existing == null ? 'Parcelle conservée sur l\'appareil, envoyée à la prochaine connexion.' : 'Nouveau tracé conservé sur l\'appareil, envoi à la prochaine connexion.'); }
    _load();
  }

  Future<void> _photo(Map<String, Object?> parcel) async {
    final path = await takePhotoPath();
    if (path == null) { if (mounted) setState(() => _msg = 'Aucune photo prise (appareil photo annulé ou indisponible).'); return; }
    await services.repo.queuePhoto(subjectType: 'parcel', subjectId: parcel['id'] as String, kind: 'Photo de la parcelle', sourcePath: path);
    services.sync.run();
    if (mounted) setState(() => _msg = 'Photo conservée sur l\'appareil, envoyée dès que la connexion le permet.');
  }

  List<List<GeoPoint>> get _shapes {
    final out = <List<GeoPoint>>[];
    for (final r in _parcels) {
      final g = r['geometry'];
      if (g == null) continue;
      try {
        final j = g is String ? jsonDecode(g) : g;
        final ring = (j['coordinates'][0] as List).map((c) => GeoPoint((c[1] as num).toDouble(), (c[0] as num).toDouble())).toList();
        if (ring.length > 1 && ring.first.lat == ring.last.lat && ring.first.lon == ring.last.lon) ring.removeLast();
        if (ring.length >= 3) out.add(ring);
      } catch (_) { /* tracé illisible : ignoré */ }
    }
    return out;
  }

  double get _totalHa => _parcels.fold(0.0, (s, r) => s + (double.tryParse('${r['geometry_area_ha']}') ?? 0));

  @override
  Widget build(BuildContext context) {
    final p = widget.producer;
    final name = '${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase();
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FAF2),
        appBar: AppBar(title: const Text('Détails sur le producteur')),
        body: Column(children: [
          Container(
            width: double.infinity, color: _green, padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Voir le producteur', style: TextStyle(color: Colors.white, fontSize: 20)),
              const SizedBox(height: 10),
              _whiteBox(name),
              const SizedBox(height: 8),
              _whiteBox('${p['internal_code'] ?? ''}'),
            ]),
          ),
          const Material(color: Colors.white, child: TabBar(
            labelColor: _green, indicatorColor: _green, labelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            tabs: [
              Tab(height: 74, child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.checklist_rtl), SizedBox(height: 2), Text('Liste des tâches', textAlign: TextAlign.center, maxLines: 2)])),
              Tab(height: 74, child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.person_outline), SizedBox(height: 2), Text('Informations sur le producteur', textAlign: TextAlign.center, maxLines: 2)])),
            ],
          )),
          Expanded(child: TabBarView(children: [_tasksTab(), _infoTab(p)])),
        ]),
      ),
    );
  }

  Widget _whiteBox(String t) => Container(
        width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6)), child: Text(t, style: const TextStyle(fontSize: 16)));

  Widget _tasksTab() {
    final rows = _tasks;
    return RefreshIndicator(
      onRefresh: _loadTasks,
      child: ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 24), children: [
        Container(color: const Color(0xFFEDEDED), margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
            child: const Row(children: [Icon(Icons.checklist_rtl, size: 18), SizedBox(width: 10), Text('Liste des tâches', style: TextStyle(fontSize: 18))])),
        if (_msg != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_msg!)),
        if (_taskError != null) Padding(padding: const EdgeInsets.all(16), child: Text(_taskError!)),
        if (rows == null && _taskError == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
        if (rows != null && rows.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Aucune tâche pour ce producteur.'))),
        for (final t in rows ?? const [])
          // Mission terminée et validée par l'ADG : grisée et non cliquable ; le serveur la retire de la liste une fois le délai réglé dépassé.
          Opacity(opacity: t['finished'] == true ? 0.45 : 1, child: Card(color: t['finished'] == true ? const Color(0xFFEDEDED) : Colors.white, elevation: 0, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(2)), child: ListTile(
            enabled: t['finished'] != true,
            title: Text('${t['title']}', maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text('${t['status'] == 'open' ? 'Nouvelle tâche' : missionStatusLabel(t['status'])}${t['due_date'] != null ? ' • échéance ${t['due_date'].toString().substring(0, 10)}' : ''}',
                style: TextStyle(color: t['overdue'] == true ? Colors.red.shade700 : Colors.black54)),
            trailing: t['finished'] == true
                ? const Icon(Icons.check_circle_outline, color: Colors.black54, size: 30)
                : Icon(t['overdue'] == true ? Icons.warning_amber_rounded : Icons.description_outlined, color: t['overdue'] == true ? Colors.red : Colors.black87, size: 30),
            onTap: _canMissions && t['finished'] != true ? () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => MissionScreen(task: Map<String, dynamic>.from(t as Map))));
              _loadTasks();
            } : null,
          ))),
        if (_assigned.isNotEmpty) ...[
          Container(color: const Color(0xFFEDEDED), margin: const EdgeInsets.only(top: 12, bottom: 8), padding: const EdgeInsets.all(12),
              child: const Row(children: [Icon(Icons.assignment_turned_in_outlined, size: 18), SizedBox(width: 10), Expanded(child: Text('Formations, distributions et tâches', style: TextStyle(fontSize: 18)))])),
          for (final a in _assigned)
            Opacity(opacity: a['status'] == 'done' ? 0.45 : 1, child: Card(elevation: 0, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(18)), child: ListTile(
              leading: Icon(a['kind'] == 'formation' ? Icons.menu_book : a['kind'] == 'distribution' ? Icons.inventory_2_outlined : Icons.task_alt),
              title: Text('${a['title']}', maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: Text('${a['kind'] == 'formation' ? 'Module de formation' : a['kind'] == 'distribution' ? 'Distribution' : 'Tâche'}${a['due_date'] != null ? ' • échéance ${a['due_date'].toString().substring(0, 10)}' : ''}${(a['instructions'] ?? '').toString().isNotEmpty ? '\n${a['instructions']}' : ''}'),
              isThreeLine: (a['instructions'] ?? '').toString().isNotEmpty,
              onTap: a['questionnaire_id'] != null && a['questions'] != null ? () async {
                final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => QuestionnaireScreen(assignment: Map<String, dynamic>.from(a as Map), producer: widget.producer)));
                if (saved == true) { await _applyLocalAssignments(); if (mounted) setState(() => _msg = 'Réponses conservées sur l\'appareil, envoyées à la synchronisation.'); }
              } : null,
              trailing: a['questionnaire_id'] != null && a['questions'] != null
                  ? (a['status'] == 'done' ? const Icon(Icons.check_circle_outline, size: 28) : const Icon(Icons.edit_note, size: 30, color: _action))
                  : a['status'] == 'done' ? const Icon(Icons.check_circle_outline, size: 28)
                  : (_canDone ? TextButton(onPressed: () async {
                      await services.repo.queueOp('producer_assignment.done', {'id': a['target_id']});
                      await services.repo.patchCachedAssignment(a['target_id'] as Object, {'status': 'done'});
                      if (mounted) setState(() { a['status'] = 'done'; _msg = 'Marqué fait sur l\'appareil, envoyé à la synchronisation.'; });
                      services.sync.run();
                    }, child: const Text('Fait')) : null),
            ))),
        ],
        if (_canRequest)
          Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton.icon(
            onPressed: () async { final m = await askMission(context, producerId: widget.producer['id'] as String); if (m != null && mounted) { setState(() => _msg = m); _loadTasks(); } },
            icon: const Icon(Icons.add), label: const Text('Demander une mission'))),
      ]),
    );
  }

  Widget _infoTab(Map<String, Object?> p) {
    Widget cell(String label, String value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(color: Colors.black54)),
            Text(value.isEmpty ? '—' : value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
          ]));
    final shapes = _shapes;
    return ListView(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8), children: [
      Row(children: [Expanded(child: cell('Numéro de téléphone', '${p['phone'] ?? ''}')), Expanded(child: cell('Code producteur', '${p['internal_code'] ?? ''}'))]),
      const Divider(height: 1),
      Row(children: [Expanded(child: cell('Localité', '${p['village'] ?? ''}')), Expanded(child: cell('Section', '${p['section'] ?? ''}'))]),
      const Divider(height: 1),
      Padding(padding: const EdgeInsets.only(top: 14), child: Row(children: [
        const Expanded(child: Text('Nombre de parcelles capturées', style: TextStyle(color: Colors.black54))),
        Text('${_parcels.length}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
      ])),
      const SizedBox(height: 8),
      for (final r in _parcels)
        Container(
          margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFDDDDDD))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [const Icon(Icons.straighten, size: 20), const SizedBox(width: 8), Expanded(child: Text('${r['code'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)))]),
            const SizedBox(height: 6),
            Text.rich(TextSpan(text: 'Taille de la parcelle : ', children: [TextSpan(text: '${_ha(r['geometry_area_ha'])} Hectares', style: const TextStyle(color: _green, fontWeight: FontWeight.w800))]), style: const TextStyle(fontSize: 16)),
            Text('Déclarée : ${_ha(r['declared_area_ha'])} ha', style: const TextStyle(color: Colors.black54)),
            if (((r['pending_updates'] as int?) ?? 0) > 0) Text("Nouveau tracé en attente d'envoi", style: TextStyle(color: Colors.orange.shade800)),
            Wrap(children: [
              if (_canEdit) TextButton.icon(onPressed: () => _survey(r), icon: const Icon(Icons.edit_location_alt_outlined), label: const Text('Reprendre le tracé')),
              TextButton.icon(onPressed: () => _photo(r), icon: const Icon(Icons.photo_camera_outlined), label: const Text('Photo')),
            ]),
          ]),
        ),
      if (_msg != null) Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(_msg!)),
      if (_canSurvey)
        FilledButton.icon(onPressed: () => _survey(), icon: const Icon(Icons.add_location_alt_outlined), label: const Text('Relever une parcelle'),
            style: FilledButton.styleFrom(backgroundColor: _action, padding: const EdgeInsets.symmetric(vertical: 14))),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProducerMapScreen(producerName: '${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim(), shapes: shapes))),
        icon: const Icon(Icons.location_on_outlined), label: const Text('Ouvrir la carte'),
        style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14), foregroundColor: _green),
      ),
      if (_parcels.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text('Superficie mesurée au total : ${_totalHa.toStringAsFixed(2)} ha', style: const TextStyle(color: Colors.black54))),
      const SizedBox(height: 24),
    ]);
  }

  String _ha(Object? v) {
    final d = double.tryParse('$v');
    return d == null ? '—' : d.toStringAsFixed(2).replaceAll('.', ',');
  }
}
