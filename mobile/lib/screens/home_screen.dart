
import 'package:flutter/material.dart';


import '../config.dart';
import '../main.dart';
import 'sync_icon.dart';
import '../sync/sync_engine.dart';
import '../sync/sync_state.dart';
import 'login_screen.dart';
import 'fiche_screen.dart';
import 'history_screen.dart';
import 'my_stock_screen.dart';
import 'notifications_screen.dart';
import 'producers_screen.dart';
import 'add_producer_screen.dart';
import 'distribution_screen.dart';
import 'download_screen.dart';
import 'social_infra_screen.dart';
import 'training_library_screen.dart';
import 'training_screen.dart';
import 'convoy_history_screen.dart';
import 'sync_dialog.dart';
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
  bool _canTraining = false, _canHistory = false, _canFiche = false, _canSurvey = false;
  int _unreadNotes = 0;
  bool _canProducer = false, _canField = false;
  List<({String label, String detail, String state, String? error, String? entity})> _pendingItems = [];
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
    final pendingItems = await services.repo.pendingItems();
    int unread = _unreadNotes;
    try { final r = await services.api.get('/notifications/unread-count'); unread = (r['unread'] as num?)?.toInt() ?? 0; } catch (_) { /* hors connexion : compteur conservé */ }
    if (!mounted) return;
    setState(() { _items = items; _pending = pending; _problems = problems; _canCreate = canCreateDeclaration(perms); _canConvoy = canCreateConvoy(perms); _canHistory = canReadHistory(perms); _canFiche = canSeeFiche(perms); _canTraining = perms.contains('training:read'); _canSurvey = canSurveyParcel(perms); _unreadNotes = unread; _identity = identity; _canProducer = canCreateProducer(perms); _canField = canFieldRecord(perms); _pendingItems = pendingItems; });
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
      if (_canConvoy) _HomeButton(Icons.route_outlined, 'Historique des convois', () => _open(const ConvoyHistoryScreen())),
      if (_canConvoy) _HomeButton(Icons.inventory_2_outlined, 'Mon stock', () => _open(const MyStockScreen())),
      if (_canFiche) _HomeButton(Icons.receipt_long_outlined, 'Ma fiche de compte', () => _open(const FicheScreen())),
      if (_canSurvey || _canProducer) _HomeButton(Icons.fact_check_outlined, 'Producteurs et enquêtes', () => _open(const ProducersScreen())),
    ];
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      body: Column(children: [
        _HomeHeader(
          now: _now, name: _identity.name, org: _identity.org, zone: _identity.zone,
          count: _coachMode ? null : t.count, unread: _unreadNotes, onNotes: () => _open(const NotificationsScreen()),
          onSync: () => syncWithDialog(context),
          onSignOut: _signOut,
        ),
        ValueListenableBuilder<SyncStatus>(
          valueListenable: services.sync.status,
          builder: (_, s, __) => _SyncBanner(status: s, pending: _pending, problems: _problems),
        ),
        if (_coachMode) Expanded(child: _coachBody()) else Expanded(
          child: RefreshIndicator(
            onRefresh: () async { await syncWithDialog(context); await _reload(); },
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 24), children: [
              for (final b in buttons) Padding(padding: const EdgeInsets.only(bottom: 12), child: b),
              if (_items.isNotEmpty) ...[
                Material(
                  color: const Color(0xFFE9EEE3),
                  child: InkWell(
                    onTap: () => _pending + _problems > 0 ? syncWithDialog(context, submit: true) : syncWithDialog(context),
                    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14), child: Row(children: [
                      const Text('Achats récents', style: TextStyle(fontSize: 18)),
                      const SizedBox(width: 10),
                      CircleAvatar(radius: 16, backgroundColor: _pending + _problems > 0 ? const Color(0xFF6B73C1) : const Color(0xFF3F9B2E), child: Text('${_pending + _problems}', style: const TextStyle(color: Colors.white))),
                      const Spacer(),
                      Icon(_pending + _problems > 0 ? Icons.cloud_upload_outlined : Icons.cloud_done_outlined, size: 28),
                    ])),
                  ),
                ),
                const SizedBox(height: 10),
                for (final d in _items.take(20)) _purchaseTile(d),
              ] else
                const Padding(padding: EdgeInsets.all(16), child: Center(child: Text('Aucun achat.\nTirez pour synchroniser.', textAlign: TextAlign.center))),
            ]),
          ),
        ),
      ]),
    );
  }

  /// Profil terrain (coach) : pas d'achats ni de convoi, mais des relevés de parcelles et des tâches du profil.
  bool get _coachMode => !_canCreate && !_canConvoy && (_canSurvey || _canProducer || _canProducer || _canField);

  Widget _tile(IconData icon, String label, VoidCallback onTap, {double height = 120, double fontSize = 13, Widget? iconWidget}) => Material(
        color: const Color(0xFF3F9B2E), elevation: 2, borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6), onTap: onTap,
          child: SizedBox(height: height, child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              iconWidget ?? Icon(icon, color: Colors.white, size: 44),
              const SizedBox(height: 8),
              Text(label.toUpperCase(), textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: fontSize, fontWeight: FontWeight.w700)),
            ]),
          )),
        ),
      );

  Widget _coachBody() {
    // Les parcelles et les tâches se consultent depuis la fiche du producteur.
    final r1 = <Widget>[
      if (_canProducer) _tile(Icons.person_add, 'Ajouter un nouveau producteur et une exploitation agricole', () => _open(const AddProducerScreen(), sync: true), height: 150),
      _tile(Icons.groups, 'Producteurs et enquêtes', () => _open(const ProducersScreen()), height: 150, iconWidget: const _GroupCheckIcon()),
    ];
    final r2 = <Widget>[
      if (_canField) _tile(Icons.add_location_alt, 'Ajouter une infrastructure sociale', () => _open(const SocialInfraScreen(), sync: true), height: 150, fontSize: 11),
      _tile(Icons.cloud_download, 'Télécharger les données', () => _open(const DownloadScreen()), height: 150, fontSize: 11),
      if (_canField) _tile(Icons.volunteer_activism, 'Distribution et services', () => _open(const DistributionScreen(), sync: true), height: 150, fontSize: 11),
    ];
    final r3 = <Widget>[
      if (_canField) _tile(Icons.school, 'Enregistrer une formation', () => _open(const TrainingListScreen(), sync: true), height: 130),
      if (_canTraining) _tile(Icons.menu_book, 'Modules de formation', () => _open(const TrainingLibraryScreen()), height: 130),
    ];
    Widget row(List<Widget> w) => Row(children: [for (var i = 0; i < w.length; i++) ...[if (i > 0) const SizedBox(width: 10), Expanded(child: w[i])]]);
    return RefreshIndicator(
      onRefresh: () async { await syncWithDialog(context); await _reload(); },
      child: ListView(padding: const EdgeInsets.fromLTRB(12, 14, 12, 24), children: [
        for (final r in [r1, r2, r3]) ...[row(r), const SizedBox(height: 10)],
        const SizedBox(height: 6),
        Material(
          color: const Color(0xFFE9EEE3),
          child: InkWell(
            onTap: () => syncWithDialog(context, submit: true),
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14), child: Row(children: [
              const Text('Éléments à soumettre', style: TextStyle(fontSize: 18)),
              const SizedBox(width: 10),
              CircleAvatar(radius: 16, backgroundColor: const Color(0xFF6B73C1), child: Text('$_pending', style: const TextStyle(color: Colors.white))),
              const Spacer(),
              const Icon(Icons.cloud_upload_outlined, size: 28),
            ])),
          ),
        ),
        const SizedBox(height: 10),
        for (final it in _pendingItems) _pendingRow(it),
        if (_pendingItems.isEmpty) const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('Rien à envoyer : tout est synchronisé.'))),
      ]),
    );
  }

  Widget _pendingRow(({String label, String detail, String state, String? error, String? entity}) it) {
    final bad = const {'to_correct', 'rejected', 'conflict'}.contains(it.state);
    return Container(
      margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.fromLTRB(14, 10, 4, 10),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFDDDDDD))),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(it.label, style: const TextStyle(fontSize: 17)),
          if (it.detail.isNotEmpty) Text(it.detail.toUpperCase(), style: const TextStyle(color: Colors.black54, fontSize: 15)),
          if (bad) Text(it.error == null || it.error!.isEmpty ? 'À corriger' : 'À corriger : ${it.error}', style: TextStyle(color: Colors.red.shade700, fontSize: 13)),
        ])),
        Container(width: 1, height: 54, color: const Color(0xFFDDDDDD)),
        IconButton(onPressed: () => syncWithDialog(context, only: it.entity), tooltip: 'Envoyer cet élément', iconSize: 34, icon: Icon(bad ? Icons.error_outline : Icons.cloud_upload_outlined, color: bad ? Colors.red : Colors.black87)),
      ]),
    );
  }

  Widget _purchaseTile(Map<String, Object?> d) {
    final ls = d['local_state'] as String;
    final st = d['status'] as String?;
    final label = declarationLabel(localState: ls, status: st);
    final amount = d['amount'] as String?;
    final bad = ls == 'error';
    final synced = ls == 'synced';
    final info = [
      d['operation_date'], label,
      if (d['purchase_receipt_no'] != null) 'Reçu ${d['purchase_receipt_no']}${d['receipt_conflict'] == 1 ? ' (numéro déjà utilisé — à résoudre)' : ''}',
      if (amount != null) 'Montant ${double.parse(amount).toStringAsFixed(0)} ${d['currency'] ?? ''}',
    ].join('  •  ');
    return Container(
      margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.fromLTRB(14, 10, 4, 10),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFDDDDDD))),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${d['producer_name'] ?? 'Producteur'}', style: const TextStyle(fontSize: 17)),
          Text('${d['quantity']} ${d['unit']}'.toUpperCase(), style: const TextStyle(color: Colors.black54, fontSize: 15)),
          Text(info, style: const TextStyle(color: Colors.black54, fontSize: 13)),
          if (bad) Text(d['local_error'] == null || '${d['local_error']}'.isEmpty ? 'À corriger' : 'À corriger : ${d['local_error']}', style: TextStyle(color: Colors.red.shade700, fontSize: 13)),
        ])),
        Container(width: 1, height: 54, color: const Color(0xFFDDDDDD)),
        bad
            ? IconButton(icon: const Icon(Icons.delete_outline, color: Colors.red), iconSize: 30, tooltip: 'Abandonner',
                onPressed: () async { await services.repo.discardFailed(d['id'] as String); await _reload(); })
            : IconButton(onPressed: synced ? null : () => syncWithDialog(context, only: d['id'] as String), tooltip: synced ? 'Envoyé' : 'Envoyer cet achat', iconSize: 34,
                icon: Icon(synced ? Icons.cloud_done : Icons.cloud_upload_outlined, color: synced ? _color(ls, st) : Colors.black87)),
      ]),
    );
  }
}

/// En-tête de l'accueil : date, salutation, coopérative, zone, total du jour.
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
          const SyncIcon(),
          ValueListenableBuilder<SyncStatus>(
            valueListenable: services.sync.status,
            builder: (_, s, __) => Icon(s.phase == SyncPhase.offline ? Icons.wifi_off : Icons.wifi, color: white, size: 22),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: white), tooltip: 'Menu',
            onSelected: (v) { if (v == 'sync') onSync(); if (v == 'out') onSignOut(); if (v == 'relogin') Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen(notice: 'Session expirée : reconnectez-vous pour reprendre la synchronisation.'))); },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'sync', child: Text('Synchroniser')),
              const PopupMenuItem(value: 'relogin', child: Text('Se reconnecter')),
              const PopupMenuItem(value: 'out', child: Text('Se déconnecter')),
            ],
          ),
        ]),
        const SizedBox(height: 6),
        Text(now, style: const TextStyle(color: white, fontSize: 13)),
        if (name.isNotEmpty) Text('Bonjour, ${name.toUpperCase()}', style: const TextStyle(color: white, fontSize: 18, fontWeight: FontWeight.w700)),
        // Nom complet de la coopérative, sur toute la largeur et sur autant de lignes que nécessaire
        if (org.isNotEmpty) Text(org, softWrap: true, style: const TextStyle(color: white, fontSize: 15, fontWeight: FontWeight.w600)),
        if (zone.isNotEmpty) Text('Zone : $zone', style: const TextStyle(color: white, fontSize: 14, fontWeight: FontWeight.w600)),
        if (count != null) ...[
          const SizedBox(height: 10),
          Center(child: Text("Achats d'aujourd'hui : $count", style: const TextStyle(color: white, fontSize: 18, fontWeight: FontWeight.w800))),
        ],
      ]),
    );
  }
}

/// Gros bouton de l'accueil.
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
    // Plus rien à soumettre : la mention « synchronisation en attente » disparaît.
    final phase = status.phase == SyncPhase.refused && pending == 0 ? SyncPhase.idle : status.phase;
    switch (phase) {
      case SyncPhase.syncing:
        text = 'Synchronisation en cours…'; color = Colors.blueGrey; break;
      case SyncPhase.offline:
        text = (status.message ?? '').startsWith('Le serveur') ? status.message! : 'Hors connexion — les saisies sont conservées sur l\'appareil'; color = Colors.orange.shade800; break;
      case SyncPhase.blocked:
        text = 'Synchronisation suspendue : session expirée ou accès retiré. Utilisez « Se reconnecter » dans le menu ⋮, ou contactez votre administrateur. Vos saisies restent sur le téléphone.'; color = Colors.red.shade700; break;
      case SyncPhase.error:
        text = 'Erreur de synchronisation : ${status.message ?? ''}'; color = Colors.red.shade700; break;
      case SyncPhase.refused:
        text = 'Synchronisation en attente : soumettez d\'abord vos éléments.'; color = Colors.orange.shade800; break;
      case SyncPhase.idle:
        text = status.lastSuccess == null ? 'Pas encore synchronisé' : 'Synchronisé à ${TimeOfDay.fromDateTime(status.lastSuccess!).format(context)}';
        color = Colors.green.shade800; break;
    }
    final extra = [if (pending > 0) '$pending à soumettre', if (problems > 0) '$problems à corriger'].join('  •  ');
    return Container(
      width: double.infinity,
      color: color.withOpacity(0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(extra.isEmpty ? text : '$text\n$extra', style: TextStyle(color: color, fontWeight: FontWeight.w600)),
    );
  }
}

/// Groupe de personnes avec un petit formulaire coché dans le coin : « Producteurs et enquêtes ».
class _GroupCheckIcon extends StatelessWidget {
  const _GroupCheckIcon();
  @override
  Widget build(BuildContext context) => SizedBox(width: 64, height: 50, child: Stack(clipBehavior: Clip.none, children: [
        const Positioned(left: 0, top: 0, child: Icon(Icons.groups, color: Colors.white, size: 48)),
        Positioned(right: -2, bottom: -6, child: Container(
          padding: const EdgeInsets.all(1), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(5), border: Border.all(color: const Color(0xFF3F9B2E), width: 2)),
          child: const Icon(Icons.fact_check, color: Color(0xFF2F7D32), size: 24))),
      ]));
}
