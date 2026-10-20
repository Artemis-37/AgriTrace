import 'package:flutter/material.dart';

import '../main.dart';

/// Déclaration d'un convoi par le collecteur : n° de connaissement intérieur, chauffeur, camion. Fonctionne sans réseau.
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

  bool get _valid => _no.text.trim().length >= 2 && _driver.text.trim().length >= 2 && _truck.text.trim().length >= 2;

  @override
  void dispose() {
    _no.dispose(); _driver.dispose(); _truck.dispose(); _bags.dispose(); _kg.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    await services.repo.queueConvoy(
      convoyNo: _no.text, driverName: _driver.text, truckNo: _truck.text,
      declaredBags: int.tryParse(_bags.text.trim()), declaredKg: _kg.text.trim().replaceAll(',', '.'),
    );
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Déclarer un convoi')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _no, decoration: const InputDecoration(labelText: 'N° de connaissement du convoi'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        TextField(controller: _driver, decoration: const InputDecoration(labelText: 'Nom du chauffeur'), onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
        TextField(controller: _truck, decoration: const InputDecoration(labelText: 'N° du camion'), textCapitalization: TextCapitalization.characters, onChanged: (_) => setState(() {})),
        const SizedBox(height: 12),
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
