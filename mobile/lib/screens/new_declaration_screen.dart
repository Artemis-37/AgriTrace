import 'package:flutter/material.dart';

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
    setState(() { _producer = p; _chains = chains; _chain = null; _campaign = null; _campaigns = []; _estimate = null; });
    if (chains.length == 1) await _pickChain(chains.first);
    if (chains.isEmpty) setState(() => _error = "Aucune filière disponible pour ce producteur et votre affectation.");
  }

  Future<void> _pickChain(Map<String, Object?> c) async {
    final id = c['id'] as String;
    final camps = await services.repo.openCampaigns(id);
    final units = await services.repo.unitsFor(id);
    setState(() {
      _error = null; _chain = c; _campaigns = camps; _campaign = camps.length == 1 ? camps.first : null;
      _units = units; _unit = units.contains(_unit) ? _unit : units.first;
    });
    await _updateEstimate();
  }

  Future<void> _updateEstimate() async {
    if (_chain == null || _campaign == null) return setState(() => _estimate = null);
    final e = await services.repo.estimate(
        chainId: _chain!['id'] as String, campaignId: _campaign!['id'] as String, date: _dateStr, quantity: _quantity.text.trim().replaceAll(',', '.'), unit: _unit);
    if (mounted) setState(() => _estimate = e == null ? null : '≈ ${e.amount} ${e.currency}');
  }

  Future<void> _save() async {
    final q = _quantity.text.trim().replaceAll(',', '.');
    if (_producer == null || _chain == null || _campaign == null) return setState(() => _error = 'Choisissez le producteur, la filière et la campagne.');
    if (!RegExp(r'^\d{1,14}(\.\d{1,3})?$').hasMatch(q) || double.parse(q) <= 0) return setState(() => _error = 'Quantité invalide (nombre positif, 3 décimales maximum).');
    final bags = _bags.text.trim().isEmpty ? null : int.tryParse(_bags.text.trim());
    if (_bags.text.trim().isNotEmpty && (bags == null || bags < 0)) return setState(() => _error = 'Nombre de sacs invalide.');
    setState(() { _saving = true; _error = null; });
    await services.repo.createDeclaration(
        producerId: _producer!['id'] as String, chainId: _chain!['id'] as String, campaignId: _campaign!['id'] as String,
        date: _dateStr, quantity: q, unit: _unit, bags: bags, notes: _notes.text.trim());
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enregistrée sur l\'appareil. Elle sera envoyée dès que possible.')));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Nouvelle déclaration')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_producer == null) ...[
          TextField(controller: _search, decoration: const InputDecoration(labelText: 'Rechercher un producteur (nom, code, téléphone)', prefixIcon: Icon(Icons.search), border: OutlineInputBorder()), onChanged: _findProducers),
          const SizedBox(height: 8),
          if (_producers.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Aucun producteur. Synchronisez pour télécharger la liste.')),
          for (final p in _producers) ListTile(title: Text('${p['last_name']} ${p['first_names']}'), subtitle: Text('${p['internal_code']}  •  ${p['village'] ?? ''}'), onTap: () => _pickProducer(p)),
        ] else ...[
          ListTile(contentPadding: EdgeInsets.zero, title: Text('${_producer!['last_name']} ${_producer!['first_names']}'), subtitle: Text('${_producer!['internal_code']}'),
              trailing: TextButton(onPressed: () => setState(() { _producer = null; _chain = null; _campaign = null; }), child: const Text('Changer'))),
          if (_chains.length > 1) DropdownButtonFormField<Map<String, Object?>>(
              decoration: const InputDecoration(labelText: 'Filière', border: OutlineInputBorder()), value: _chain,
              items: [for (final c in _chains) DropdownMenuItem(value: c, child: Text(c['name'] as String))], onChanged: (c) { if (c != null) _pickChain(c); }),
          if (_chain != null) ...[
            const SizedBox(height: 12),
            Text('Filière : ${_chain!['name']}'),
            const SizedBox(height: 12),
            DropdownButtonFormField<Map<String, Object?>>(
                decoration: const InputDecoration(labelText: 'Campagne', border: OutlineInputBorder()), value: _campaign,
                items: [for (final c in _campaigns) DropdownMenuItem(value: c, child: Text(c['name'] as String))],
                onChanged: (c) { setState(() => _campaign = c); _updateEstimate(); }),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(flex: 3, child: TextField(controller: _quantity, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Quantité', border: OutlineInputBorder()), onChanged: (_) => _updateEstimate())),
              const SizedBox(width: 8),
              Expanded(flex: 2, child: DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Unité', border: OutlineInputBorder()), value: _unit,
                  items: [for (final u in _units) DropdownMenuItem(value: u, child: Text(u))], onChanged: (u) { setState(() => _unit = u!); _updateEstimate(); })),
            ]),
            const SizedBox(height: 12),
            TextField(controller: _bags, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Nombre de sacs (facultatif)', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            ListTile(contentPadding: EdgeInsets.zero, title: Text('Date de l\'opération : $_dateStr'), trailing: const Icon(Icons.calendar_today),
                onTap: () async {
                  final d = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime.now().subtract(const Duration(days: 60)), lastDate: DateTime.now());
                  if (d != null) { setState(() => _date = d); _updateEstimate(); }
                }),
            TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Observations (facultatif)', border: OutlineInputBorder())),
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
