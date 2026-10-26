import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import 'config.dart';
import 'data/api_client.dart';
import 'data/app_database.dart';
import 'data/map_pack.dart';
import 'data/map_tiles.dart';
import 'data/repository.dart';
import 'data/session_store.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'sync/sync_engine.dart';

/// Services partagés de l'application (une seule base chiffrée, un seul moteur de synchronisation).
class Services {
  final SessionStore store;
  final ApiClient api;
  final AppDatabase db;
  final Repository repo;
  final SyncEngine sync;
  final MapPackStore mapPack;
  final MapTiles tiles;
  Services(this.store, this.api, this.db, this.repo, this.sync, this.mapPack, this.tiles);
}

late Services services;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = SessionStore();
  final db = await AppDatabase.open(await store.databaseKey());
  final saved = await store.serverUrl;
  if (saved != null && saved.isNotEmpty) {
    Config.apiBaseRuntime = Config.normalizeBase(saved);
    if (Config.apiBaseRuntime != saved) await store.setServerUrl(Config.apiBaseRuntime);
  } else {
    Config.apiBaseRuntime = Config.normalizeBase(Config.apiBase);
  }
  final api = ApiClient(store);
  api.isOffline = () async => (await Connectivity().checkConnectivity()).every((x) => x == ConnectivityResult.none);
  final mapPack = MapPackStore(api);
  await mapPack.load();
  final tiles = MapTiles(mapPack);
  unawaited(tiles.init());
  services = Services(store, api, db, Repository(db), SyncEngine(db, api), mapPack, tiles);
  // Session refusée par le serveur : le menu et les données restent à l'écran, seule la synchronisation est suspendue
  // jusqu'à une nouvelle connexion (ou jusqu'à ce que l'utilisateur se déconnecte lui-même).
  api.onRevoked = () async {
    services.sync.block();
    await services.store.invalidateCurrentAccount();
  };
  try { await services.repo.parkPermissionFailures(); } catch (_) {/* sans effet sur le démarrage */}
  final loggedIn = await store.refreshToken != null && await store.orgId != null;
  runApp(AgriTraceApp(loggedIn: loggedIn));
}

class AgriTraceApp extends StatelessWidget {
  final bool loggedIn;
  const AgriTraceApp({super.key, required this.loggedIn});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(seedColor: const Color(Brand.forest), primary: const Color(Brand.forest), secondary: const Color(Brand.nature));
    return MaterialApp(
      title: 'AgriTrace',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: scheme, useMaterial3: true, appBarTheme: AppBarTheme(backgroundColor: scheme.primary, foregroundColor: Colors.white)),
      home: loggedIn ? const SyncShell(child: HomeScreen()) : const LoginScreen(),
    );
  }
}

/// Déclenche la synchronisation : au démarrage, au retour du réseau, et périodiquement.
class SyncShell extends StatefulWidget {
  final Widget child;
  const SyncShell({super.key, required this.child});
  @override
  State<SyncShell> createState() => _SyncShellState();
}

class _SyncShellState extends State<SyncShell> with WidgetsBindingObserver {
  StreamSubscription<List<ConnectivityResult>>? _sub;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    services.sync.run();
    _fetchMap();
    _sub = Connectivity().onConnectivityChanged.listen((r) {
      if (r.any((x) => x != ConnectivityResult.none)) services.sync.run();
      if (r.any((x) => x == ConnectivityResult.wifi || x == ConnectivityResult.ethernet)) _fetchMap();
    });
    _timer = Timer.periodic(const Duration(minutes: Config.syncIntervalMinutes), (_) => services.sync.run());
  }

  /// Le fond de carte (plusieurs dizaines de Mo) ne se télécharge tout seul que sur Wi-Fi ; sur données mobiles, c'est à l'utilisateur de le demander.
  Future<void> _fetchMap() async {
    final c = await Connectivity().checkConnectivity();
    if (c.any((x) => x == ConnectivityResult.wifi || x == ConnectivityResult.ethernet)) await services.mapPack.sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) services.sync.run();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
