import 'package:flutter/material.dart';

import '../main.dart';

/// Historique des achats du délégué : tous ses achats enregistrés sur le serveur, du plus récent au plus ancien. Consultation seule (pas d'export).
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

const _states = {
  'draft': 'Brouillon', 'received': 'Reçu', 'in_review': 'En vérification', 'to_correct': 'À corriger', 'accepted': 'Acceptée',
  'partially_received': 'Reçue en partie', 'received_confirmed': 'Réception confirmée', 'rejected': 'Refusée', 'cancelled': 'Annulée',
};

class _HistoryScreenState extends State<HistoryScreen> {
  List<dynamic>? _rows;
  String? _error;
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.cachedGet('purchases-$_filter', () => services.api.get('/purchase-declarations', query: {'limit': '200', if (_filter.isNotEmpty) 'status': _filter}));
    if (!mounted) return;
    if (r == null) {
      setState(() => _error = 'Pas encore de copie de l\'historique. Les achats de cet appareil sont sur l\'écran « Mes achats ».');
    } else {
      setState(() { _rows = r.data as List<dynamic>; _error = r.stale ? 'Hors connexion : dernière copie de l\'historique.' : null; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Scaffold(
      appBar: AppBar(title: const Text('Historique de mes achats')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: DropdownButtonFormField<String>(
            value: _filter,
            decoration: const InputDecoration(labelText: 'État', border: OutlineInputBorder()),
            items: [const DropdownMenuItem(value: '', child: Text('Tous')), for (final e in _states.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) { setState(() { _filter = v ?? ''; _rows = null; }); _load(); },
          ),
        ),
        if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
        if (rows == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()),
        if (rows != null)
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: rows.isEmpty
                  ? ListView(children: const [SizedBox(height: 80), Center(child: Text('Aucun achat.'))])
                  : ListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final d = Map<String, dynamic>.from(rows[i] as Map);
                        final amount = double.tryParse('${d['amount']}');
                        return ListTile(
                          title: Text('${d['producer_name'] ?? 'Producteur'} • ${d['quantity']} ${d['unit']}'),
                          subtitle: Text('${d['operation_date'].toString().substring(0, 10)} • ${d['bags'] ?? '—'} sacs • reçu ${d['purchase_receipt_no'] ?? '—'}'),
                          trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text(_states[d['status']] ?? '${d['status']}', style: const TextStyle(fontSize: 12)),
                            if (amount != null) Text('${amount.toStringAsFixed(0)} FCFA', style: const TextStyle(fontWeight: FontWeight.bold)),
                          ]),
                        );
                      }),
            ),
          ),
      ]),
    );
  }
}
