// Révocation de l'accès : l'appareil n'efface ses données que si le serveur refuse définitivement le renouvellement de la session.
// Fichier séparé (pas de test de widget) comme les autres tests réseau.
import 'dart:io';

import 'package:agritrace_mobile/data/api_client.dart';
import 'package:agritrace_mobile/data/session_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class Store extends SessionStore {
  @override
  Future<String?> get accessToken async => 'vieux';
  @override
  Future<String?> get refreshToken async => 'refresh';
  @override
  Future<String?> get orgId async => 'org-1';
  @override
  Future<String?> get deviceToken async => null;
  @override
  Future<void> saveTokens(String a, String r) async {}
}

void main() {
  test('refresh refusé (401) : accès révoqué, purge demandée une fois', () async {
    var purges = 0;
    final client = MockClient((req) async => http.Response('{"message":"Session révoquée"}', 401));
    final api = ApiClient(Store(), client: client)..onRevoked = () async => purges++;
    await expectLater(api.get('/producers'), throwsA(isA<ApiException>()));
    expect(purges, 1);
  });

  test('refresh refusé (403, compte suspendu) : purge demandée', () async {
    var purges = 0;
    final client = MockClient((req) async => req.url.path.endsWith('/auth/refresh') ? http.Response('{}', 403) : http.Response('{}', 401));
    final api = ApiClient(Store(), client: client)..onRevoked = () async => purges++;
    await expectLater(api.get('/producers'), throwsA(isA<ApiException>()));
    expect(purges, 1);
  });

  test('coupure réseau pendant le renouvellement : aucune purge', () async {
    var purges = 0;
    final client = MockClient((req) async {
      if (req.url.path.endsWith('/auth/refresh')) throw const SocketException('hors réseau');
      return http.Response('{}', 401);
    });
    final api = ApiClient(Store(), client: client)..onRevoked = () async => purges++;
    await expectLater(api.get('/producers'), throwsA(isA<NetworkException>()));
    expect(purges, 0);
  });

  test('erreur serveur (500) pendant le renouvellement : aucune purge', () async {
    var purges = 0;
    final client = MockClient((req) async => req.url.path.endsWith('/auth/refresh') ? http.Response('', 500) : http.Response('{}', 401));
    final api = ApiClient(Store(), client: client)..onRevoked = () async => purges++;
    await expectLater(api.get('/producers'), throwsA(isA<ApiException>()));
    expect(purges, 0);
  });

  test('refus de permission (403) sur une requête normale : aucune purge', () async {
    var purges = 0;
    final client = MockClient((req) async => http.Response('{"message":"Droit manquant"}', 403));
    final api = ApiClient(Store(), client: client)..onRevoked = () async => purges++;
    await expectLater(api.get('/producers'), throwsA(isA<ApiException>()));
    expect(purges, 0);
  });
}
