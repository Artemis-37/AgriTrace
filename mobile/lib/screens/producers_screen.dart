import 'package:flutter/material.dart';

import '../main.dart';
import '../sync/sync_state.dart';
import 'parcel_survey_screen.dart';
import 'parcels_screen.dart';

const _green = Color(0xFF2F5D46);

/// Recherche d'un producteur (nom, code ou téléphone) parmi ceux de l'appareil, utilisable hors connexion.
class ProducersScreen extends StatefulWidget {
  const ProducersScreen({super.key});
  @override
  State<ProducersScreen> createState() => _ProducersScreenState();
}

class _ProducersScreenState extends State<ProducersScreen> {
  List<Map<String, Object?>> _rows = [];
  String _q = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.searchProducers(_q);
    if (mounted) setState(() => _rows = r);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Producteurs')),
      body: Column(children: [
        Container(
          color: _green, padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Sélectionnez un producteur', style: TextStyle(color: Colors.white, fontSize: 20)),
            const SizedBox(height: 10),
            TextField(
              decoration: InputDecoration(
                hintText: 'Nom, code ou téléphone', filled: true, fillColor: Colors.white, isDense: true,
                suffixIcon: const Icon(Icons.search), border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none)),
              onChanged: (v) { _q = v; _load(); },
            ),
          ]),
        ),
        Expanded(
          child: _rows.isEmpty
              ? const Center(child: Text('Aucun producteur.\nSynchronisez pour charger la liste.', textAlign: TextAlign.center))
              : ListView.separated(
                  itemCount: _rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = _rows[i];
                    return Material(
                      color: Colors.white,
                      child: ListTile(
                        title: Text('${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase()),
                        subtitle: Text('${p['internal_code'] ?? ''}${(p['village'] ?? '').toString().isEmpty ? '' : '  •  ${p['village']}'}'),
                        trailing: const Icon(Icons.person, color: Colors.black87),
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProducerDetailScreen(producer: p))),
                      ),
                    );
                  }),
        ),
      ]),
    );
  }
}

/// Fiche d'un producteur : onglet « Parcelles » (relevés et tracés) et onglet « Informations ».
class ProducerDetailScreen extends StatefulWidget {
  final Map<String, Object?> producer;
  const ProducerDetailScreen({super.key, required this.producer});
  @override
  State<ProducerDetailScreen> createState() => _ProducerDetailScreenState();
}

class _ProducerDetailScreenState extends State<ProducerDetailScreen> {
  List<Map<String, Object?>> _parcels = [];
  bool _canSurvey = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final all = await services.repo.parcels();
    final perms = await services.repo.permissions();
    final code = widget.producer['internal_code'];
    if (mounted) setState(() { _parcels = all.where((r) => r['producer_code'] == code).toList(); _canSurvey = canSurveyParcel(perms); });
  }

  Future<void> _survey([Map<String, Object?>? existing]) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ParcelSurveyScreen(existing: existing)));
    if (saved == true) services.sync.run();
    _load();
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
        appBar: AppBar(title: const Text('Détails du producteur')),
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
            labelColor: _green, indicatorColor: _green,
            tabs: [Tab(icon: Icon(Icons.landscape_outlined), text: 'Parcelles'), Tab(icon: Icon(Icons.person_outline), text: 'Informations')],
          )),
          Expanded(child: TabBarView(children: [_parcelsTab(), _infoTab(p)])),
        ]),
      ),
    );
  }

  Widget _whiteBox(String t) => Container(
        width: double.infinity, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6)), child: Text(t, style: const TextStyle(fontSize: 16)));

  Widget _parcelsTab() => ListView(padding: const EdgeInsets.all(12), children: [
        if (_canSurvey)
          FilledButton.icon(onPressed: () => _survey(), icon: const Icon(Icons.add_location_alt_outlined), label: const Text('Relever une nouvelle parcelle'),
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFF3F9B2E), padding: const EdgeInsets.symmetric(vertical: 14))),
        if (_parcels.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Aucune parcelle pour ce producteur.'))),
        for (final r in _parcels)
          Card(color: Colors.white, elevation: 0, child: ListTile(
            leading: const Icon(Icons.landscape_outlined, color: _green),
            title: Text('${r['code'] ?? ''}'),
            subtitle: Text('Déclarée ${r['declared_area_ha'] ?? '—'} ha  •  mesurée ${r['geometry_area_ha'] ?? '—'} ha${((r['pending_updates'] as int?) ?? 0) > 0 ? '\nNouveau tracé en attente d\'envoi' : ''}'),
            trailing: _canSurvey ? const Icon(Icons.edit_location_alt_outlined) : null,
            onTap: _canSurvey ? () => _survey(r) : null,
          )),
        TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ParcelsScreen())), child: const Text('Toutes mes parcelles')),
      ]);

  Widget _infoTab(Map<String, Object?> p) {
    Widget cell(String label, String value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(color: Colors.black54)),
            Text(value.isEmpty ? '—' : value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
          ]));
    return ListView(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8), children: [
      Row(children: [Expanded(child: cell('Matricule', '${p['internal_code'] ?? ''}')), Expanded(child: cell('Contact', '${p['phone'] ?? ''}'))]),
      const Divider(height: 1),
      Row(children: [Expanded(child: cell('Localité', '${p['village'] ?? ''}')), Expanded(child: cell('Section', '${p['section'] ?? ''}'))]),
      const Divider(height: 1),
      Row(children: [Expanded(child: cell('Parcelles capturées', '${_parcels.length}')), Expanded(child: cell('Superficie mesurée', _parcels.isEmpty ? '' : '${_totalHa.toStringAsFixed(2)} ha'))]),
    ]);
  }
}
