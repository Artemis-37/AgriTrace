// Rendu des vrais écrans de l'application avec des données fictives, pour les guides (docs/captures/mobile).
// Ne fait rien sans CAPTURES_DIR : CAPTURES_DIR=../docs/captures/mobile flutter test test/captures_test.dart
// Les écrans sont ceux de l'application (mêmes widgets, mêmes données de forme) ; ce n'est pas une capture d'un téléphone physique.
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:agritrace_mobile/data/api_client.dart';
import 'package:agritrace_mobile/data/app_database.dart';
import 'package:agritrace_mobile/data/map_pack.dart';
import 'package:agritrace_mobile/data/map_tiles.dart';
import 'package:agritrace_mobile/data/repository.dart';
import 'package:agritrace_mobile/data/session_store.dart';
import 'package:agritrace_mobile/main.dart';
import 'package:agritrace_mobile/screens/fiche_screen.dart';
import 'package:agritrace_mobile/screens/history_screen.dart';
import 'package:agritrace_mobile/screens/home_screen.dart';
import 'package:agritrace_mobile/screens/login_screen.dart';
import 'package:agritrace_mobile/screens/missions_screen.dart';
import 'package:agritrace_mobile/screens/my_stock_screen.dart';
import 'package:agritrace_mobile/screens/new_convoy_screen.dart';
import 'package:agritrace_mobile/screens/new_declaration_screen.dart';
import 'package:agritrace_mobile/screens/notifications_screen.dart';
import 'package:agritrace_mobile/screens/parcels_screen.dart';
import 'package:agritrace_mobile/sync/sync_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class _Store extends SessionStore {
  @override
  Future<String?> get accessToken async => 'x';
  @override
  Future<String?> get refreshToken async => 'x';
  @override
  Future<String?> get orgId async => 'org';
  @override
  Future<String?> get deviceToken async => null;
}

class _Db implements AppDatabase {
  int pending = 0, problems = 0;
  @override
  Future<int> pendingCount() async => pending;
  @override
  Future<int> problemCount() async => problems;
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Api extends ApiClient {
  final Map<String, dynamic> routes;
  _Api(this.routes) : super(_Store());
  @override
  Future<dynamic> get(String path, {Map<String, String>? query}) async {
    final r = routes[path];
    if (r == null) throw ApiException(404, path);
    return r;
  }
}

class _Repo extends Repository {
  final List<String> perms;
  final List<Map<String, Object?>> decls, parcs;
  _Repo(_Db db, this.perms, this.decls, this.parcs) : super(db);
  @override
  Future<List<String>> permissions() async => perms;
  @override
  Future<List<Map<String, Object?>>> declarations() async => decls;
  @override
  Future<List<Map<String, Object?>>> parcels() async => parcs;
  @override
  Future<({String name, String org, String zone})> identity() async => (name: 'Koffi Yao Serge', org: 'Société Coopérative Agricole de Hiré', zone: 'Section Est');
  @override
  Future<List<Map<String, Object?>>> searchProducers(String q) async => [
        {'id': 'pr1', 'internal_code': 'P00112', 'last_name': 'KONÉ', 'first_names': 'Awa', 'phone': '07 00 00 00 01', 'village': 'Hiré', 'section': 'Section Est'},
        {'id': 'pr2', 'internal_code': 'P00131', 'last_name': 'YAO', 'first_names': 'Marie', 'phone': '05 00 00 00 02', 'village': 'Zégban', 'section': 'Section Est'},
      ];
  @override
  Future<List<Map<String, Object?>>> chainsFor(String producerId) async => [{'id': 'vc1', 'name': 'Cacao'}];
  @override
  Future<List<Map<String, Object?>>> openCampaigns(String chainId) async => [{'id': 'c1', 'name': 'Campagne 2026-2027'}];
  @override
  Future<List<String>> unitsFor(String chainId) async => ['kg', 'sac'];
  @override
  Future<List<Map<String, Object?>>> linkableDeclarations({Set<String>? serverAvailableIds}) async => [];
}

Future<void> _font(String family, List<String> files) async {
  final l = FontLoader(family);
  for (final f in files) {
    l.addFont(Future.value(ByteData.view(File(f).readAsBytesSync().buffer)));
  }
  await l.load();
}

const _dartRoot = '/opt/fl/flutter/bin/cache/artifacts/material_fonts';

final _decls = <Map<String, Object?>>[
  {'id': 'd1', 'producer_name': 'KONÉ Awa', 'operation_date': '2026-10-21', 'quantity': '650', 'unit': 'kg', 'amount': '650000', 'currency': 'XOF', 'purchase_receipt_no': 'A-004512', 'local_state': 'synced', 'status': 'received_confirmed', 'receipt_conflict': 0},
  {'id': 'd2', 'producer_name': 'YAO Marie', 'operation_date': '2026-10-21', 'quantity': '12', 'unit': 'sac', 'amount': '780000', 'currency': 'XOF', 'purchase_receipt_no': 'A-004513', 'local_state': 'pending', 'status': '', 'receipt_conflict': 0},
  {'id': 'd3', 'producer_name': 'TRAORÉ Issa', 'operation_date': '2026-10-20', 'quantity': '325', 'unit': 'kg', 'amount': '325000', 'currency': 'XOF', 'purchase_receipt_no': 'A-004509', 'local_state': 'synced', 'status': 'to_correct', 'receipt_conflict': 0},
  {'id': 'd4', 'producer_name': 'BAMBA Salif', 'operation_date': '2026-10-20', 'quantity': '8', 'unit': 'sac', 'amount': '520000', 'currency': 'XOF', 'purchase_receipt_no': 'A-004510', 'local_state': 'synced', 'status': 'accepted', 'receipt_conflict': 0},
];
final _parcels = <Map<String, Object?>>[
  {'id': 'p1', 'code': 'P00112-01', 'producer_name': 'KONÉ Awa', 'producer_code': 'P00112', 'declared_area_ha': '2.5', 'geometry_area_ha': '2.31', 'pending_updates': 0},
  {'id': 'p2', 'code': 'P00131-01', 'producer_name': 'YAO Marie', 'producer_code': 'P00131', 'declared_area_ha': '3.0', 'geometry_area_ha': null, 'pending_updates': 0},
  {'id': 'p3', 'code': 'P00044-02', 'producer_name': 'BAMBA Salif', 'producer_code': 'P00044', 'declared_area_ha': '1.8', 'geometry_area_ha': '1.74', 'pending_updates': 1},
];
const _collector = ['declarations:create', 'declarations:read', 'producers:read', 'convoys:create', 'convoys:read', 'collector:stock', 'documents:upload', 'messages:use', 'sync:use'];
const _coach = ['tasks:read', 'tasks:execute', 'tasks:request', 'parcels:create', 'parcels:read', 'producers:read', 'inspections:perform', 'documents:upload', 'messages:use', 'sync:use'];

final _routes = <String, dynamic>{
  '/notifications/unread-count': {'unread': 2},
  '/purchase-declarations': _decls.map((d) => {'amount': d['amount'], 'bags': d['unit'] == 'sac' ? int.parse('${d['quantity']}') : 0, 'operation_date': d['operation_date'], 'producer_name': d['producer_name'], 'purchase_receipt_no': d['purchase_receipt_no'], 'quantity': d['quantity'], 'status': d['status'] == '' ? 'accepted' : d['status'], 'unit': d['unit']}).toList(),
  '/convoys/my-stock': {'purchased_kg': '3250', 'purchased_bags': 50, 'delivered_kg': '2275', 'delivered_bags': 35, 'in_transit_kg': '650', 'in_transit_convoys': 1, 'held_kg': '325', 'awaiting_cashier': 1, 'balance': '-120000', 'purchases': 14},
  '/convoys/statement': {'opening': '150000', 'solde': '-120000', 'rows': [
    {'date': '2026-10-15', 'label': 'Avance achat', 'piece': 'AV-0012', 'direction': 'financing', 'weight': null, 'amount': '300000'},
    {'date': '2026-10-17', 'label': 'Livraison convoi C-0041', 'piece': 'C-0041', 'direction': 'delivery', 'weight': '1300', 'amount': '1300000'},
    {'date': '2026-10-19', 'label': 'Livraison convoi C-0044', 'piece': 'C-0044', 'direction': 'delivery', 'weight': '975', 'amount': '975000'}]},
  '/notifications': [
    {'id': 'n1', 'kind': 'declaration_to_correct', 'severity': 'warning', 'title': 'Achat à corriger', 'body': 'Reçu A-004509 : poids illisible sur la photo.', 'created_at': '2026-10-21T08:10:00Z', 'read_at': null},
    {'id': 'n2', 'kind': 'convoy_received', 'severity': 'info', 'title': 'Convoi reçu au magasin', 'body': 'C-0044 : 975 kg réceptionnés.', 'created_at': '2026-10-20T16:42:00Z', 'read_at': null}],
  '/tasks': [
    {'id': 't1', 'title': 'Relever le contour de la parcelle P00131-01', 'description': 'Tracé GPS complet et photo du coin nord.', 'category': 'mapping', 'status': 'open', 'due_date': '2026-10-24', 'section': 'Section Est', 'overdue': false, 'latitude': null, 'longitude': null, 'content': null, 'decision_note': null},
    {'id': 't2', 'title': 'Visite de contrôle — KOFFI Adjoua', 'description': 'Vérifier les ombrages et prendre deux photos.', 'category': 'visit', 'status': 'in_progress', 'due_date': '2026-10-19', 'section': 'Section Nord', 'overdue': true, 'latitude': null, 'longitude': null, 'content': null, 'decision_note': null}],
  '/task-requests': [],
};

void main() {
  final dir = Platform.environment['CAPTURES_DIR'];
  if (dir == null) {
    test('captures (ignoré sans CAPTURES_DIR)', () {}, skip: true);
    return;
  }
  Directory(dir).createSync(recursive: true);

  Future<void> shot(WidgetTester t, String name, Widget screen, {List<String> perms = _collector, int pending = 0, int problems = 0, Future<void> Function(WidgetTester)? after}) async {
    debugDisableShadows = false; // sinon les ombres des tests sont des aplats noirs (remis en place à la fin de chaque test)
    final db = _Db()..pending = pending..problems = problems;
    final api = _Api(_routes);
    final pack = MapPackStore(api);
    final repo = _Repo(db, perms, _decls, _parcels);
    services = Services(_Store(), api, db, repo, SyncEngine(db, api), pack, MapTiles(pack));
    final key = GlobalKey();
    t.view.physicalSize = const Size(1080, 2160); t.view.devicePixelRatio = 2.625;
    await t.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2F5D46), primary: const Color(0xFF2F5D46)), useMaterial3: true, fontFamily: 'Roboto',
          appBarTheme: const AppBarTheme(backgroundColor: Color(0xFF2F5D46), foregroundColor: Colors.white)),
      home: ExcludeFocus(child: screen))));
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await t.pump(const Duration(milliseconds: 100));
    if (after != null) { await after(t); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 200)); }
    FocusManager.instance.primaryFocus?.unfocus();
    await t.pump(const Duration(milliseconds: 100)); await t.pump(const Duration(milliseconds: 400));
    await t.runAsync(() async {
      final b = key.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final img = await b.toImage(pixelRatio: 1.0);
      final bytes = (await img.toByteData(format: ui.ImageByteFormat.png))!;
      File('$dir/$name.png').writeAsBytesSync(bytes.buffer.asUint8List());
    });
  }

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    FocusManager.instance.highlightStrategy = FocusHighlightStrategy.alwaysTouch;
    await _font('Roboto', ['$_dartRoot/Roboto-Regular.ttf', '$_dartRoot/Roboto-Medium.ttf', '$_dartRoot/Roboto-Bold.ttf']);
    await _font('MaterialIcons', ['$_dartRoot/MaterialIcons-Regular.otf']);
  });

  testWidgets('écrans du collecteur', (t) async {
    addTearDown(() => debugDisableShadows = true);
    try {
    await shot(t, 'collecteur-accueil', const HomeScreen(), pending: 1);
    await shot(t, 'collecteur-choix-producteur', const NewDeclarationScreen());
    await shot(t, 'collecteur-info-producteur', const NewDeclarationScreen(), after: (t) async { await t.tap(find.text('KONÉ Awa')); });
    await shot(t, 'collecteur-nouvel-achat', const NewDeclarationScreen(), after: (t) async {
      await t.tap(find.text('KONÉ Awa')); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 200));
      await t.tap(find.text('Continuer'));
    });
    await shot(t, 'collecteur-historique', const HistoryScreen());
    await shot(t, 'collecteur-mon-stock', const MyStockScreen());
    await shot(t, 'collecteur-fiche', const FicheScreen());
    await shot(t, 'collecteur-convoi', const NewConvoyScreen());
    await shot(t, 'notifications', const NotificationsScreen());
    } finally { debugDisableShadows = true; }
  });
  testWidgets('écrans du coach', (t) async {
    try {
    await shot(t, 'coach-accueil', const HomeScreen(), perms: _coach);
    await shot(t, 'coach-missions', const MissionsScreen(), perms: _coach);
    await shot(t, 'coach-parcelles', const ParcelsScreen(), perms: _coach);
    await shot(t, 'connexion', const LoginScreen());
    } finally { debugDisableShadows = true; }
  });
}
