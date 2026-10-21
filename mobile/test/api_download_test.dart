// Téléchargement du fond de carte : reprise après coupure (en-tête Range), fichier complet, fichier déjà entier.
// Fichier séparé : un test de widget interdirait toute requête réelle, même vers un serveur local.
import 'dart:io';

import 'package:agritrace_mobile/data/api_client.dart';
import 'package:agritrace_mobile/data/session_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

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

void main() {
  group('téléchargement avec reprise', () {
    late HttpServer server;
    late List<int> data;
    final seen = <String?>[];

    setUp(() async {
      data = List<int>.generate(100000, (i) => i % 251);
      seen.clear();
      server = await HttpServer.bind('127.0.0.1', 0);
      server.listen((req) async {
        seen.add(req.headers.value('range'));
        expect(req.headers.value('authorization'), 'Bearer jeton');
        expect(req.headers.value('x-organization-id'), 'org-1');
        final m = RegExp(r'^bytes=(\d+)-$')
            .firstMatch(req.headers.value('range') ?? '');
        req.response.headers.set('x-content-sha256', 'abc');
        if (m != null) {
          final s = int.parse(m.group(1)!);
          if (s >= data.length) {
            req.response.statusCode = 416;
            await req.response.close();
            return;
          }
          req.response.statusCode = 206;
          req.response.add(data.sublist(s));
        } else {
          req.response.add(data);
        }
        await req.response.close();
      });
    });
    tearDown(() => server.close(force: true));

    test('le téléchargement reprend à la taille du fichier partiel', () async {
      final dir = await Directory.systemTemp.createTemp('mp');
      final f = File('${dir.path}/x.part')
        ..writeAsBytesSync(data.sublist(0, 40000));
      final client = _Rewrite(server.port);
      final a = ApiClient(FakeStore(), client: client);
      final sha = await a.download('/map-packs/1/file', f);
      expect(sha, 'abc');
      expect(seen.single, 'bytes=40000-');
      expect(f.readAsBytesSync(), data);
      await dir.delete(recursive: true);
    });

    test('sans fichier partiel : téléchargement complet', () async {
      final dir = await Directory.systemTemp.createTemp('mp');
      final f = File('${dir.path}/x.part');
      final a = ApiClient(FakeStore(), client: _Rewrite(server.port));
      var last = 0;
      await a.download('/map-packs/1/file', f, onBytes: (n) => last = n);
      expect(seen.single, isNull);
      expect(f.lengthSync(), data.length);
      expect(last, data.length);
      await dir.delete(recursive: true);
    });

    test('fichier déjà complet : 416 sans réécriture', () async {
      final dir = await Directory.systemTemp.createTemp('mp');
      final f = File('${dir.path}/x.part')..writeAsBytesSync(data);
      final a = ApiClient(FakeStore(), client: _Rewrite(server.port));
      await a.download('/map-packs/1/file', f);
      expect(f.readAsBytesSync(), data);
      await dir.delete(recursive: true);
    });
  });
}

/// Redirige les appels de l'API vers le serveur de test (l'adresse réelle est fixée à la compilation).
class _Rewrite extends http.BaseClient {
  final int port;
  final inner = http.Client();
  _Rewrite(this.port);
  @override
  Future<http.StreamedResponse> send(http.BaseRequest r) {
    final u = r.url.replace(scheme: 'http', host: '127.0.0.1', port: port);
    final n = http.Request(r.method, u)..headers.addAll(r.headers);
    return inner.send(n);
  }
}
