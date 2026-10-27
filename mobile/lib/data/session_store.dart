import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Compte déjà connecté sur ce téléphone : reconnu à l'écran de connexion, sans ressaisie du mot de passe tant que la session reste valide.
/// Ici, seulement le jeton de renouvellement (dans le Keystore) ; les mots de passe mémorisés à la demande de l'utilisateur sont à part (SavedLogin).
class KnownAccount {
  final String email, name, org, refresh;
  final DateTime last;
  const KnownAccount({required this.email, required this.name, required this.org, required this.refresh, required this.last});
  Map<String, Object?> toJson() => {'email': email, 'name': name, 'org': org, 'refresh': refresh, 'last': last.toIso8601String()};
  factory KnownAccount.fromJson(Map<String, dynamic> j) => KnownAccount(email: '${j['email']}', name: '${j['name'] ?? ''}', org: '${j['org'] ?? ''}', refresh: '${j['refresh'] ?? ''}', last: DateTime.tryParse('${j['last']}') ?? DateTime.now());
  KnownAccount copy({String? refresh, DateTime? last, String? name, String? org}) => KnownAccount(email: email, name: name ?? this.name, org: org ?? this.org, refresh: refresh ?? this.refresh, last: last ?? this.last);
  String get initials { final p = name.trim().split(RegExp(r'\s+')).where((x) => x.isNotEmpty).toList(); return p.isEmpty ? email.substring(0, 1).toUpperCase() : p.take(2).map((x) => x[0].toUpperCase()).join(); }
}

/// Accès mémorisé (« Se souvenir de mes identifiants ») : e-mail et mot de passe, proposés dans une liste quand on touche le champ e-mail.
class SavedLogin {
  final String email, password;
  const SavedLogin(this.email, this.password);
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

  // ── Accès mémorisés (stockage sécurisé Android, chiffré par le Keystore)
  Future<List<SavedLogin>> savedLogins() async {
    final raw = await _s.read(key: 'saved_logins');
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List).map((e) => SavedLogin('${(e as Map)['e']}', '${e['p']}')).where((x) => x.email.isNotEmpty).toList();
    } catch (_) { return []; }
  }

  Future<void> _writeLogins(List<SavedLogin> l) => l.isEmpty ? _s.delete(key: 'saved_logins') : _s.write(key: 'saved_logins', value: jsonEncode(l.map((x) => {'e': x.email, 'p': x.password}).toList()));

  /// Mémorise (ou met à jour) l'accès ; le plus récent passe en tête de liste.
  Future<void> saveLogin(String email, String password) async {
    final e = email.trim().toLowerCase();
    if (e.isEmpty || password.isEmpty) return;
    final l = (await savedLogins()).where((x) => x.email != e).toList()..insert(0, SavedLogin(e, password));
    await _writeLogins(l);
  }

  Future<void> removeLogin(String email) async => _writeLogins((await savedLogins()).where((x) => x.email != email.trim().toLowerCase()).toList());

  /// Mot de passe changé pour le compte en cours : la copie mémorisée (s'il y en a une) est mise à jour.
  Future<void> updateSavedPassword(String password) async {
    final cur = await _s.read(key: 'current');
    if (cur == null) return;
    final l = await savedLogins();
    if (l.any((x) => x.email == cur)) await _writeLogins([for (final x in l) x.email == cur ? SavedLogin(cur, password) : x]);
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
  Future<void> forgetAccount(String email) async { await _saveAccounts((await knownAccounts()).where((a) => a.email != email).toList()); await removeLogin(email); }

  /// Session refusée par le serveur (accès retiré ou expiré) : le compte reste dans la liste mais devra ressaisir son mot de passe.
  Future<void> invalidateCurrentAccount() async {
    final cur = await _s.read(key: 'current');
    if (cur != null) await _update(cur, (a) => a.copy(refresh: ''));
  }

  /// Adresse du serveur choisie sur l'écran de connexion (conservée à la déconnexion).
  Future<String?> get serverUrl => _s.read(key: 'server');
  Future<void> setServerUrl(String? u) => (u == null || u.isEmpty) ? _s.delete(key: 'server') : _s.write(key: 'server', value: u);

  Future<void> setOrg(String id) => _s.write(key: 'org', value: id);

  /// Base locale de chaque compte (e-mail → fichier) et base en cours : chaque compte garde ses données sur le téléphone.
  Future<Map<String, String>> dbMap() async {
    final r = await _s.read(key: 'dbmap');
    if (r == null) return {};
    try { return Map<String, String>.from(jsonDecode(r) as Map); } catch (_) { return {}; }
  }
  Future<void> setDbMap(Map<String, String> m) => _s.write(key: 'dbmap', value: jsonEncode(m));
  Future<String> get currentDbFile async => (await _s.read(key: 'dbcurrent')) ?? 'agritrace.db';
  Future<void> setCurrentDbFile(String f) => _s.write(key: 'dbcurrent', value: f);

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
