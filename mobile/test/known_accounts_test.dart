// Comptes reconnus sur le téléphone : mémorisés après connexion, jeton tenu à jour, conservés à la déconnexion, oubliés sur demande.
import 'package:agritrace_mobile/data/session_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('connexion → compte mémorisé, jeton renouvelé mis à jour, déconnexion le conserve', () async {
    final s = SessionStore();
    await s.saveTokens('a1', 'r1');
    await s.rememberAccount(email: 'Aya@Demo.test', name: 'Aya Kouamé', org: 'org-1');
    var l = await s.knownAccounts();
    expect(l.single.email, 'aya@demo.test');
    expect(l.single.refresh, 'r1');
    expect(l.single.initials, 'AK');
    await s.saveTokens('a2', 'r2'); // le serveur fait tourner le jeton
    expect((await s.knownAccounts()).single.refresh, 'r2');
    await s.signOut();
    expect(await s.refreshToken, isNull);
    l = await s.knownAccounts();
    expect(l.single.refresh, 'r2');
  });

  test('reprise d\'un compte sans mot de passe, deux comptes distincts', () async {
    final s = SessionStore();
    await s.saveTokens('a', 'rA');
    await s.rememberAccount(email: 'a@x.test', name: 'Premier', org: 'o1');
    await s.signOut();
    await s.saveTokens('b', 'rB');
    await s.rememberAccount(email: 'b@x.test', name: 'Second', org: 'o2');
    await s.signOut();
    expect((await s.knownAccounts()).length, 2);
    final u = await s.useAccount('a@x.test');
    expect(u?.name, 'Premier');
    expect(await s.refreshToken, 'rA');
    expect(await s.orgId, 'o1');
    await s.saveTokens('a2', 'rA2');
    expect((await s.knownAccounts()).firstWhere((a) => a.email == 'a@x.test').refresh, 'rA2');
    expect((await s.knownAccounts()).firstWhere((a) => a.email == 'b@x.test').refresh, 'rB'); // l'autre compte n'est pas touché
  });

  test('session refusée : mot de passe requis ; oublier retire le compte', () async {
    final s = SessionStore();
    await s.saveTokens('a', 'rA');
    await s.rememberAccount(email: 'a@x.test', name: 'Aya', org: 'o1');
    await s.invalidateCurrentAccount();
    expect(await s.useAccount('a@x.test'), isNull);
    await s.forgetAccount('a@x.test');
    expect(await s.knownAccounts(), isEmpty);
  });
}
