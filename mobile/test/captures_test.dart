import 'dart:convert';
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
import 'package:agritrace_mobile/screens/training_library_screen.dart';
import 'package:agritrace_mobile/screens/login_screen.dart';
import 'package:agritrace_mobile/screens/my_stock_screen.dart';
import 'package:agritrace_mobile/screens/new_convoy_screen.dart';
import 'package:agritrace_mobile/screens/new_declaration_screen.dart';
import 'package:agritrace_mobile/screens/notifications_screen.dart';
import 'package:agritrace_mobile/screens/producers_screen.dart';
import 'package:agritrace_mobile/screens/download_screen.dart';
import 'package:agritrace_mobile/screens/add_producer_screen.dart';
import 'package:agritrace_mobile/screens/social_infra_screen.dart';
import 'package:agritrace_mobile/screens/distribution_screen.dart';
import 'package:agritrace_mobile/screens/training_screen.dart';
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
  final Map<String, String> kv = {};
  @override
  Future<String?> getKv(String k) async => kv[k];
  @override
  Future<void> setKv(String k, String v) async { kv[k] = v; }
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
  Future<dynamic> get(String path, {Map<String, String>? query, Duration? timeout}) async {
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
  Future<({String name, String org, String zone})> identity() async => (name: 'Koffi Yao Serge', org: 'Société Coopérative Agricole Démo du Haut-Sassandra', zone: 'Section Est');
  @override
  @override
  Future<List<Map<String, Object?>>> producerSections() async => [{'section': 'Section Est', 'n': 12}, {'section': 'Section Ouest', 'n': 9}];
  Future<List<Map<String, Object?>>> searchProducers(String q, {String? section, int limit = 200}) async => [
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
  Future<List<({String label, String detail, String state, String? error, String? entity})>> pendingItems() async => [
        (label: 'Nouveau producteur', detail: 'Kouamé Yao', state: 'pending', error: null, entity: null),
        (label: 'Formation', detail: 'Agriculture régénératrice', state: 'pending', error: null, entity: null),
      ];
  @override
  Future<List<Map<String, dynamic>>> localFieldRecords(String kind) async => kind == 'training'
      ? [{'id': 'f1', 'kind': 'training', 'title': 'Agriculture régénératrice', 'data': {'participants': [{}, {}, {}]}}]
      : [];
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
  {'id': 'p1', 'code': 'P00112-01', 'producer_name': 'KONÉ Awa', 'producer_code': 'P00112', 'declared_area_ha': '2.5', 'geometry_area_ha': '2.31', 'pending_updates': 0, 'geometry': '{"type":"Polygon","coordinates":[[[-5.2910,6.1890],[-5.2895,6.1890],[-5.2895,6.1902],[-5.2910,6.1902],[-5.2910,6.1890]]]}'},
  {'id': 'p2', 'code': 'P00131-01', 'producer_name': 'YAO Marie', 'producer_code': 'P00131', 'declared_area_ha': '3.0', 'geometry_area_ha': null, 'pending_updates': 0},
  {'id': 'p3', 'code': 'P00044-02', 'producer_name': 'BAMBA Salif', 'producer_code': 'P00044', 'declared_area_ha': '1.8', 'geometry_area_ha': '1.74', 'pending_updates': 1},
];
const _collector = ['declarations:create', 'declarations:read', 'producers:read', 'convoys:create', 'convoys:read', 'collector:stock', 'documents:upload', 'messages:use', 'sync:use'];
const _coach = ['producers:create', 'field_records:create', 'field_records:read', 'tasks:read', 'tasks:execute', 'tasks:request', 'parcels:create', 'parcels:read', 'producers:read', 'inspections:perform', 'documents:upload', 'messages:use', 'sync:use', 'training:read', 'training:report'];

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
  '/training-modules': [
    {'id': 'm1', 'code': 'cacao-fermentation', 'theme': 'Gestion des récoltes et des produits', 'title': 'Fermentation du cacao', 'summary': 'Fermenter les fèves pour développer la qualité et la valeur du cacao.', 'crops': ['cacao'], 'certifications': ['Rainforest Alliance', 'Fairtrade'], 'level': 'intermediaire', 'duration_min': 90, 'submission_id': null,
      'content': {'objectifs': ['Comprendre le rôle de la fermentation', 'Conduire une fermentation en caisse ou en tas'], 'sections': [{'titre': 'Préparer la fermentation', 'points': ['Écabosser dans les 24 heures', 'Utiliser un matériel propre', 'Couvrir de feuilles de bananier']}], 'a_eviter': ['Mélanger des fèves de récoltes différentes'], 'verifier': ['Pourquoi retourne-t-on les fèves ?'], 'materiel': []}},
    {'id': 'm2', 'code': null, 'theme': 'Collecte de documents et tenue de registres', 'title': 'Carnet de récolte et traçabilité (exportateur)', 'summary': 'Module proposé par l\'exportateur de démonstration (fictif).', 'crops': ['cacao'], 'certifications': ['EUDR'], 'level': 'base', 'duration_min': 60, 'submission_id': 's1', 'proposed_by_name': 'Karim Diallo',
      'content': {'objectifs': ['Tenir un carnet de récolte à jour'], 'sections': [{'titre': 'Le carnet de récolte', 'points': ['Noter la date de chaque récolte', 'Noter le poids de fèves fraîches', 'Conserver le carnet à l\'abri']}], 'a_eviter': ['Mélanger les récoltes de deux parcelles'], 'verifier': ['Que note-t-on à chaque récolte ?'], 'materiel': []}},
    {'id': 'm3', 'code': 'cacao-sechage', 'theme': 'Gestion des récoltes et des produits', 'title': 'Séchage et stockage des fèves', 'summary': 'Sécher à environ 7 % d\'humidité et stocker sans moisissure.', 'crops': ['cacao'], 'certifications': ['Rainforest Alliance'], 'level': 'base', 'duration_min': 60, 'submission_id': null,
      'content': {'objectifs': ['Reconnaître une fève bien séchée'], 'sections': [{'titre': 'Séchage', 'points': ['Étaler en couche mince']}], 'a_eviter': [], 'verifier': [], 'materiel': []}}],
  '/training-results': [
    {'id': 'r1', 'module_id': 'm2', 'session_date': '2026-10-15', 'village': 'Hiré', 'participants': 22, 'avg_score': '78.00', 'notes': 'Séance suivie avec attention', 'status': 'forwarded'},
    {'id': 'r2', 'module_id': 'm2', 'session_date': '2026-10-19', 'village': 'Zégban', 'participants': 15, 'avg_score': '71.00', 'notes': '', 'status': 'submitted'}],
  '/task-requests': [],
  '/distribution-articles': [
    {'id': 'a1', 'category': 'Finance', 'group_name': 'Primes', 'name': 'Prime de certification', 'unit': null},
    {'id': 'a2', 'category': 'Finance', 'group_name': 'Primes', 'name': 'Prime de qualité', 'unit': null},
    {'id': 'a3', 'category': 'Finance', 'group_name': 'Primes', 'name': 'Prime en espèces', 'unit': null},
    {'id': 'a4', 'category': 'Finance', 'group_name': 'Primes', 'name': 'Prime générique', 'unit': null}],
  '/field-records?kind=training': [],
  '/producer-assignments?producer_id=pr1': [
    {'target_id': 'x1', 'status': 'pending', 'id': 'a1', 'kind': 'formation', 'title': 'Carnet de récolte et traçabilité', 'instructions': 'À dispenser avant la fin de la campagne.', 'due_date': '2026-11-30'},
    {'target_id': 'x2', 'status': 'pending', 'id': 'a2', 'kind': 'distribution', 'title': 'Distribution de plants de cacaoyers', 'instructions': '', 'due_date': '2026-11-10'}],
  '/tasks?producer_id=pr1': [
    {'id': 't1', 'title': 'Relever le contour de la parcelle P00112-01', 'description': 'Tracé GPS complet et photo du coin nord.', 'category': 'mapping', 'status': 'open', 'due_date': '2026-10-24', 'section': 'Section Est', 'overdue': false, 'latitude': null, 'longitude': null, 'content': null, 'decision_note': null},
    {'id': 't2', 'title': 'Visite de contrôle — KONÉ Awa', 'description': 'Vérifier les ombrages et prendre deux photos.', 'category': 'visit', 'status': 'in_progress', 'due_date': '2026-10-19', 'section': 'Section Est', 'overdue': true, 'latitude': null, 'longitude': null, 'content': null, 'decision_note': null}],
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
    db.kv['org_logo'] = base64Encode(File('../docs/brand/logo-cooperative-demo.png').readAsBytesSync());
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
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 400))); await t.pump(const Duration(milliseconds: 100)); // décodage des images (logo)
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
    Finder field(String label) => find.byWidgetPredicate((w) => w is TextField && (w.decoration?.labelText ?? '').startsWith(label));
    void fill(WidgetTester t, String label, String v) => t.widget<TextField>(field(label)).controller!.text = v;
    await shot(t, 'collecteur-achat-saisi', const NewDeclarationScreen(), after: (t) async {
      await t.tap(find.text('KONÉ Awa')); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 200));
      await t.tap(find.text('Continuer')); await t.pump(const Duration(milliseconds: 400));
      fill(t, 'Poids (kg)', '520'); fill(t, 'Nombre de sacs', '8'); fill(t, 'N° du reçu', 'A-000412'); await t.pump(const Duration(milliseconds: 200));
    });
    await shot(t, 'collecteur-historique', const HistoryScreen());
    await shot(t, 'collecteur-mon-stock', const MyStockScreen());
    await shot(t, 'collecteur-fiche', const FicheScreen());
    await shot(t, 'collecteur-convoi', const NewConvoyScreen());
    await shot(t, 'collecteur-convoi-saisi', const NewConvoyScreen(), after: (t) async {
      fill(t, 'N° de connaissement du convoi', 'CV-0007'); fill(t, 'Nom du chauffeur', 'Traoré Moussa'); fill(t, 'N° du camion', 'AB 1234 CI');
      fill(t, 'Nombre de sacs', '40'); fill(t, 'Poids annoncé', '2600'); await t.pump(const Duration(milliseconds: 200));
    });
    await shot(t, 'notifications', const NotificationsScreen());
    } finally { debugDisableShadows = true; }
  });
  testWidgets('écrans du coach', (t) async {
    try {
    await shot(t, 'coach-accueil', const HomeScreen(), perms: _coach, pending: 2);
    await shot(t, 'coach-modules-formation', const TrainingLibraryScreen(), perms: _coach);
    await shot(t, 'coach-module-exportateur', TrainingModuleScreen(module: Map<String, dynamic>.from((_routes['/training-modules'] as List)[1] as Map)), perms: _coach);
    await shot(t, 'coach-module-resultats', TrainingResultScreen(module: Map<String, dynamic>.from((_routes['/training-modules'] as List)[1] as Map)), perms: _coach, after: (t) async {
      t.widget<TextField>(find.byType(TextField).at(0)).controller!.text = 'Hiré'; t.widget<TextField>(find.byType(TextField).at(1)).controller!.text = '22'; t.widget<TextField>(find.byType(TextField).at(2)).controller!.text = '78'; t.widget<TextField>(find.byType(TextField).at(3)).controller!.text = 'Séance suivie avec attention ; carnets distribués.';
    });
    await shot(t, 'coach-producteurs', const ProducersScreen(), perms: _coach);
    await shot(t, 'coach-producteur-taches', const ProducersScreen(), perms: _coach, after: (t) async { await t.tap(find.textContaining('KONÉ')); await t.pump(const Duration(milliseconds: 300)); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 300)); });
    await shot(t, 'coach-producteur-infos', const ProducersScreen(), perms: _coach, after: (t) async { await t.tap(find.textContaining('KONÉ')); await t.pump(const Duration(milliseconds: 300)); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 600)); await t.tap(find.text('Informations sur le producteur')); await t.pump(const Duration(milliseconds: 400)); });
    await shot(t, 'coach-ajout-producteur', const AddProducerScreen(), perms: _coach);
    await shot(t, 'coach-infrastructure', const SocialInfraScreen(), perms: _coach);
    Future<void> pickDropdown(WidgetTester t, int index, String text) async {
      await t.tap(find.byType(DropdownButtonFormField<String>).at(index)); await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text(text).last); await t.pump(const Duration(milliseconds: 400));
    }
    Future<void> browse(WidgetTester t) async { await pickDropdown(t, 0, 'Finance'); await pickDropdown(t, 1, 'Primes'); }
    await shot(t, 'coach-distribution-articles', const DistributionScreen(), perms: _coach, after: (t) async { await browse(t); await t.tap(find.text('Prime de qualité')); await t.pump(const Duration(milliseconds: 300)); });
    await shot(t, 'coach-distribution-verifier', const DistributionScreen(), perms: _coach, after: (t) async {
      await browse(t); await t.tap(find.text('Prime de qualité')); await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining("VOIR L'ARTICLE")); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await t.pump(const Duration(milliseconds: 600)); });
    await shot(t, 'coach-distribution-beneficiaires', const DistributionScreen(), perms: _coach, after: (t) async {
      await browse(t); await t.tap(find.text('Prime de qualité')); await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining("VOIR L'ARTICLE")); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await t.pump(const Duration(milliseconds: 600));
      await t.tap(find.text('CONTINUER VERS LES AGRICULTEURS')); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining('KONÉ')); await t.pump(const Duration(milliseconds: 300)); });
    await shot(t, 'coach-distribution-configuration', const DistributionScreen(), perms: _coach, after: (t) async {
      await browse(t); await t.tap(find.text('Prime de qualité')); await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining("VOIR L'ARTICLE")); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await t.pump(const Duration(milliseconds: 600));
      await t.tap(find.text('CONTINUER VERS LES AGRICULTEURS')); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining('KONÉ')); await t.pump(const Duration(milliseconds: 300));
      await t.tap(find.textContaining('CONTINUER AVEC')); await t.pump(); await t.pump(const Duration(milliseconds: 600)); });
    await shot(t, 'coach-formations', const TrainingListScreen(), perms: _coach);
    await shot(t, 'coach-formation', const TrainingFormScreen(), perms: _coach);
    await shot(t, 'coach-telecharger', const DownloadScreen(), perms: _coach);
    await shot(t, 'connexion', const LoginScreen());
    } finally { debugDisableShadows = true; }
  });

  // Séquences pour le film : une image après chaque geste (touche, saisie caractère par caractère), dans SEQ_DIR/<nom>/NN.png.
  // SEQ_DIR=/chemin CAPTURES_DIR=/tmp/x flutter test test/captures_test.dart --plain-name "séquences"
  final seqDir = Platform.environment['SEQ_DIR'];
  testWidgets('séquences', (t) async {
    if (seqDir == null) return;
    addTearDown(() => debugDisableShadows = true);
    debugDisableShadows = false;
    Finder field(String label) => find.byWidgetPredicate((w) => w is TextField && (w.decoration?.labelText ?? '').startsWith(label));
    Future<void> settle(WidgetTester t, [int ms = 200]) async { await t.runAsync(() => Future<void>.delayed(Duration(milliseconds: ms))); await t.pump(const Duration(milliseconds: 300)); }
    Future<void> run(String name, Widget screen, List<String> perms, Future<void> Function(WidgetTester, Future<void> Function() snap) flow, {int pending = 0}) async {
      final db = _Db()..pending = pending;
      db.kv['org_logo'] = base64Encode(File('../docs/brand/logo-cooperative-demo.png').readAsBytesSync());
      final api = _Api(_routes); final pack = MapPackStore(api); final repo = _Repo(db, perms, _decls, _parcels);
      services = Services(_Store(), api, db, repo, SyncEngine(db, api), pack, MapTiles(pack));
      final key = GlobalKey();
      t.view.physicalSize = const Size(1080, 2160); t.view.devicePixelRatio = 2.625;
      await t.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(debugShowCheckedModeBanner: false,
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2F5D46), primary: const Color(0xFF2F5D46)), useMaterial3: true, fontFamily: 'Roboto', appBarTheme: const AppBarTheme(backgroundColor: Color(0xFF2F5D46), foregroundColor: Colors.white)),
        home: ExcludeFocus(child: screen))));
      await settle(t, 500);
      final out = Directory('$seqDir/$name')..createSync(recursive: true); var n = 0;
      Future<void> snap() async {
        await settle(t, 250);
        await t.runAsync(() async {
          final b = key.currentContext!.findRenderObject() as RenderRepaintBoundary; final img = await b.toImage(pixelRatio: 1.0);
          File('${out.path}/${(n++).toString().padLeft(2, '0')}.png').writeAsBytesSync((await img.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List());
        });
      }
      await snap(); await flow(t, snap);
    }
    // Saisie progressive : 1 image par étape de texte
    Future<void> type(WidgetTester t, Future<void> Function() snap, String label, List<String> steps) async {
      for (final v in steps) { t.widget<TextField>(field(label)).controller!.text = v; await t.pump(const Duration(milliseconds: 120)); await snap(); }
    }
    await run('achat', const NewDeclarationScreen(), _collector, (t, snap) async {
      await t.tap(find.text('KONÉ Awa')); await settle(t); await snap();
      await t.tap(find.text('Continuer')); await settle(t, 300); await snap();
      await type(t, snap, 'Poids (kg)', ['5', '52', '520']);
      await type(t, snap, 'Nombre de sacs', ['8']);
      await type(t, snap, 'N° du reçu', ['A-00', 'A-0004', 'A-000412']);
    });
    await run('convoi', const NewConvoyScreen(), _collector, (t, snap) async {
      await type(t, snap, 'N° de connaissement du convoi', ['CV-', 'CV-0007']);
      await type(t, snap, 'Nom du chauffeur', ['Traoré', 'Traoré Moussa']);
      await type(t, snap, 'N° du camion', ['AB 12', 'AB 1234 CI']);
      await type(t, snap, 'Nombre de sacs', ['4', '40']);
      await type(t, snap, 'Poids annoncé', ['26', '2600']);
    });
    await run('producteur', const ProducersScreen(), _coach, (t, snap) async {
      await t.tap(find.textContaining('KONÉ')); await t.pump(const Duration(milliseconds: 300)); await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200))); await t.pump(const Duration(milliseconds: 600)); await snap();
      await t.tap(find.text('Informations sur le producteur')); await t.pump(const Duration(milliseconds: 400)); await snap();
    });
    Future<void> pickDropdown(WidgetTester t, int index, String text) async {
      await t.tap(find.byType(DropdownButtonFormField<String>).at(index)); await t.pump(const Duration(milliseconds: 400));
      await t.tap(find.text(text).last); await t.pump(const Duration(milliseconds: 400));
    }
    await run('distribution', const DistributionScreen(), _coach, (t, snap) async {
      await pickDropdown(t, 0, 'Finance'); await snap();
      await pickDropdown(t, 1, 'Primes'); await snap();
      await t.tap(find.text('Prime de qualité')); await t.pump(const Duration(milliseconds: 300)); await snap();
      await t.tap(find.textContaining("VOIR L'ARTICLE")); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await t.pump(const Duration(milliseconds: 600)); await snap();
      await t.tap(find.text('CONTINUER VERS LES AGRICULTEURS')); await t.pump(); await t.pump(const Duration(milliseconds: 600)); await settle(t); await snap();
      await t.tap(find.textContaining('KONÉ')); await t.pump(const Duration(milliseconds: 300)); await snap();
    });
    await run('formation', const TrainingFormScreen(), _coach, (t, snap) async { await snap(); });
    debugDisableShadows = true;
  });
}
