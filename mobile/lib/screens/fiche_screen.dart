import 'package:flutter/material.dart';

import '../main.dart';

/// Fiche de suivi du compte du délégué (modèle papier de la coopérative) : report, financements, livraisons et solde courant. Nécessite le réseau.
class FicheScreen extends StatefulWidget {
  const FicheScreen({super.key});
  @override
  State<FicheScreen> createState() => _FicheScreenState();
}

class _FicheScreenState extends State<FicheScreen> {
  Map<String, dynamic>? _d;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.cachedGet('statement', () => services.api.get('/convoys/statement'));
    if (!mounted) return;
    if (r == null) {
      setState(() => _error = 'Pas encore de copie de la fiche sur cet appareil. Lancez la synchronisation avec du réseau.');
    } else {
      setState(() { _d = Map<String, dynamic>.from(r.data as Map); _error = r.stale ? 'Hors connexion : dernière copie de la fiche. Tirez pour actualiser.' : null; });
    }
  }

  String _f(Object? v) => (double.tryParse('$v') ?? 0).round().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ' ');

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final rows = (d?['rows'] as List?) ?? const [];
    // Solde de la fiche : positif = j'ai reçu plus que je n'ai livré (je dois à la coopérative) ; négatif = la coopérative me doit.
    final solde = double.tryParse('${d?['solde']}') ?? 0;
    return Scaffold(
      appBar: AppBar(title: const Text('Ma fiche de compte')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
          if (d == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (d != null) ...[
            ListTile(title: const Text('Report'), trailing: Text('${_f(d['opening'])} FCFA')),
            for (final r in rows)
              ListTile(
                title: Text('${r['label'] ?? ''}'),
                subtitle: Text('${r['date'].toString().substring(0, 10)}${r['piece'] != null ? ' • pièce ${r['piece']}' : ''}${r['weight'] != null ? ' • ${_f(r['weight'])} kg' : ''}'),
                trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text('${r['direction'] == 'in' ? '+' : '−'}${_f(r['amount'])}', style: TextStyle(color: r['direction'] == 'in' ? Colors.green.shade700 : Colors.red.shade700, fontWeight: FontWeight.bold)),
                  Text('solde ${_f(r['solde'])}', style: const TextStyle(fontSize: 12)),
                ]),
              ),
            if (rows.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Aucune ligne sur la période.'))),
            const Divider(),
            ListTile(
              title: Text(solde > 0 ? 'Je dois à la coopérative' : 'La coopérative me doit', style: const TextStyle(fontWeight: FontWeight.bold)),
              trailing: Text('${_f(solde.abs())} FCFA', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
          ],
        ]),
      ),
    );
  }
}
