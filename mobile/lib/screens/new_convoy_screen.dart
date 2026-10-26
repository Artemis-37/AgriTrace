import 'package:flutter/material.dart';

import '../main.dart';

/// Déclaration d'un convoi par le délégué : n° de connaissement intérieur, chauffeur, camion. Fonctionne sans réseau.
class NewConvoyScreen extends StatefulWidget {
  const NewConvoyScreen({super.key});
  @override
  State<NewConvoyScreen> createState() => _NewConvoyScreenState();
}

class _NewConvoyScreenState extends State<NewConvoyScreen> {
  final _no = TextEditingController();
  final _driver = TextEditingController();
  final _truck = TextEditingController();
  final _bags = TextEditingController();
  final _kg = TextEditingController();
  bool _busy = false;
  /// null : inconnu (hors connexion) ; true : numéro automatique (code CCC renseigné) ; false : saisie manuelle.
  bool? _auto;
  String? _autoNo;
  List<Map<String, Object?>> _linkable = [];
  final Set<String> _picked = {};
  List<Map<String, Object?>> _products = [];
  String? _product;

  @override
  void initState() {
    super.initState();
    _loadLinkable();
    _loadNumber();
    services.repo.products(() => services.api.get('/products')).then((p) { if (mounted) setState(() { _products = p; if (p.length == 1) _product = p.first['id'] as String?; }); });
  }

  /// Aperçu du prochain numéro de connaissement (le serveur l'attribue définitivement à l'envoi).
  Future<void> _loadNumber() async {
    try {
      final pending = await services.repo.pendingConvoys();
      final c = await services.repo.cachedGet('convoy-auto', () => services.api.get('/convoys/next-number', query: {'pending': '$pending'}));
      if (c == null || !mounted) return;
      final r = c.data as Map;
      // Hors connexion : on retient seulement si la numérotation est automatique ; le numéro exact est attribué à l'envoi.
      setState(() { _auto = r['auto'] == true; _autoNo = c.stale ? null : r['convoy_no'] as String?; });
    } catch (_) { /* hors connexion : numéro attribué à l'envoi si la coopérative a un code CCC */ }
  }

  /// Achats à charger : ceux de l'appareil, recoupés avec la liste du serveur quand la connexion le permet.
  Future<void> _loadLinkable() async {
    Set<String>? server;
    try {
      final r = await services.api.get('/convoys/available-declarations') as List;
      server = r.map((e) => (e as Map)['id'] as String).toSet();
    } catch (_) { /* hors connexion : liste locale */ }
    final rows = await services.repo.linkableDeclarations(serverAvailableIds: server);
    if (mounted) setState(() => _linkable = rows);
  }

  bool get _valid => (_auto != false || _no.text.trim().length >= 2) && _driver.text.trim().length >= 2 && _truck.text.trim().length >= 2;

  @override
  void dispose() {
    _no.dispose(); _driver.dispose(); _truck.dispose(); _bags.dispose(); _kg.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    await services.repo.queueConvoy(
      convoyNo: _auto == true ? null : _no.text, driverName: _driver.text, truckNo: _truck.text,
      declaredBags: int.tryParse(_bags.text.trim()), declaredKg: _kg.text.trim().replaceAll(',', '.'), productId: _product, declarationIds: _picked.toList(),
    );
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Déclarer un convoi')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_auto == true)
          InputDecorator(
            decoration: const InputDecoration(labelText: 'N° de connaissement (automatique)', helperText: 'Attribué par le logiciel : code CCC, année, 3 lettres de votre nom, n° d\'ordre. Définitif à l\'envoi.'),
            child: Text(_autoNo ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
          )
        else
          TextField(
            controller: _no,
            decoration: InputDecoration(labelText: 'N° de connaissement du convoi', helperText: _auto == null ? 'Laissez vide si la coopérative a un code CCC : le numéro est alors attribué à l\'envoi.' : null),
            onChanged: (_) => setState(() {}),
          ),
        const SizedBox(height: 12),
        TextField(controller: _driver, decoration: const InputDecoration(labelText: 'Nom du chauffeur'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        TextField(controller: _truck, decoration: const InputDecoration(labelText: 'N° du camion'), textCapitalization: TextCapitalization.characters, onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        if (_products.isNotEmpty) ...[
          DropdownButtonFormField<String>(
            initialValue: _product, isExpanded: true,
            decoration: const InputDecoration(labelText: 'Produit convoyé', helperText: 'Le magasinier peut le corriger à la pesée.'),
            items: [for (final p in _products) DropdownMenuItem(value: p['id'] as String, child: Text('${p['name']}'))],
            onChanged: (v) => setState(() => _product = v),
          ),
          const SizedBox(height: 12),
        ],
        if (_linkable.isNotEmpty) ...[
          const Text('Achats chargés dans ce convoi (facultatif)', style: TextStyle(fontWeight: FontWeight.w600)),
          for (final d in _linkable)
            CheckboxListTile(
              dense: true, contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading,
              value: _picked.contains(d['id']), title: Text('${d['producer_name'] ?? ''}'),
              subtitle: Text('${d['operation_date']} · ${d['quantity']} ${d['unit']} · ${d['bags'] ?? 0} sacs'),
              onChanged: (v) => setState(() { v == true ? _picked.add(d['id'] as String) : _picked.remove(d['id']); }),
            ),
          if (_picked.isNotEmpty) const Padding(padding: EdgeInsets.only(bottom: 8), child: Text('Si vous laissez le poids et les sacs vides, ils sont déduits de ces achats par le serveur.')),
          const SizedBox(height: 8),
        ],
        TextField(controller: _bags, decoration: const InputDecoration(labelText: 'Nombre de sacs annoncé (facultatif)'), keyboardType: TextInputType.number),
        const SizedBox(height: 12),
        TextField(controller: _kg, decoration: const InputDecoration(labelText: 'Poids annoncé en kg (facultatif)'), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
        const SizedBox(height: 24),
        FilledButton(onPressed: _valid && !_busy ? _save : null, child: const Text('Enregistrer sur l\'appareil')),
        const SizedBox(height: 8),
        const Text('Le convoi est envoyé dès que la connexion est disponible. Le magasinier le réceptionnera avec ce numéro.'),
      ]),
    );
  }
}
