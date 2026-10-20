import 'package:flutter/material.dart';

import '../main.dart';
import '../sync/sync_state.dart';
import 'parcel_survey_screen.dart';
import 'photo_capture.dart';

/// Parcelles connues de l'appareil : reprendre un tracé (droit de modification) ou ajouter une photo.
/// Tout est conservé sur l'appareil et envoyé à la synchronisation, réseau ou non.
class ParcelsScreen extends StatefulWidget {
  const ParcelsScreen({super.key});
  @override
  State<ParcelsScreen> createState() => _ParcelsScreenState();
}

class _ParcelsScreenState extends State<ParcelsScreen> {
  List<Map<String, Object?>> _rows = [];
  bool _canEdit = false;
  String _q = '';
  String? _msg;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await services.repo.parcels();
    final perms = await services.repo.permissions();
    if (mounted) setState(() { _rows = rows; _canEdit = canUpdateParcel(perms); });
  }

  Future<void> _retrace(Map<String, Object?> parcel) async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ParcelSurveyScreen(existing: parcel)));
    if (saved == true) { services.sync.run(); setState(() => _msg = 'Nouveau tracé enregistré sur l\'appareil, envoi à la prochaine connexion.'); }
    _load();
  }

  Future<void> _photo(Map<String, Object?> parcel) async {
    final path = await takePhotoPath();
    if (path == null) { if (mounted) setState(() => _msg = 'Aucune photo prise (appareil photo annulé ou indisponible).'); return; }
    await services.repo.queuePhoto(subjectType: 'parcel', subjectId: parcel['id'] as String, kind: 'Photo de la parcelle', sourcePath: path);
    services.sync.run();
    if (mounted) setState(() => _msg = 'Photo conservée sur l\'appareil, envoyée dès que la connexion le permet.');
  }

  @override
  Widget build(BuildContext context) {
    final q = _q.toLowerCase();
    final rows = _rows.where((r) => q.isEmpty || '${r['code']} ${r['producer_name']} ${r['producer_code']}'.toLowerCase().contains(q)).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Mes parcelles')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        TextField(decoration: const InputDecoration(labelText: 'Rechercher (code, producteur)', prefixIcon: Icon(Icons.search)), onChanged: (v) => setState(() => _q = v)),
        if (_msg != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg!)),
        if (rows.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Aucune parcelle sur cet appareil.'))),
        for (final r in rows)
          Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r['code'] ?? ''} · ${r['producer_name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('Déclarée ${r['declared_area_ha'] ?? '—'} ha · mesurée ${r['geometry_area_ha'] ?? '—'} ha'),
            if (((r['pending_updates'] as int?) ?? 0) > 0) Text('Nouveau tracé en attente d\'envoi', style: TextStyle(color: Colors.orange.shade800)),
            Row(children: [
              if (_canEdit) TextButton.icon(onPressed: () => _retrace(r), icon: const Icon(Icons.edit_location_alt_outlined), label: const Text('Reprendre le tracé')),
              TextButton.icon(onPressed: () => _photo(r), icon: const Icon(Icons.photo_camera_outlined), label: const Text('Photo')),
            ]),
          ]))),
      ]),
    );
  }
}
