import 'package:flutter/material.dart';

import '../main.dart';

/// Stock acheté du délégué : acheté, en route, livré au magasin central et solde du compte. Nécessite le réseau.
class MyStockScreen extends StatefulWidget {
  const MyStockScreen({super.key});
  @override
  State<MyStockScreen> createState() => _MyStockScreenState();
}

class _MyStockScreenState extends State<MyStockScreen> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.cachedGet('my-stock', () => services.api.get('/convoys/my-stock'));
    if (!mounted) return;
    if (r == null) {
      setState(() => _error = 'Pas encore de copie du stock sur cet appareil. Lancez la synchronisation avec du réseau.');
    } else {
      setState(() { _data = Map<String, dynamic>.from(r.data as Map); _error = r.stale ? 'Hors connexion : dernière copie du stock. Tirez pour actualiser.' : null; });
    }
  }

  String _kg(Object? v) => '${double.tryParse('$v')?.toStringAsFixed(1) ?? '—'} kg';

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final rows = d == null
        ? <Widget>[]
        : [
            ListTile(title: const Text('Acheté (déclaré)'), trailing: Text(_kg(d['purchased_kg'])), subtitle: Text('${d['purchases']} achat(s) • ${d['purchased_bags']} sacs')),
            ListTile(title: const Text('En route (convois)'), trailing: Text(_kg(d['in_transit_kg'])), subtitle: Text('${d['in_transit_convoys']} convoi(s)')),
            ListTile(title: const Text('Livré au magasin central'), trailing: Text(_kg(d['delivered_kg'])), subtitle: Text('${d['delivered_bags']} sacs')),
            ListTile(title: const Text('Encore chez moi (estimé)'), trailing: Text(_kg(d['held_kg']))),
            ListTile(
              title: const Text('Solde de ma fiche (négatif : la coopérative me doit)'),
              trailing: Text('${(-(double.tryParse('${d['balance']}') ?? 0)).toStringAsFixed(0)} FCFA', style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: (d['awaiting_cashier'] as int? ?? 0) > 0 ? Text('${d['awaiting_cashier']} réception(s) en attente de la caisse') : null,
            ),
          ];
    return Scaffold(
      appBar: AppBar(title: const Text('Mon stock')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
          if (d == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          ...rows,
        ]),
      ),
    );
  }
}
