import 'package:flutter/material.dart';

import '../main.dart';
import '../sync/sync_engine.dart';
import '../sync/sync_state.dart';
import 'login_screen.dart';
import 'new_convoy_screen.dart';
import 'new_declaration_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, Object?>> _items = [];
  int _pending = 0;
  int _problems = 0;
  bool _canCreate = false;
  bool _canConvoy = false;

  @override
  void initState() {
    super.initState();
    services.sync.status.addListener(_reload);
    _reload();
  }

  @override
  void dispose() {
    services.sync.status.removeListener(_reload);
    super.dispose();
  }

  Future<void> _reload() async {
    final items = await services.repo.declarations();
    final pending = await services.db.pendingCount();
    final problems = await services.db.problemCount();
    final perms = await services.repo.permissions();
    if (!mounted) return;
    setState(() { _items = items; _pending = pending; _problems = problems; _canCreate = canCreateDeclaration(perms); _canConvoy = canCreateConvoy(perms); });
  }

  Color _color(String localState, String? status) {
    if (localState == 'error' || status == 'rejected' || status == 'to_correct') return Colors.red.shade700;
    if (localState == 'local_only' || localState == 'pending' || localState == 'pending_validation') return Colors.orange.shade800;
    if (status == 'received_confirmed' || status == 'accepted') return Colors.green.shade800;
    return Colors.blueGrey;
  }

  Future<void> _signOut() async {
    if (_pending > 0) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Opérations non envoyées'),
          content: Text("$_pending opération(s) n'ont pas encore été envoyées. Elles sont conservées sur l'appareil et seront envoyées à la prochaine connexion."),
          actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Se déconnecter'))],
        ),
      );
      if (ok != true) return;
    }
    await services.store.signOut();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Déclarations d\'achat'), actions: [
        if (_canConvoy)
          IconButton(tooltip: 'Déclarer un convoi', icon: const Icon(Icons.local_shipping_outlined), onPressed: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NewConvoyScreen()));
            await _reload();
            services.sync.run();
          }),
        IconButton(tooltip: 'Synchroniser', icon: const Icon(Icons.sync), onPressed: () => services.sync.run()),
        IconButton(tooltip: 'Se déconnecter', icon: const Icon(Icons.logout), onPressed: _signOut),
      ]),
      floatingActionButton: _canCreate
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add), label: const Text('Nouvelle déclaration'),
              onPressed: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NewDeclarationScreen()));
                await _reload();
                services.sync.run(); // envoi immédiat si la connexion est disponible
              })
          : null,
      body: Column(children: [
        ValueListenableBuilder<SyncStatus>(
          valueListenable: services.sync.status,
          builder: (_, s, __) => _SyncBanner(status: s, pending: _pending, problems: _problems),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async { await services.sync.run(); await _reload(); },
            child: _items.isEmpty
                ? ListView(children: const [SizedBox(height: 120), Center(child: Text('Aucune déclaration.\nTirez pour synchroniser.', textAlign: TextAlign.center))])
                : ListView.separated(
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final d = _items[i];
                      final ls = d['local_state'] as String;
                      final st = d['status'] as String?;
                      final label = declarationLabel(localState: ls, status: st);
                      final amount = d['amount'] as String?;
                      return ListTile(
                        title: Text('${d['producer_name'] ?? 'Producteur'}  •  ${d['quantity']} ${d['unit']}'),
                        subtitle: Text([
                          d['operation_date'], label,
                          if (d['purchase_receipt_no'] != null) 'Reçu ${d['purchase_receipt_no']}${d['receipt_conflict'] == 1 ? ' (numéro déjà utilisé — à résoudre)' : ''}',
                          if (amount != null) 'Montant ${double.parse(amount).toStringAsFixed(0)} ${d['currency'] ?? ''}',
                          if (d['local_error'] != null) '${d['local_error']}',
                        ].join('  •  ')),
                        leading: Icon(ls == 'synced' ? Icons.cloud_done : Icons.cloud_off, color: _color(ls, st)),
                        trailing: ls == 'error'
                            ? IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Abandonner',
                                onPressed: () async { await services.repo.discardFailed(d['id'] as String); await _reload(); })
                            : null,
                      );
                    }),
          ),
        ),
      ]),
    );
  }
}

class _SyncBanner extends StatelessWidget {
  final SyncStatus status;
  final int pending;
  final int problems;
  const _SyncBanner({required this.status, required this.pending, required this.problems});

  @override
  Widget build(BuildContext context) {
    String text;
    Color color;
    switch (status.phase) {
      case SyncPhase.syncing:
        text = 'Synchronisation en cours…'; color = Colors.blueGrey; break;
      case SyncPhase.offline:
        text = 'Hors connexion — les saisies sont conservées sur l\'appareil'; color = Colors.orange.shade800; break;
      case SyncPhase.blocked:
        text = 'Accès refusé : reconnectez-vous ou contactez votre administrateur'; color = Colors.red.shade700; break;
      case SyncPhase.error:
        text = 'Erreur de synchronisation : ${status.message ?? ''}'; color = Colors.red.shade700; break;
      case SyncPhase.idle:
        text = status.lastSuccess == null ? 'Pas encore synchronisé' : 'Synchronisé à ${TimeOfDay.fromDateTime(status.lastSuccess!).format(context)}';
        color = Colors.green.shade800; break;
    }
    final extra = [if (pending > 0) '$pending en attente', if (problems > 0) '$problems à corriger'].join('  •  ');
    return Container(
      width: double.infinity,
      color: color.withOpacity(0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(extra.isEmpty ? text : '$text\n$extra', style: TextStyle(color: color, fontWeight: FontWeight.w600)),
    );
  }
}
