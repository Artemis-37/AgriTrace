import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Jetons et clé de chiffrement de la base locale, dans le stockage sécurisé d'Android (Keystore).
class SessionStore {
  final FlutterSecureStorage _s = const FlutterSecureStorage();

  Future<String?> get accessToken => _s.read(key: 'access');
  Future<String?> get refreshToken => _s.read(key: 'refresh');
  Future<String?> get orgId => _s.read(key: 'org');

  /// Jeton propre à ce téléphone, remis lors de l'association (code à 8 caractères de l'administrateur).
  Future<String?> get deviceToken => _s.read(key: 'device');
  Future<void> setDeviceToken(String t) => _s.write(key: 'device', value: t);

  Future<void> saveTokens(String access, String refresh) async {
    await _s.write(key: 'access', value: access);
    await _s.write(key: 'refresh', value: refresh);
  }

  Future<void> setOrg(String id) => _s.write(key: 'org', value: id);

  /// Clé de chiffrement SQLCipher, générée une fois et jamais affichée ni envoyée.
  Future<String> databaseKey() async {
    var k = await _s.read(key: 'dbkey');
    if (k == null) {
      k = const Uuid().v4() + const Uuid().v4();
      await _s.write(key: 'dbkey', value: k);
    }
    return k;
  }

  /// Déconnexion : on retire les jetons mais on conserve la clé et les opérations en attente.
  Future<void> signOut() async {
    await _s.delete(key: 'access');
    await _s.delete(key: 'refresh');
  }
}
