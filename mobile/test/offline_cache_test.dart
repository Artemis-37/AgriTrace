import 'package:flutter_test/flutter_test.dart';
import 'package:agritrace_mobile/data/api_client.dart';
import 'package:agritrace_mobile/data/session_store.dart';

void main() {
  test('hors connexion : l\'appel échoue tout de suite sans attendre le réseau', () async {
    final api = ApiClient(SessionStore());
    api.isOffline = () async => true;
    final sw = Stopwatch()..start();
    await expectLater(api.get('/convoys'), throwsA(isA<NetworkException>()));
    expect(sw.elapsed.inSeconds, lessThan(2));
  });
}
