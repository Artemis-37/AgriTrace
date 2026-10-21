// Logique des fonds de carte en ligne : cache sur l'appareil, ordre des sources, limite de connexions, repli hors ligne.
import 'dart:io';
import 'dart:typed_data';

import 'package:agritrace_mobile/data/api_client.dart';
import 'package:agritrace_mobile/data/map_pack.dart';
import 'package:agritrace_mobile/data/map_tiles.dart';
import 'package:agritrace_mobile/data/session_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final png = Uint8List.fromList(List<int>.generate(64, (i) => i));

MapPackStore newPack() => MapPackStore(ApiClient(_NoStore()));

class _NoStore extends SessionStore {
  @override Future<String?> get accessToken async => null;
  @override Future<String?> get refreshToken async => null;
  @override Future<String?> get orgId async => null;
  @override Future<String?> get deviceToken async => null;
}

http.Response ok() => http.Response.bytes(png, 200, headers: {'content-type': 'image/png'});

void main() {
  late Directory dir;
  setUp(() async => dir = await Directory.systemTemp.createTemp('tiles'));
  tearDown(() async { if (await dir.exists()) await dir.delete(recursive: true); });

  MapTiles make(http.Client c, {Duration backoff = const Duration(seconds: 20)}) => MapTiles(newPack(), cacheDir: () async => dir, client: c, offlineBackoff: backoff);

  test('une tuile consultée est gardée : la deuxième demande ne touche pas au réseau, même après redémarrage', () async {
    var calls = 0;
    final t = make(MockClient((r) async { calls++; return ok(); }));
    expect(await t.tile(BaseLayer.plan, 16, 30000, 31000), png);
    expect(calls, 1);
    expect(await t.tile(BaseLayer.plan, 16, 30000, 31000), png);
    expect(calls, 1);
    final t2 = make(MockClient((r) async { calls++; return http.Response('', 500); }));
    expect(await t2.tile(BaseLayer.plan, 16, 30000, 31000), png, reason: 'nouvelle instance, même dossier : tuile retrouvée hors ligne');
    expect(calls, 1);
  });

  test('plan et satellite ont chacun leur cache et leur adresse', () async {
    final urls = <String>[];
    final t = make(MockClient((r) async { urls.add(r.url.toString()); return ok(); }));
    await t.tile(BaseLayer.plan, 10, 1, 2);
    await t.tile(BaseLayer.satellite, 10, 1, 2);
    expect(urls[0], 'https://tile.openstreetmap.org/10/1/2.png');
    expect(urls[1], 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/2/1');
  });

  test('sans réseau : pas de tuile, et plus de requêtes pendant la pause (pas de harcèlement)', () async {
    var calls = 0;
    final t = make(MockClient((r) async { calls++; throw const SocketException('pas de réseau'); }));
    expect(await t.tile(BaseLayer.satellite, 12, 1, 1), isNull);
    expect(t.offline.value, isTrue);
    expect(await t.tile(BaseLayer.satellite, 12, 2, 1), isNull);
    expect(calls, 1);
  });

  test('après la pause, une requête réussie rétablit l\'état « connecté »', () async {
    var fail = true;
    final t = make(MockClient((r) async { if (fail) throw const SocketException('x'); return ok(); }), backoff: const Duration(milliseconds: 30));
    await t.tile(BaseLayer.plan, 12, 1, 1);
    expect(t.offline.value, isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    fail = false;
    expect(await t.tile(BaseLayer.plan, 12, 1, 2), png);
    expect(t.offline.value, isFalse);
  });

  test('réponse qui n\'est pas une image (portail captif, erreur) : ignorée et non gardée', () async {
    final t = make(MockClient((r) async => http.Response('<html>Connectez-vous</html>', 200, headers: {'content-type': 'text/html'})));
    expect(await t.tile(BaseLayer.plan, 5, 1, 1), isNull);
    expect(await File('${dir.path}/plan/5/1_1.tile').exists(), isFalse);
    final e404 = make(MockClient((r) async => http.Response('', 404)));
    expect(await e404.tile(BaseLayer.plan, 5, 1, 2), isNull);
  });

  test('au plus 2 requêtes simultanées (règle d\'usage d\'OpenStreetMap)', () async {
    var running = 0, peak = 0;
    final t = make(MockClient((r) async {
      peak = ++running > peak ? running : peak;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      running--;
      return ok();
    }));
    await Future.wait([for (var i = 0; i < 12; i++) t.tile(BaseLayer.plan, 14, i, 0)]);
    expect(peak, 2);
  });

  test('deux demandes simultanées de la même tuile = une seule requête', () async {
    var calls = 0;
    final t = make(MockClient((r) async { calls++; await Future<void>.delayed(const Duration(milliseconds: 20)); return ok(); }));
    await Future.wait([t.tile(BaseLayer.plan, 14, 1, 1), t.tile(BaseLayer.plan, 14, 1, 1), t.tile(BaseLayer.plan, 14, 1, 1)]);
    expect(calls, 1);
  });

  test('zoom au-delà de la limite de la couche : aucune requête', () async {
    var calls = 0;
    final t = make(MockClient((r) async { calls++; return ok(); }));
    expect(await t.tile(BaseLayer.satellite, 19, 1, 1), isNull);
    expect(await t.tile(BaseLayer.plan, 20, 1, 1), isNull);
    expect(calls, 0);
  });

  test('le cache est plafonné : les plus anciennes tuiles partent en premier', () async {
    final cache = TileCache(dir, maxBytes: 1000);
    for (var i = 0; i < 20; i++) {
      await cache.put('plan', 10, i, 0, Uint8List(100));
      await File('${dir.path}/plan/10/${i}_0.tile').setLastModified(DateTime(2026, 1, 1).add(Duration(minutes: i)));
    }
    expect(await cache.size(), 2000);
    await cache.prune();
    expect(await cache.size(), lessThanOrEqualTo(900));
    expect(await cache.get('plan', 10, 0, 0), isNull, reason: 'la plus ancienne est supprimée');
    expect(await cache.get('plan', 10, 19, 0), isNotNull, reason: 'la plus récente est gardée');
  });

  test('vider le cache', () async {
    final t = make(MockClient((r) async => ok()));
    await t.tile(BaseLayer.plan, 3, 1, 1);
    expect(await t.cacheSize(), png.length);
    await t.clearCache();
    expect(await t.cacheSize(), 0);
  });
}
