import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:agritrace_mobile/data/api_client.dart';
import 'package:agritrace_mobile/data/map_pack.dart';
import 'package:agritrace_mobile/data/map_tiles.dart';
import 'package:agritrace_mobile/data/session_store.dart';
import 'package:agritrace_mobile/geo/polygon.dart';
import 'package:agritrace_mobile/screens/basemap_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakeStore extends SessionStore {
  @override
  Future<String?> get accessToken async => 'jeton';
  @override
  Future<String?> get refreshToken async => null;
  @override
  Future<String?> get orgId async => 'org-1';
  @override
  Future<String?> get deviceToken async => null;
}

/// PNG 1×1 valide.
final png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');

class FakePack extends MapPackStore {
  final requested = <String>[];
  FakePack() : super(ApiClient(FakeStore())) {
    local = const MapPackInfo(
        id: 'p1', name: 'Hiré 2026', sha256: 'aa', sizeBytes: 1);
    minZoom = 10;
    maxZoom = 18;
  }
  @override
  bool get ready => true;
  @override
  Future<Uint8List?> tile(int z, int x, int y) async {
    requested.add('$z/$x/$y');
    return png;
  }
}

void main() {
  group('décision de téléchargement', () {
    final store = MapPackStore(ApiClient(FakeStore()));
    const remote = MapPackInfo(id: 'p2', name: 'N', sha256: 'bb', sizeBytes: 5);
    test('rien sur le serveur : rien à faire',
        () => expect(store.needsDownload(null), isFalse));
    test('rien sur le téléphone : télécharger',
        () => expect(store.needsDownload(remote), isTrue));
    test('même empreinte : à jour', () {
      store.local =
          const MapPackInfo(id: 'p1', name: 'N', sha256: 'bb', sizeBytes: 5);
      expect(store.needsDownload(remote), isFalse);
    });
    test('empreinte différente : mettre à jour', () {
      store.local =
          const MapPackInfo(id: 'p1', name: 'N', sha256: 'aa', sizeBytes: 5);
      expect(store.needsDownload(remote), isTrue);
    });
  });

  testWidgets('la carte demande les tuiles du paquet, au zoom du tracé, et se déplace', (t) async {
    final pack = FakePack();
    final tiles = MapTiles(pack, cacheDir: () async => Directory.systemTemp.createTemp('tc'), client: MockClient((r) async => http.Response('', 404)));
    final pts = [const GeoPoint(6.0833, -5.2833), const GeoPoint(6.0842, -5.2833), const GeoPoint(6.0842, -5.2824)];
    await t.pumpWidget(MaterialApp(home: Scaffold(body: BasemapView(tiles: tiles, points: pts, height: 240))));
    await t.pump();
    expect(find.byType(Image), findsWidgets);
    expect(pack.requested, isNotEmpty);
    final z = int.parse(pack.requested.first.split('/').first);
    expect(z, inInclusiveRange(15, 19));
    expect(pack.requested.every((r) => r.startsWith('$z/')), isTrue);
    expect(find.textContaining('Hiré 2026'), findsOneWidget);
    final before = pack.requested.length;
    await t.drag(find.byType(BasemapView), const Offset(-300, 0));
    await t.pump();
    expect(pack.requested.length, greaterThan(before), reason: 'déplacement : de nouvelles tuiles sont demandées');
    await t.tap(find.byTooltip('Agrandir'));
    await t.pump();
    await t.tap(find.byTooltip('Recentrer'));
    await t.pump();
    expect(t.takeException(), isNull);
  });

  testWidgets('choix de la couche : le plan OpenStreetMap et le satellite passent par le réseau, avec attribution', (t) async {
    final urls = <String>[];
    final agents = <String?>[];
    final tiles = MapTiles(FakePack(), cacheDir: () async => Directory.systemTemp.createTemp('tc'), client: MockClient((r) async {
      urls.add(r.url.toString());
      agents.add(r.headers['user-agent']);
      return http.Response.bytes(png, 200, headers: {'content-type': 'image/png'});
    }));
    final pts = [const GeoPoint(6.0833, -5.2833), const GeoPoint(6.0842, -5.2833), const GeoPoint(6.0842, -5.2824)];
    await t.pumpWidget(MaterialApp(home: Scaffold(body: BasemapView(tiles: tiles, points: pts, height: 240))));
    await t.pump();
    expect(urls, isEmpty, reason: 'le paquet de la coopérative ne touche pas au réseau');
    expect(find.text('6.083750'), findsWidgets, reason: 'latitude du point visé (centre de la carte) affichée');
    expect(find.text('-5.282850'), findsWidgets, reason: 'longitude du point visé affichée');
    await t.tap(find.text('Coopérative'));
    await t.pumpAndSettle();
    // Les lectures de fichiers et les requêtes se font en temps réel : on laisse tourner la vraie boucle d'événements.
    await t.runAsync(() async {
      await t.tap(find.text('Plan').last);
      await t.pump();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await t.pump();
    });
    expect(urls, isNotEmpty);
    expect(urls.every((u) => u.startsWith('https://tile.openstreetmap.org/')), isTrue);
    expect(agents.every((a) => a != null && a.startsWith('AgriTrace/')), isTrue, reason: 'OpenStreetMap exige une identification de l\'application');
    expect(find.textContaining('OpenStreetMap'), findsOneWidget);
    await t.tap(find.byType(DropdownButton<BaseLayer>));
    await t.pumpAndSettle();
    await t.runAsync(() async {
      await t.tap(find.text('Satellite').last);
      await t.pump();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await t.pump();
    });
    expect(urls.any((u) => u.contains('arcgisonline.com')), isTrue);
    expect(find.textContaining('Esri'), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}

Object? tester(WidgetTester t) => t.takeException();
