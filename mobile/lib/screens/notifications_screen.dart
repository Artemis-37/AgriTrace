import 'package:flutter/material.dart';

import '../data/notification_target.dart';
import '../main.dart';
import 'fiche_screen.dart';
import 'my_stock_screen.dart';

/// Notifications de l'utilisateur (le serveur ne renvoie que celles qui le concernent selon ses droits). Nécessite le réseau.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await services.repo.cachedGet('notifications', () => services.api.get('/notifications', query: {'limit': '100', 'unread': 'true'}));
    if (!mounted) return;
    if (r == null) {
      setState(() => _error = 'Pas encore de copie des notifications. Lancez la synchronisation avec du réseau.');
    } else {
      setState(() { _items = (r.data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList(); _error = r.stale ? 'Hors connexion : dernières notifications reçues.' : null; });
    }
  }

  Future<void> _readAll() async {
    try { await services.api.post('/notifications/read-all', {}); } catch (_) { /* réessai possible */ }
    await _load();
  }

  /// Ouvre la notification : elle est marquée traitée (elle quitte le fil) puis l'écran concerné s'affiche.
  Future<void> _open(Map<String, dynamic> n) async {
    try { await services.api.post('/notifications/${n['id']}/read', {}); } catch (_) { /* ignoré */ }
    if (mounted) setState(() => _items?.removeWhere((x) => x['id'] == n['id']));
    if (!mounted) return;
    final Widget? screen = switch (notificationTarget(n['kind'] as String?)) {
      NotificationTarget.fiche => const FicheScreen(),
      NotificationTarget.stock => const MyStockScreen(),
      NotificationTarget.none => null,
    };
    if (screen != null) await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  Color _color(String? s) => s == 'critical' ? Colors.red.shade700 : s == 'warning' ? Colors.orange.shade800 : Colors.blueGrey;

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [
        IconButton(tooltip: 'Tout marquer comme lu', icon: const Icon(Icons.done_all), onPressed: _readAll),
      ]),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!)),
          if (items == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
          if (items != null && items.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Rien à traiter.'))),
          ...?items?.map((n) => ListTile(
                leading: Icon(Icons.circle, size: 12, color: n['read_at'] == null ? _color(n['severity'] as String?) : Colors.grey.shade400),
                title: Text('${n['title']}', style: TextStyle(fontWeight: n['read_at'] == null ? FontWeight.w700 : FontWeight.normal)),
                subtitle: Text([if (n['body'] != null) '${n['body']}', '${n['created_at']}'.replaceFirst('T', ' ').substring(0, 16)].join('\n')),
                isThreeLine: n['body'] != null,
                onTap: () => _open(n),
              )),
        ]),
      ),
    );
  }
}
