import 'package:flutter/material.dart';

import '../config.dart';
import '../main.dart';
import '../sync/sync_engine.dart';
import '../sync/sync_state.dart';
import 'login_screen.dart';
import 'fiche_screen.dart';
import 'history_screen.dart';
import 'my_stock_screen.dart';
import 'notifications_screen.dart';
import 'producers_screen.dart';
import 'download_screen.dart';
import 'my_location_screen.dart';
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
  ({String name, String org, String zone}) _identity = (name: '', org: '', zone: '');

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
    final identity = await services.repo.identity();
    int unread = _unreadNotes;
    try { final r = await services.api.get('/notifications/unread-count'); unread = (r['unread'] as num?)?.toInt() ?? 0; } catch (_) { /* hors connexion : compteur conservé */ }
    if (!mounted) return;
    setState(() { _items = items; _pending = pending; _problems = problems; _canCreate = canCreateDeclaration(perms); _canConvoy = canCreateConvoy(perms); _canHistory = canReadHistory(perms); _canFiche = canSeeFiche(perms); _canMissions = canSeeMissions(perms); _canSurvey = canSurveyParcel(perms); _unreadNotes = unread; _identity = identity; });
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

  String _two(int n) => n.toString().padLeft(2, '0');
  String get _now { final d = DateTime.now(); return '${_two(d.day)}-${_two(d.month)}-${d.year} ${_two(d.hour)}:${_two(d.minute)}'; }

  /// Total des achats du jour (calculé sur l'appareil, donc disponible hors connexion).
  ({int count, double amount}) get _today {
    final d = DateTime.now();
    final key = '${d.year}-${_two(d.month)}-${_two(d.day)}';
    var n = 0; var sum = 0.0;
    for (final x in _items) {
      if ('${x['operation_date']}'.startsWith(key)) { n++; sum += double.tryParse('${x['amount']}') ?? 0; }
    }
    return (count: n, amount: sum);
  }

  Future<void> _open(Widget screen, {bool sync = false}) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    await _reload();
    if (sync) services.sync.run(); // envoi immédiat si la connexion est disponible
  }

  @override
  Widget build(BuildContext context) {
    final t = _today;
    final buttons = <_HomeButton>[
      if (_canCreate) _HomeButton(Icons.add_shopping_cart, 'Acheter du produit', () => _open(const NewDeclarationScreen(), sync: true)),
      if (_canHistory) _HomeButton(Icons.history, 'Historique des achats', () => _open(const HistoryScreen())),
      if (_canConvoy) _HomeButton(Icons.local_shipping_outlined, 'Déclarer un convoi', () => _open(const NewConvoyScreen(), sync: true)),
      if (_canConvoy) _HomeButton(Icons.inventory_2_outlined, 'Mon stock', () => _open(const MyStockScreen())),
      if (_canFiche) _HomeButton(Icons.receipt_long_outlined, 'Ma fiche de compte', () => _open(const FicheScreen())),
      if (_canSurvey || _canMissions) _HomeButton(Icons.fact_check_outlined, 'Producteurs et enquêtes', () => _open(const ProducersScreen())),
    ];
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      body: Column(children: [
        _HomeHeader(
          now: _now, name: _identity.name, org: _identity.org, zone: _identity.zone,
          count: _coachMode ? null : t.count, unread: _unreadNotes, onNotes: () => _open(const NotificationsScreen()),
          onSync: () => services.sync.run(),
          onSignOut: _signOut,
        ),
        ValueListenableBuilder<SyncStatus>(
          valueListenable: services.sync.status,
          builder: (_, s, __) => _SyncBanner(status: s, pending: _pending, problems: _problems),
        ),
        if (_coachMode) Expanded(child: _coachBody()) else Expanded(
          child: RefreshIndicator(
            onRefresh: () async { await services.sync.run(); await _reload(); },
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 24), children: [
              for (final b in buttons) Padding(padding: const EdgeInsets.only(bottom: 12), child: b),
              if (_items.isNotEmpty) ...[
                const Padding(padding: EdgeInsets.only(top: 8, bottom: 4), child: Text('Achats récents', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0B5E3B)))),
                for (final d in _items.take(20)) _purchaseTile(d),
              ] else
                const Padding(padding: EdgeInsets.all(16), child: Center(child: Text('Aucun achat.\nTirez pour synchroniser.', textAlign: TextAlign.center))),
            ]),
          ),
        ),
      ]),
    );
  }

  /// Profil terrain (coach) : pas d'achats ni de convoi, mais des relevés de parcelles et des missions.
  bool get _coachMode => !_canCreate && !_canConvoy && (_canSurvey || _canMissions);

  Widget _tile(IconData icon, String label, VoidCallback onTap, {double height = 120}) => Material(
        color: const Color(0xFF3F9B2E), elevation: 2, borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6), onTap: onTap,
          child: SizedBox(height: height, child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, color: Colors.white, size: 44),
              const SizedBox(height: 8),
              Text(label.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
            ]),
          )),
        ),
      );

  Widget _coachBody() {
    // Même organisation que le terminal de terrain : les parcelles et les tâches se consultent depuis la fiche du producteur.
    final big = <Widget>[
      _tile(Icons.fact_check_outlined, 'Producteurs et enquêtes', () => _open(const ProducersScreen()), height: 150),
    ];
    final small = <Widget>[
      _tile(Icons.download_for_offline_outlined, 'Télécharger les données', () => _open(const DownloadScreen())),
      _tile(Icons.my_location, 'Capturer mon emplacement', () => _open(const MyLocationScreen())),
    ];
    Widget row(List<Widget> w) => Row(children: [for (var i = 0; i < w.length; i++) ...[if (i > 0) const SizedBox(width: 10), Expanded(child: w[i])]]);
    return RefreshIndicator(
      onRefresh: () async { await services.sync.run(); await _reload(); },
      child: ListView(padding: const EdgeInsets.fromLTRB(12, 14, 12, 24), children: [
        if (big.isNotEmpty) row(big),
        if (big.isNotEmpty) const SizedBox(height: 10),
        if (small.isNotEmpty) row(small),
        const SizedBox(height: 16),
        Material(
          color: const Color(0xFFE9EEE3),
          child: InkWell(
            onTap: () => services.sync.run(),
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14), child: Row(children: [
              const Text('Éléments à soumettre', style: TextStyle(fontSize: 18)),
              const SizedBox(width: 10),
              CircleAvatar(radius: 16, backgroundColor: const Color(0xFF6B73C1), child: Text('$_pending', style: const TextStyle(color: Colors.white))),
              const Spacer(),
              const Icon(Icons.cloud_upload_outlined, size: 28),
            ])),
          ),
        ),
        if (_problems > 0) Padding(padding: const EdgeInsets.only(top: 8), child: Text('$_problems opération(s) à corriger', style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w700))),
        if (_pending == 0 && _problems == 0) const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('Rien à envoyer : tout est synchronisé.'))),
      ]),
    );
  }

  Widget _purchaseTile(Map<String, Object?> d) {
    final ls = d['local_state'] as String;
    final st = d['status'] as String?;
    final label = declarationLabel(localState: ls, status: st);
    final amount = d['amount'] as String?;
    return Card(
      margin: const EdgeInsets.only(bottom: 6), elevation: 0, color: Colors.white,
      child: ListTile(
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
      ),
    );
  }
}

/// En-tête de l'accueil, sur le modèle du terminal SNT : date, salutation, coopérative, zone, total du jour.
class _HomeHeader extends StatelessWidget {
  final String now, name, org, zone;
  final int? count;
  final int unread;
  final VoidCallback onSync, onSignOut, onNotes;
  const _HomeHeader({required this.now, required this.name, required this.org, required this.zone, required this.count, required this.unread, required this.onNotes, required this.onSync, required this.onSignOut});

  @override
  Widget build(BuildContext context) {
    const white = Colors.white;
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 8, 12, 18),
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF84CC16), Color(0xFF16A34A)]),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Text('AgriTrace', style: TextStyle(color: white, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(width: 8),
          const Text('V ${Config.appVersion}', style: TextStyle(color: white, fontSize: 13)),
          const Spacer(),
          IconButton(
            tooltip: 'Notifications', onPressed: onNotes,
            icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_outlined, color: white, size: 26)),
          ),
          ValueListenableBuilder<SyncStatus>(
            valueListenable: services.sync.status,
            builder: (_, s, __) => Icon(s.phase == SyncPhase.offline ? Icons.wifi_off : Icons.wifi, color: white, size: 22),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: white), tooltip: 'Menu',
            onSelected: (v) { if (v == 'sync') onSync(); if (v == 'out') onSignOut(); },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'sync', child: Text('Synchroniser')),
              const PopupMenuItem(value: 'out', child: Text('Se déconnecter')),
            ],
          ),
        ]),
        const SizedBox(height: 6),
        Text(now, style: const TextStyle(color: white, fontSize: 13)),
        if (name.isNotEmpty) Text('Bonjour, ${name.toUpperCase()}', style: const TextStyle(color: white, fontSize: 18, fontWeight: FontWeight.w700)),
        if (org.isNotEmpty) Text(org, style: const TextStyle(color: white, fontSize: 15)),
        if (zone.isNotEmpty) Text('Zone : $zone', style: const TextStyle(color: white, fontSize: 14, fontWeight: FontWeight.w600)),
        if (count != null) ...[
          const SizedBox(height: 10),
          Center(child: Text("Achats d'aujourd'hui : $count", style: const TextStyle(color: white, fontSize: 18, fontWeight: FontWeight.w800))),
        ],
      ]),
    );
  }
}

/// Gros bouton de l'accueil (même principe que le terminal SNT).
class _HomeButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _HomeButton(this.icon, this.label, this.onTap);

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF3F9B2E), elevation: 2, borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18), onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(children: [
            Icon(icon, color: Colors.white, size: 34),
            const SizedBox(width: 16),
            Expanded(child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700))),
          ]),
        ),
      ),
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
