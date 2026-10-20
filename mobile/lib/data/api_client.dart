import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../config.dart';
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
  ApiClient(this.store, {http.Client? client}) : _http = client ?? http.Client();

  Uri _uri(String path, [Map<String, String>? q]) => Uri.parse('${Config.apiBase}$path').replace(queryParameters: q);

  Future<bool> login(String email, String password, {String? deviceLabel}) async {
    final res = await _send('POST', '/auth/login',
        body: {'email': email, 'password': password, if (deviceLabel != null) 'device_label': deviceLabel}, auth: false, org: false);
    await store.saveTokens(res['access_token'] as String, res['refresh_token'] as String);
    return true;
  }

  Future<List<dynamic>> myOrganizations() async => (await _send('GET', '/organizations', org: false)) as List<dynamic>;

  Future<dynamic> get(String path, {Map<String, String>? query}) => _send('GET', path, query: query);
  Future<dynamic> post(String path, Object body) => _send('POST', path, body: body);

  Future<dynamic> _send(String method, String path,
      {Object? body, Map<String, String>? query, bool auth = true, bool org = true}) async {
    Future<http.Response> once() async {
      final headers = <String, String>{'content-type': 'application/json'};
      if (auth) {
        final t = await store.accessToken;
        if (t != null) headers['authorization'] = 'Bearer $t';
      }
      if (org) {
        final o = await store.orgId;
        if (o != null) headers['x-organization-id'] = o;
      }
      final req = http.Request(method, _uri(path, query))..headers.addAll(headers);
      if (body != null) req.body = jsonEncode(body);
      final streamed = await _http.send(req).timeout(const Duration(seconds: 30));
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

  /// Renouvelle la session ; le serveur fait tourner le jeton de renouvellement.
  Future<bool> _refresh() async {
    final rt = await store.refreshToken;
    if (rt == null) return false;
    try {
      final res = await _http
          .post(_uri('/auth/refresh'), headers: {'content-type': 'application/json'}, body: jsonEncode({'refresh_token': rt}))
          .timeout(const Duration(seconds: 30));
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
