import 'package:flutter/material.dart';

import '../main.dart';

/// Historique des convois du délégué : ceux créés sur l'appareil (pas encore envoyés), puis ceux du serveur avec leur état
/// (en route, réceptionné au magasin, réglé), le poids pesé, l'écart et le montant. Un convoi se déplie pour montrer les achats chargés.
class ConvoyHistoryScreen extends StatefulWidget {
  const ConvoyHistoryScreen({super.key});
  @override
  State<ConvoyHistoryScreen> createState() => _ConvoyHistoryScreenState();
}

class _ConvoyHistoryScreenState extends State<ConvoyHistoryScreen> {
  List<Map<String, Object?>> _local = [];
  List<dynamic>? _remote;
  String? _error;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final local = await services.repo.localConvoys();
    if (mounted) setState(() => _local = local);
    final r = await services.repo.cachedGet('convoys', () => services.api.get('/convoys'));
    if (!mounted) return;
    if (r == null) {
      setState(() => _error = 'Hors connexion : seuls les convois de cet appareil sont affichés. Tirez pour réessayer.');
    } else {
      setState(() { _remote = r.data as List<dynamic>; _error = r.stale ? 'Hors connexion : dernière copie des convois. Tirez pour actualiser.' : null; });
    }
  }

  static String _date(Object? v) => v == null ? '' : '$v'.length >= 10 ? '$v'.substring(0, 10) : '$v';
  static String _kg(Object? v) { final n = double.tryParse('$v'); return n == null ? '—' : '${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 1)} kg'; }
  static String _fcfa(Object? v) { final n = double.tryParse('$v'); return n == null ? '—' : '${n.toStringAsFixed(0).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (m) => ' ')} FCFA'; }

  ({String label, Color color}) _state(Map c) {
    final st = '${c['status']}';
    if (st == 'settled') return (label: 'Réglé', color: const Color(0xFF0B5E3B));
    if (st == 'received') return (label: c['reception_status'] == 'awaiting_cashier' ? 'Réceptionné · attend la caisse' : 'Réceptionné', color: const Color(0xFF1E6FB0));
    return (label: 'En route', color: const Color(0xFFB26A00));
  }

  @override
  Widget build(BuildContext context) {
    final remote = (_remote ?? []).where((c) => _filter == 'all' || '${(c as Map)['status']}' == _filter).toList();
    final total = remote.fold<double>(0, (s, c) => s + (double.tryParse('${(c as Map)['total_kg'] ?? c['declared_kg']}') ?? 0));
    return Scaffold(
      appBar: AppBar(title: const Text('Historique des convois')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 24), children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: const TextStyle(color: Colors.black54))),
          Wrap(spacing: 8, children: [
            for (final f in const [('all', 'Tous'), ('in_transit', 'En route'), ('received', 'Réceptionnés'), ('settled', 'Réglés')])
              ChoiceChip(label: Text(f.$2), selected: _filter == f.$1, onSelected: (_) => setState(() => _filter = f.$1)),
          ]),
          if (_remote != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text('${remote.length} convoi(s) · ${_kg(total)}', style: const TextStyle(color: Colors.black54))),
          if (_filter == 'all' && _local.isNotEmpty) ...[
            const Padding(padding: EdgeInsets.only(top: 4, bottom: 4), child: Text('Sur cet appareil, pas encore envoyés', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFB26A00)))),
            for (final c in _local)
              Card(elevation: 0, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(14)), child: ListTile(
                leading: const Icon(Icons.schedule_send_outlined),
                title: Text('${c['convoy_no'] ?? 'Numéro automatique'}'),
                subtitle: Text('${c['driver_name']} · ${c['truck_no']}\nDéclaré : ${_kg(c['declared_kg'])}${c['declared_bags'] != null ? ' · ${c['declared_bags']} sacs' : ''}'),
                isThreeLine: true, trailing: Text('${c['local_status']}' == 'pending' ? 'À envoyer' : 'À corriger', style: const TextStyle(color: Color(0xFFB26A00))))),
          ],
          if (_remote == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (_remote != null && remote.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('Aucun convoi.'))),
          for (final c in remote) _tile(Map<String, dynamic>.from(c as Map)),
        ]),
      ),
    );
  }

  Widget _tile(Map<String, dynamic> c) {
    final s = _state(c);
    final weighed = c['total_kg'] != null;
    return Card(elevation: 0, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(14)), child: ExpansionTile(
      shape: const Border(), collapsedShape: const Border(),
      leading: const Icon(Icons.local_shipping_outlined),
      title: Text('${c['convoy_no']}', style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text('${_date(c['created_at'])} · ${c['driver_name']} · ${c['truck_no']}'),
      trailing: Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), decoration: BoxDecoration(color: s.color.withOpacity(.12), borderRadius: BorderRadius.circular(10)),
          child: Text(s.label, style: TextStyle(color: s.color, fontSize: 12, fontWeight: FontWeight.w600))),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      expandedCrossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _line('Déclaré', '${_kg(c['declared_kg'])}${c['declared_bags'] != null ? ' · ${c['declared_bags']} sacs' : ''}'),
        if (c['product'] != null) _line('Produit', '${c['product']}'),
        if (weighed) _line('Pesé au magasin', '${_kg(c['total_kg'])}${c['bags'] != null ? ' · ${c['bags']} sacs' : ''}'),
        if (weighed && c['variance_kg'] != null) _line('Écart', _kg(c['variance_kg'])),
        if (weighed && c['amount'] != null) _line('Montant', _fcfa(c['amount'])),
        if ((c['notes'] ?? '').toString().isNotEmpty) _line('Notes', '${c['notes']}'),
        _Purchases(convoyId: '${c['id']}'),
      ],
    ));
  }

  Widget _line(String k, String v) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 130, child: Text(k, style: const TextStyle(color: Colors.black54))), Expanded(child: Text(v))]));
}

/// Achats chargés dans le convoi (chargés à l'ouverture de la ligne).
class _Purchases extends StatefulWidget {
  const _Purchases({required this.convoyId});
  final String convoyId;
  @override
  State<_Purchases> createState() => _PurchasesState();
}

class _PurchasesState extends State<_Purchases> {
  List<dynamic>? _rows;
  bool _failed = false;
  @override
  void initState() {
    super.initState();
    services.repo.cachedGet('convoy-decl-${widget.convoyId}', () => services.api.get('/convoys/${widget.convoyId}/declarations')).then((r) {
      if (!mounted) return;
      if (r == null) { setState(() => _failed = true); } else { setState(() => _rows = r.data as List<dynamic>); }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) return const Padding(padding: EdgeInsets.only(top: 6), child: Text('Achats non encore chargés : ouvrez ce convoi une fois avec du réseau (ou lancez la synchronisation).', style: TextStyle(color: Colors.black54)));
    if (_rows == null) return const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator());
    if (_rows!.isEmpty) return const Padding(padding: EdgeInsets.only(top: 6), child: Text('Aucun achat rattaché.', style: TextStyle(color: Colors.black54)));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Padding(padding: EdgeInsets.only(top: 8, bottom: 2), child: Text('Achats chargés', style: TextStyle(fontWeight: FontWeight.bold))),
      for (final r in _rows!) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text(
          '${_ConvoyHistoryScreenState._date((r as Map)['operation_date'])} · ${r['producer_name']} · ${_ConvoyHistoryScreenState._kg(r['kg'])}${r['bags'] != null ? ' · ${r['bags']} sacs' : ''}')),
    ]);
  }
}
