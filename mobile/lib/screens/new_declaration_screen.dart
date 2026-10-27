import 'package:flutter/services.dart';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../main.dart';

class NewDeclarationScreen extends StatefulWidget {
  const NewDeclarationScreen({super.key});
  @override
  State<NewDeclarationScreen> createState() => _NewDeclarationScreenState();
}

class _NewDeclarationScreenState extends State<NewDeclarationScreen> {
  final _search = TextEditingController();
  final _quantity = TextEditingController();
  final _bags = TextEditingController();
  final _notes = TextEditingController();
  final _receiptNo = TextEditingController();

  List<Map<String, Object?>> _producers = [];
  Map<String, Object?>? _producer;
  List<Map<String, Object?>> _chains = [];
  Map<String, Object?>? _chain;
  List<Map<String, Object?>> _campaigns = [];
  Map<String, Object?>? _campaign;
  List<String> _units = ['kg'];
  String _unit = 'kg';
  DateTime _date = DateTime.now();
  String? _estimate;
  String? _error;
  bool _saving = false;
  String? _photoPath;
  bool _infoOk = false; // fiche « Informations du producteur » vue et validée

  String get _dateStr => _date.toIso8601String().substring(0, 10);

  @override
  void initState() {
    super.initState();
    _findProducers('');
  }

  Future<void> _findProducers(String q) async {
    final r = await services.repo.searchProducers(q);
    if (mounted) setState(() => _producers = r);
  }

  Future<void> _pickProducer(Map<String, Object?> p) async {
    final chains = await services.repo.chainsFor(p['id'] as String);
    setState(() { _producer = p; _infoOk = false; _chains = chains; _chain = null; _campaign = null; _campaigns = []; _estimate = null; });
    if (chains.length == 1) await _pickChain(chains.first);
    if (chains.isEmpty) setState(() => _error = "Aucun produit disponible pour votre affectation.");
  }

  Future<void> _pickChain(Map<String, Object?> c) async {
    final id = c['id'] as String;
    final camps = await services.repo.openCampaigns(id);
    final units = await services.repo.unitsFor(id);
    setState(() {
      _error = null; _chain = c; _campaigns = camps; _campaign = camps.length == 1 ? camps.first : null;
      _units = units; _unit = units.contains('kg') ? 'kg' : (units.contains(_unit) ? _unit : units.first);
    });
    await _updateEstimate();
  }

  Future<void> _updateEstimate() async {
    if (_chain == null || _campaign == null) return setState(() => _estimate = null);
    final e = await services.repo.estimate(
        chainId: _chain!['id'] as String, campaignId: _campaign!['id'] as String, date: _dateStr, quantity: _quantity.text.trim().replaceAll(',', '.'), unit: _unit);
    if (mounted) setState(() => _estimate = e == null ? null : '≈ ${e.amount} ${e.currency}');
  }

  Future<void> _takePhoto() async {
    try {
      final x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 70);
      if (x != null && mounted) setState(() => _photoPath = x.path);
    } catch (_) {
      if (mounted) setState(() => _error = "Appareil photo indisponible : autorisez-le dans les réglages ou continuez sans photo.");
    }
  }

  Future<void> _save() async {
    final q = _quantity.text.trim().replaceAll(',', '.');
    if (_producer == null || _chain == null || _campaign == null) return setState(() => _error = 'Choisissez le producteur, le produit et la campagne.');
    if (!RegExp(r'^\d{1,14}(\.\d{1,3})?$').hasMatch(q) || double.parse(q) <= 0) return setState(() => _error = 'Poids invalide (nombre positif, 3 décimales maximum).');
    final bags = int.tryParse(_bags.text.trim());
    if (bags == null || bags <= 0) return setState(() => _error = 'Saisissez le nombre de sacs.');
    if (_receiptNo.text.trim().isEmpty) return setState(() => _error = 'Saisissez le numéro du reçu.');
    setState(() { _saving = true; _error = null; });
    final declId = await services.repo.createDeclaration(
        producerId: _producer!['id'] as String, chainId: _chain!['id'] as String, campaignId: _campaign!['id'] as String,
        date: _dateStr, quantity: q, unit: _unit, bags: bags, notes: _notes.text.trim(), receiptNo: _receiptNo.text.trim());
    if (_photoPath != null) await services.repo.queueReceiptPhoto(declarationId: declId, sourcePath: _photoPath!);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enregistrée sur l\'appareil. Elle sera envoyée dès que possible.')));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Acheter du produit')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_producer == null) ...[
          TextField(controller: _search, decoration: const InputDecoration(labelText: 'Rechercher un producteur (code ou nom)', prefixIcon: Icon(Icons.search), border: OutlineInputBorder()), onChanged: _findProducers),
          const SizedBox(height: 8),
          if (_producers.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Aucun producteur. Synchronisez pour télécharger la liste.')),
          for (final p in _producers) ListTile(title: Text('${p['last_name']} ${p['first_names']}'), subtitle: Text('${p['internal_code']}  •  ${p['village'] ?? ''}'), onTap: () => _pickProducer(p)),
        ] else if (!_infoOk) ...[
          _ProducerInfo(
            producer: _producer!, error: _error,
            onChange: () => setState(() { _producer = null; _chain = null; _campaign = null; _error = null; }),
            onContinue: _chains.isEmpty ? null : () => setState(() => _infoOk = true),
          ),
        ] else ...[
          ListTile(contentPadding: EdgeInsets.zero, title: Text('${_producer!['last_name']} ${_producer!['first_names']}'), subtitle: Text('${_producer!['internal_code']}'),
              trailing: TextButton(onPressed: () => setState(() { _producer = null; _infoOk = false; _chain = null; _campaign = null; }), child: const Text('Changer'))),
          if (_chains.length > 1) DropdownButtonFormField<Map<String, Object?>>(
              decoration: const InputDecoration(labelText: 'Produit', border: OutlineInputBorder()), value: _chain,
              items: [for (final c in _chains) DropdownMenuItem(value: c, child: Text(c['name'] as String))], onChanged: (c) { if (c != null) _pickChain(c); }),
          if (_chain != null) ...[
            const SizedBox(height: 12),
            Text('Produit : ${_chain!['name']}'),
            const SizedBox(height: 12),
            DropdownButtonFormField<Map<String, Object?>>(
                decoration: const InputDecoration(labelText: 'Campagne', border: OutlineInputBorder()), value: _campaign,
                items: [for (final c in _campaigns) DropdownMenuItem(value: c, child: Text(c['name'] as String))],
                onChanged: (c) { setState(() => _campaign = c); _updateEstimate(); }),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: _quantity, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Poids (kg)', border: OutlineInputBorder()), onChanged: (_) => _updateEstimate())),
              const SizedBox(width: 8),
              Expanded(flex: 2, child: DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Unité', border: OutlineInputBorder()), value: _unit,
                  items: [for (final u in _units) DropdownMenuItem(value: u, child: Text(u))], onChanged: (u) { setState(() => _unit = u!); _updateEstimate(); })),
            ]),
            const SizedBox(height: 12),
            TextField(controller: _bags, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Nombre de sacs', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            ListTile(contentPadding: EdgeInsets.zero, title: Text('Date de l\'opération : $_dateStr'), trailing: const Icon(Icons.calendar_today),
                onTap: () async {
                  final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime.now().subtract(const Duration(days: 60)), lastDate: DateTime.now());
                  if (d != null) { setState(() => _date = d); _updateEstimate(); }
                }),
            TextField(controller: _receiptNo, textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'N° du reçu', helperText: 'Numéro du reçu remis au producteur.', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Observations (facultatif)', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            Row(children: [
              Flexible(child: OutlinedButton.icon(onPressed: _saving ? null : _takePhoto, icon: const Icon(Icons.photo_camera_outlined), label: Text(_photoPath == null ? 'Photo du reçu (facultatif)' : 'Reprendre la photo', overflow: TextOverflow.ellipsis))),
              const SizedBox(width: 12),
              if (_photoPath != null) ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.file(File(_photoPath!), width: 56, height: 56, fit: BoxFit.cover)),
            ]),
            const SizedBox(height: 12),
            Card(child: Padding(padding: const EdgeInsets.all(12), child: Text(_estimate == null
                ? 'Montant : sera calculé par le serveur.'
                : 'Estimation locale : $_estimate\nLe montant définitif est calculé par le serveur et peut différer.'))),
            const SizedBox(height: 8),
            const Text('Cette déclaration restera « locale » tant que le serveur ne l\'a pas confirmée. Elle ne vaut ni réception, ni paiement.', style: TextStyle(fontSize: 12)),
            const SizedBox(height: 16),
            FilledButton.icon(icon: const Icon(Icons.save), onPressed: _saving ? null : _save, label: const Text('Enregistrer sur l\'appareil')),
          ],
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      ]),
    );
  }
}


/// Fiche « Informations du producteur » affichée après sa sélection, avant la saisie de l'achat.
class _ProducerInfo extends StatelessWidget {
  final Map<String, Object?> producer;
  final String? error;
  final VoidCallback onChange;
  final VoidCallback? onContinue;
  const _ProducerInfo({required this.producer, required this.error, required this.onChange, required this.onContinue});

  Widget _row(IconData icon, String label, Object? value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(children: [
          CircleAvatar(radius: 24, backgroundColor: const Color(0xFF3F9B2E), child: Icon(icon, color: Colors.white)),
          const SizedBox(width: 14),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 14, color: Color(0xFF1F2937))),
            Text(value == null || '$value'.trim().isEmpty ? '—' : '$value', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Color(0xFF1F2937))),
          ])),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0, color: const Color(0xFFEFF6E4), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        child: Column(children: [
          const Text('Informations du producteur', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: Color(0xFF1F2937))),
          const SizedBox(height: 10),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Nom :'), Text('${producer['last_name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))])),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Prénoms :'), Text('${producer['first_names']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))])),
          ]),
          const Divider(),
          _row(Icons.person, 'Matricule', producer['internal_code']),
          const Divider(height: 1),
          _row(Icons.phone_android, 'Contact', producer['phone']),
          const Divider(height: 1),
          _row(Icons.place, 'Localité', producer['village']),
          if ('${producer['section'] ?? ''}'.isNotEmpty) ...[const Divider(height: 1), _row(Icons.map_outlined, 'Section', producer['section'])],
          if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF3F9B2E), padding: const EdgeInsets.symmetric(vertical: 14), shape: const StadiumBorder()),
            onPressed: onContinue, child: const Text('Continuer', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          )),
          TextButton(onPressed: onChange, child: const Text('Changer de producteur')),
        ]),
      ),
    );
  }
}
