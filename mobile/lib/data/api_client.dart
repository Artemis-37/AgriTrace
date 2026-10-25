import 'dart:typed_data';
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'pinned_client.dart';
import 'session_store.dart';

/// Réponse d'erreur du serveur (HTTP >= 400).
class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => 'ApiException($status): $message';
}

/// Pas de réseau, délai dépassé ou serveur injoignable : l'opération reste en attente, rien n'est perdu.
class NetworkException implements Exception {
  final String message;
  NetworkException(this.message);
  @override
  String toString() => 'NetworkException: $message';
}

class ApiClient {
  final SessionStore store;
  final http.Client _http;
  /// Appelé quand le serveur refuse définitivement le renouvellement de la session (compte suspendu, session révoquée).
  /// Jamais appelé sur une simple coupure réseau.
  Future<void> Function()? onRevoked;
  /// Jeton de renouvellement refusé par le serveur : on ne le présente plus (évite de multiplier les appels), jusqu'à une nouvelle connexion.
  String? deadToken;
  Future<bool>? _refreshing;

  ApiClient(this.store, {http.Client? client}) : _http = client ?? createHttpClient();

  /// Teste une adresse de serveur (GET /health) sans la mémoriser : renvoie null si le serveur répond, sinon la raison.
  Future<String?> probe(String base) async {
    try {
      final r = await _http.get(Uri.parse('$base/health')).timeout(Config.requestTimeout);
      return r.statusCode == 200 ? null : 'Le serveur répond « ${r.statusCode} » : ce n\'est pas le bon serveur ou il n\'est pas prêt.';
    } on TimeoutException {
      return 'Aucune réponse après ${Config.requestTimeout.inSeconds} s : le serveur est éteint ou injoignable.';
    } on SocketException catch (e) {
      return 'Serveur introuvable (${e.message}). Vérifiez l\'adresse et la connexion Internet.';
    } on http.ClientException catch (e) {
      return 'Connexion impossible (${e.message}).';
    } catch (e) {
      return 'Connexion impossible ($e).';
    }
  }

  Uri _uri(String path, [Map<String, String>? q]) => Uri.parse('${Config.apiBaseRuntime}$path').replace(queryParameters: q);

  Future<bool> login(String email, String password, {String? deviceLabel, String? otp}) async {
    final res = await _send('POST', '/auth/login',
        body: {'email': email, 'password': password, if (deviceLabel != null) 'device_label': deviceLabel, if (otp != null && otp.isNotEmpty) 'otp': otp}, auth: false, org: false);
    await store.saveTokens(res['access_token'] as String, res['refresh_token'] as String);
    return true;
  }

  /// Associe ce téléphone à la coopérative avec le code remis par l'administrateur (avant toute connexion).
  Future<String> pairWorkstation(String code) async {
    final res = await _send('POST', '/workstations/pair', body: {'code': code}, auth: false, org: false);
    await store.setDeviceToken(res['device_token'] as String);
    return res['name'] as String;
  }

  Future<List<dynamic>> myOrganizations() async => (await _send('GET', '/organizations', org: false)) as List<dynamic>;

  Future<dynamic> get(String path, {Map<String, String>? query}) => _send('GET', path, query: query);
  Future<dynamic> post(String path, Object body) => _send('POST', path, body: body);

  /// Lecture d'un fichier binaire (logo) : null s'il n'existe pas (404).
  Future<Uint8List?> getBytes(String path) async {
    Future<http.Response> once() async {
      final headers = <String, String>{};
      final t = await store.accessToken;
      if (t != null) headers['authorization'] = 'Bearer $t';
      final dev = await store.deviceToken;
      if (dev != null) headers['x-device-token'] = dev;
      final o = await store.orgId;
      if (o != null) headers['x-organization-id'] = o;
      return _http.get(_uri(path), headers: headers).timeout(Config.requestTimeout);
    }

    try {
      var res = await once();
      if (res.statusCode == 401 && await _refresh()) res = await once();
      if (res.statusCode == 404) return null;
      if (res.statusCode >= 400) throw ApiException(res.statusCode, 'Lecture impossible');
      return res.bodyBytes;
    } on SocketException catch (e) {
      throw NetworkException(e.message);
    } on TimeoutException {
      throw NetworkException('Délai dépassé');
    } on http.ClientException catch (e) {
      throw NetworkException(e.message);
    }
  }

  Future<dynamic> _send(String method, String path,
      {Object? body, Map<String, String>? query, bool auth = true, bool org = true}) async {
    Future<http.Response> once() async {
      final headers = <String, String>{'content-type': 'application/json'};
      if (auth) {
        final t = await store.accessToken;
        if (t != null) headers['authorization'] = 'Bearer $t';
      }
      final dev = await store.deviceToken;
      if (dev != null) headers['x-device-token'] = dev;
      if (org) {
        final o = await store.orgId;
        if (o != null) headers['x-organization-id'] = o;
      }
      final req = http.Request(method, _uri(path, query))..headers.addAll(headers);
      if (body != null) req.body = jsonEncode(body);
      final streamed = await _http.send(req).timeout(Config.requestTimeout);
      return http.Response.fromStream(streamed);
    }

    try {
      var res = await once();
      if (res.statusCode == 401 && auth && await _refresh()) res = await once();
      if (res.statusCode >= 400) {
        String msg = res.body;
        try {
          final j = jsonDecode(utf8.decode(res.bodyBytes));
          final m = j is Map ? j['message'] : null;
          msg = m is List ? m.join(', ') : (m?.toString() ?? msg);
        } catch (_) {}
        throw ApiException(res.statusCode, msg);
      }
      if (res.body.isEmpty) return null;
      return jsonDecode(utf8.decode(res.bodyBytes));
    } on SocketException catch (e) {
      throw NetworkException(e.message);
    } on TimeoutException {
      throw NetworkException('Délai dépassé');
    } on http.ClientException catch (e) {
      throw NetworkException(e.message);
    }
  }

  /// Envoi d'un fichier (pièce jointe). Même gestion de session et d'erreurs que les autres appels.
  Future<dynamic> upload(String path, {required Map<String, String> fields, required String filePath, required String filename}) async {
    Future<http.Response> once() async {
      final req = http.MultipartRequest('POST', _uri(path))..fields.addAll(fields);
      final t = await store.accessToken;
      if (t != null) req.headers['authorization'] = 'Bearer $t';
      final dev = await store.deviceToken;
      if (dev != null) req.headers['x-device-token'] = dev;
      final o = await store.orgId;
      if (o != null) req.headers['x-organization-id'] = o;
      req.files.add(await http.MultipartFile.fromPath('file', filePath, filename: filename));
      final streamed = await _http.send(req).timeout(const Duration(seconds: 90));
      return http.Response.fromStream(streamed);
    }

    try {
      var res = await once();
      if (res.statusCode == 401 && await _refresh()) res = await once();
      if (res.statusCode >= 400) {
        var msg = res.body;
        try {
          final j = jsonDecode(utf8.decode(res.bodyBytes));
          final m = j is Map ? j['message'] : null;
          msg = m is List ? m.join(', ') : (m?.toString() ?? msg);
        } catch (_) {}
        throw ApiException(res.statusCode, msg);
      }
      return res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } on SocketException catch (e) {
      throw NetworkException(e.message);
    } on TimeoutException {
      throw NetworkException('Délai dépassé');
    } on http.ClientException catch (e) {
      throw NetworkException(e.message);
    }
  }

  /// Téléchargement d'un gros fichier, reprenable : les octets sont ajoutés à [target] à partir de sa taille actuelle (en-tête Range).
  /// Retourne l'empreinte SHA-256 annoncée par le serveur (null si absente).
  Future<String?> download(String path, File target, {void Function(int received)? onBytes}) async {
    Future<http.StreamedResponse> once() async {
      final start = await target.exists() ? await target.length() : 0;
      final req = http.Request('GET', _uri(path));
      final t = await store.accessToken;
      if (t != null) req.headers['authorization'] = 'Bearer $t';
      final dev = await store.deviceToken;
      if (dev != null) req.headers['x-device-token'] = dev;
      final o = await store.orgId;
      if (o != null) req.headers['x-organization-id'] = o;
      if (start > 0) req.headers['range'] = 'bytes=$start-';
      return _http.send(req).timeout(Config.requestTimeout);
    }

    try {
      var res = await once();
      if (res.statusCode == 401 && await _refresh()) res = await once();
      if (res.statusCode == 416) { // fichier déjà complet côté téléphone
        await res.stream.drain<void>();
        return res.headers['x-content-sha256'];
      }
      if (res.statusCode >= 400) {
        final body = await res.stream.bytesToString();
        var msg = body;
        try { final j = jsonDecode(body); final m = j is Map ? j['message'] : null; msg = m is List ? m.join(', ') : (m?.toString() ?? body); } catch (_) {}
        throw ApiException(res.statusCode, msg);
      }
      // 200 : le serveur renvoie tout (pas de reprise possible) ; 206 : suite du fichier.
      final sink = target.openWrite(mode: res.statusCode == 206 ? FileMode.append : FileMode.write);
      var received = res.statusCode == 206 ? await target.length() : 0;
      try {
        await for (final chunk in res.stream.timeout(Config.requestTimeout)) {
          sink.add(chunk);
          received += chunk.length;
          onBytes?.call(received);
        }
      } finally {
        await sink.close();
      }
      return res.headers['x-content-sha256'];
    } on SocketException catch (e) {
      throw NetworkException(e.message);
    } on TimeoutException {
      throw NetworkException('Délai dépassé');
    } on http.ClientException catch (e) {
      throw NetworkException(e.message);
    }
  }

  /// Renouvelle la session ; le serveur fait tourner le jeton de renouvellement.
  /// Un seul renouvellement à la fois : plusieurs requêtes qui expirent ensemble partagent le même appel
  /// (deux renouvellements simultanés avec le même jeton seraient pris pour un vol de session par le serveur).
  Future<bool> _refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final rt = await store.refreshToken;
    if (rt == null || rt == deadToken) return false;
    try {
      final res = await _http
          .post(_uri('/auth/refresh'), headers: {'content-type': 'application/json'}, body: jsonEncode({'refresh_token': rt}))
          .timeout(Config.requestTimeout);
      if (res.statusCode == 401 || res.statusCode == 403) {
        deadToken = rt;
        await onRevoked?.call();
        return false;
      }
      if (res.statusCode != 200 && res.statusCode != 201) return false;
      final j = jsonDecode(res.body) as Map<String, dynamic>;
      await store.saveTokens(j['access_token'] as String, j['refresh_token'] as String);
      return true;
    } on SocketException {
      throw NetworkException('Réseau indisponible');
    } on TimeoutException {
      throw NetworkException('Délai dépassé');
    }
  }
}
