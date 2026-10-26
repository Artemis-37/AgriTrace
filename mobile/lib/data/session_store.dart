import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Compte déjà connecté sur ce téléphone : reconnu à l'écran de connexion, sans ressaisie du mot de passe tant que la session reste valide.
/// Aucun mot de passe n'est conservé : seulement le jeton de renouvellement, dans le Keystore.
class KnownAccount {
  final String email, name, org, refresh;
  final DateTime last;
  const KnownAccount({required this.email, required this.name, required this.org, required this.refresh, required this.last});
  Map<String, Object?> toJson() => {'email': email, 'name': name, 'org': org, 'refresh': refresh, 'last': last.toIso8601String()};
  factory KnownAccount.fromJson(Map<String, dynamic> j) => KnownAccount(email: '${j['email']}', name: '${j['name'] ?? ''}', org: '${j['org'] ?? ''}', refresh: '${j['refresh'] ?? ''}', last: DateTime.tryParse('${j['last']}') ?? DateTime.now());
  KnownAccount copy({String? refresh, DateTime? last, String? name, String? org}) => KnownAccount(email: email, name: name ?? this.name, org: org ?? this.org, refresh: refresh ?? this.refresh, last: last ?? this.last);
  String get initials { final p = name.trim().split(RegExp(r'\s+')).where((x) => x.isNotEmpty).toList(); return p.isEmpty ? email.substring(0, 1).toUpperCase() : p.take(2).map((x) => x[0].toUpperCase()).join(); }
}

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
    // Le serveur fait tourner le jeton de renouvellement : la copie du compte en cours est tenue à jour.
    final cur = await _s.read(key: 'current');
    if (cur != null) await _update(cur, (a) => a.copy(refresh: refresh));
  }

  // ── Comptes reconnus sur ce téléphone
  Future<List<KnownAccount>> knownAccounts() async {
    final raw = await _s.read(key: 'accounts');
    if (raw == null) return [];
    try {
      final l = (jsonDecode(raw) as List).map((e) => KnownAccount.fromJson(Map<String, dynamic>.from(e as Map))).toList();
      l.sort((a, b) => b.last.compareTo(a.last));
      return l;
    } catch (_) { return []; }
  }

  Future<void> _saveAccounts(List<KnownAccount> l) => _s.write(key: 'accounts', value: jsonEncode(l.map((a) => a.toJson()).toList()));

  Future<void> _update(String email, KnownAccount Function(KnownAccount) f) async {
    final l = await knownAccounts();
    final i = l.indexWhere((a) => a.email == email);
    if (i < 0) return;
    l[i] = f(l[i]);
    await _saveAccounts(l);
  }

  /// Après une connexion réussie : ce compte devient le compte en cours et est mémorisé.
  Future<void> rememberAccount({required String email, required String name, required String org}) async {
    final e = email.trim().toLowerCase();
    final refresh = await refreshToken ?? '';
    final l = (await knownAccounts()).where((a) => a.email != e).toList()
      ..add(KnownAccount(email: e, name: name, org: org, refresh: refresh, last: DateTime.now()));
    await _saveAccounts(l);
    await _s.write(key: 'current', value: e);
  }

  /// Compte choisi sur l'écran de connexion : ses jetons deviennent ceux de la session. Null si le compte n'a plus de session conservée.
  Future<KnownAccount?> useAccount(String email) async {
    final a = (await knownAccounts()).where((x) => x.email == email).firstOrNull;
    if (a == null || a.refresh.isEmpty) return null;
    await _s.write(key: 'current', value: a.email);
    await _s.write(key: 'access', value: '');
    await _s.write(key: 'refresh', value: a.refresh);
    if (a.org.isNotEmpty) await setOrg(a.org);
    return a;
  }

  /// « Oublier ce compte » : il disparaît de la liste (la prochaine connexion exigera le mot de passe).
  Future<void> forgetAccount(String email) async => _saveAccounts((await knownAccounts()).where((a) => a.email != email).toList());

  /// Session refusée par le serveur (accès retiré ou expiré) : le compte reste dans la liste mais devra ressaisir son mot de passe.
  Future<void> invalidateCurrentAccount() async {
    final cur = await _s.read(key: 'current');
    if (cur != null) await _update(cur, (a) => a.copy(refresh: ''));
  }

  /// Adresse du serveur choisie sur l'écran de connexion (conservée à la déconnexion).
  Future<String?> get serverUrl => _s.read(key: 'server');
  Future<void> setServerUrl(String? u) => (u == null || u.isEmpty) ? _s.delete(key: 'server') : _s.write(key: 'server', value: u);

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
    await _s.delete(key: 'current'); // le compte reste mémorisé (voir knownAccounts) avec son dernier jeton de renouvellement
  }
}
