import 'package:flutter/material.dart';

import '../main.dart';
import '../sync/sync_engine.dart';
import '../sync/sync_state.dart';
import 'login_screen.dart';
import 'fiche_screen.dart';
import 'history_screen.dart';
import 'missions_screen.dart';
import 'my_stock_screen.dart';
import 'notifications_screen.dart';
import 'parcel_survey_screen.dart';
import 'parcels_screen.dart';
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
  bool _canHistory = false, _canFiche = false, _canMissions = false, _canSurvey = false;
  int _unreadNotes = 0;

  @override
  void initState() {
    super.initState();
    services.sync.status.addListener(_reload);
    services.sync.revoked.addListener(_onRevoked);
    _reload();
  }

  @override
  void dispose() {
    services.sync.status.removeListener(_reload);
    services.sync.revoked.removeListener(_onRevoked);
    super.dispose();
  }

  void _onRevoked() {
    if (!services.sync.revoked.value || !mounted) return;
    services.sync.revoked.value = false;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen(notice: "Votre accès a été retiré par l'administrateur. Les données de la coopérative ont été effacées de ce téléphone ; les saisies non envoyées sont conservées.")),
      (r) => false,
    );
  }

  Future<void> _reload() async {
    final items = await services.repo.declarations();
    final pending = await services.db.pendingCount();
    final problems = await services.db.problemCount();
    final perms = await services.repo.permissions();
    int unread = _unreadNotes;
    try { final r = await services.api.get('/notifications/unread-count'); unread = (r['unread'] as num?)?.toInt() ?? 0; } catch (_) { /* hors connexion : compteur conservé */ }
    if (!mounted) return;
    setState(() { _items = items; _pending = pending; _problems = problems; _canCreate = canCreateDeclaration(perms); _canConvoy = canCreateConvoy(perms); _canHistory = canReadHistory(perms); _canFiche = canSeeFiche(perms); _canMissions = canSeeMissions(perms); _canSurvey = canSurveyParcel(perms); _unreadNotes = unread; });
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
      appBar: AppBar(title: const Text('Mes achats'), actions: [
        if (_canHistory)
          IconButton(tooltip: 'Historique', icon: const Icon(Icons.history), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HistoryScreen()))),
        if (_canFiche)
          IconButton(tooltip: 'Ma fiche de compte', icon: const Icon(Icons.receipt_long_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const FicheScreen()))),
        if (_canSurvey)
          IconButton(tooltip: 'Relever une parcelle', icon: const Icon(Icons.map_outlined), onPressed: () async {
            final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const ParcelSurveyScreen()));
            if (saved == true) services.sync.run();
          }),
        if (_canSurvey)
          IconButton(tooltip: 'Mes parcelles', icon: const Icon(Icons.landscape_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ParcelsScreen()))),
        if (_canMissions)
          IconButton(tooltip: 'Mes missions', icon: const Icon(Icons.assignment_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MissionsScreen()))),
        if (_canConvoy)
          IconButton(tooltip: 'Mon stock', icon: const Icon(Icons.inventory_2_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MyStockScreen()))),
        if (_canConvoy)
          IconButton(tooltip: 'Déclarer un convoi', icon: const Icon(Icons.local_shipping_outlined), onPressed: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NewConvoyScreen()));
            await _reload();
            services.sync.run();
          }),
        IconButton(
          tooltip: _unreadNotes > 0 ? 'Notifications ($_unreadNotes non lues)' : 'Notifications',
          icon: Badge(isLabelVisible: _unreadNotes > 0, label: Text('$_unreadNotes'), child: const Icon(Icons.notifications_outlined)),
          onPressed: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
            await _reload();
          }),
        IconButton(tooltip: 'Synchroniser', icon: const Icon(Icons.sync), onPressed: () => services.sync.run()),
        IconButton(tooltip: 'Se déconnecter', icon: const Icon(Icons.logout), onPressed: _signOut),
      ]),
      floatingActionButton: _canCreate
          ? FloatingActionButton.extended(
              icon: const Icon(Icons.add), label: const Text('Achat'),
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
