import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';

import '../config.dart';
import '../data/api_client.dart';
import '../data/app_database.dart';
import 'sync_state.dart';

enum SyncPhase { idle, syncing, offline, error, blocked }

class SyncStatus {
  final SyncPhase phase;
  final DateTime? lastSuccess;
  final String? message;
  const SyncStatus(this.phase, {this.lastSuccess, this.message});
}

enum SyncStepState { waiting, doing, done, skipped, failed }

/// Une étape de la synchronisation, telle qu'affichée dans la boîte de dialogue de progression.
class SyncStep {
  final String label;
  final SyncStepState state;
  final String detail;
  const SyncStep(this.label, this.state, [this.detail = '']);
}

/// Moteur de synchronisation bidirectionnelle.
///  1. ENVOI : les opérations de la file d'attente partent par lots avec leur clé d'idempotence ; le serveur renvoie un
///     résultat explicite par opération (accepted, rejected, to_correct, conflict, pending_validation). Une coupure
///     laisse les opérations en file : rien n'est perdu et le renvoi ne crée pas de doublon.
///  2. RÉCEPTION : les changements sont téléchargés depuis un curseur, appliqués en une transaction, et le curseur
///     n'avance qu'après application (reprise sûre après interruption).
class SyncEngine {
  final AppDatabase db;
  final ApiClient api;
  bool _running = false;
  /// Vrai quand l'accès a été révoqué : l'écran revient à la connexion.
  final ValueNotifier<bool> revoked = ValueNotifier(false);
  final ValueNotifier<SyncStatus> status = ValueNotifier(const SyncStatus(SyncPhase.idle));

  SyncEngine(this.db, this.api);

  static const _labels = ['Envoi de vos opérations', 'Envoi des photos', 'Tâches et éléments des profils', 'Producteurs, parcelles et données'];
  /// Progression de la synchronisation en cours (ou de la dernière) : alimente la boîte de dialogue.
  final ValueNotifier<List<SyncStep>> steps = ValueNotifier([for (final l in _labels) SyncStep(l, SyncStepState.waiting)]);
  void _step(int i, SyncStepState st, [String detail = '']) {
    final l = [...steps.value];
    l[i] = SyncStep(_labels[i], st, detail);
    steps.value = l;
  }

  /// Opérations (et photos) qui attendent encore d'être envoyées : tant qu'il en reste, rien n'est téléchargé, pour ne pas mélanger
  /// ce qui est sur le téléphone avec ce qui est sur le serveur.
  Future<int> _toSubmit() async {
    final ops = Sqflite.firstIntValue(await db.raw.rawQuery("SELECT count(*) FROM outbox WHERE status IN ('pending','pending_validation')")) ?? 0;
    final photos = Sqflite.firstIntValue(await db.raw.rawQuery("SELECT count(*) FROM pending_uploads WHERE status = 'pending'")) ?? 0;
    return ops + photos;
  }

  bool _blocked = false;
  /// Suspend la synchronisation (session refusée par le serveur) : le reste de l'application reste utilisable, les saisies restent sur l'appareil.
  void block() {
    _blocked = true;
    status.value = SyncStatus(SyncPhase.blocked, lastSuccess: status.value.lastSuccess, message: 'Session expirée ou accès retiré');
  }

  Future<void> run() async {
    if (_blocked) {
      // Levée du blocage dès qu'une nouvelle connexion a fourni un autre jeton.
      final t = await api.store.refreshToken;
      if (t == null || t == api.deadToken) {
        status.value = SyncStatus(SyncPhase.blocked, lastSuccess: status.value.lastSuccess, message: 'Session expirée ou accès retiré');
        return;
      }
      _blocked = false;
    }
    if (_running) return; // une seule synchronisation à la fois
    _running = true;
    final previousSuccess = status.value.lastSuccess;
    status.value = SyncStatus(SyncPhase.syncing, lastSuccess: previousSuccess);
    steps.value = [for (final l in _labels) SyncStep(l, SyncStepState.waiting)];
    var current = 0;
    try {
      _step(0, SyncStepState.doing);
      _pushTotal = Sqflite.firstIntValue(await db.raw.rawQuery("SELECT count(*) FROM outbox WHERE status IN ('pending','pending_validation')")) ?? 0;
      _pushed = 0;
      await _push();
      _step(0, SyncStepState.done, _pushTotal == 0 ? 'Rien à envoyer' : '$_pushTotal envoyée(s)');
      current = 1; _step(1, SyncStepState.doing);
      await _pushPhotos();
      _step(1, SyncStepState.done);
      // Règle : on ne télécharge que s'il n'y a plus rien à soumettre.
      final left = await _toSubmit();
      if (left > 0) {
        for (var i = 2; i < 4; i++) _step(i, SyncStepState.skipped, 'Suspendu');
        status.value = SyncStatus(SyncPhase.error, lastSuccess: previousSuccess, message: '$left opération(s) restent à envoyer : le téléchargement des données du serveur est suspendu tant que tout n\'est pas envoyé.');
        return;
      }
      // Tâches d'abord : légères, elles sont disponibles hors connexion même si le téléchargement des producteurs et parcelles (long) est interrompu.
      Object? failure;
      current = 2; _step(2, SyncStepState.doing);
      try { await _pullTasks(); _step(2, SyncStepState.done); } catch (e) { failure = e; _step(2, SyncStepState.failed); }
      current = 3; _step(3, SyncStepState.doing);
      await _pull();
      _step(3, SyncStepState.done, '$_received élément(s) reçus');
      if (failure != null && failure is ApiException && (failure.status == 401 || failure.status == 403)) throw failure;
      status.value = SyncStatus(SyncPhase.idle, lastSuccess: DateTime.now());
    } on NetworkException catch (e) {
      _step(current, SyncStepState.failed, 'Pas de réseau');
      status.value = SyncStatus(SyncPhase.offline, lastSuccess: previousSuccess, message: e.message);
    } on ApiException catch (e) {
      _step(current, SyncStepState.failed, e.message);
      final blocked = e.status == 401 || e.status == 403;
      if (blocked) _blocked = true; // pas de déconnexion forcée : le menu reste disponible
      status.value = SyncStatus(blocked ? SyncPhase.blocked : SyncPhase.error, lastSuccess: previousSuccess, message: e.message);
    } catch (e) {
      _step(current, SyncStepState.failed);
      status.value = SyncStatus(SyncPhase.error, lastSuccess: previousSuccess, message: 'Erreur inattendue pendant la synchronisation. Réessayez ; vos saisies sont conservées.');
    } finally {
      _running = false;
    }
  }

  // ---------------- Envoi ----------------

  int _pushTotal = 0, _pushed = 0, _received = 0;

  Future<void> _push() async {
    var lastSeq = 0;
    while (true) {
      final rows = await db.raw.query('outbox',
          where: "status IN ('pending','pending_validation') AND seq > ?",
          whereArgs: [lastSeq], orderBy: 'seq', limit: Config.batchSize);
      if (rows.isEmpty) return;
      lastSeq = rows.last['seq'] as int;
      _pushed += rows.length;
      _step(0, SyncStepState.doing, '$_pushed / $_pushTotal');

      final res = await api.post('/sync/batch', {
        'operations': [
          for (final r in rows)
            {'idempotency_key': r['idempotency_key'], 'type': r['op_type'], 'payload': jsonDecode(r['payload'] as String)},
        ],
      }) as Map<String, dynamic>;

      final byKey = {for (final r in rows) r['idempotency_key'] as String: r};
      for (final item in (res['results'] as List)) {
        final key = item['idempotency_key'] as String;
        final op = byKey[key];
        if (op == null) continue;
        final opStatus = item['status'] as String;
        if (item['retry'] == true || opStatus == 'received') {
          // Erreur temporaire du serveur : on garde l'opération en file.
          await db.raw.rawUpdate('UPDATE outbox SET attempts = attempts + 1, updated_at = ? WHERE idempotency_key = ?',
              [DateTime.now().toIso8601String(), key]);
          continue;
        }
        await db.raw.transaction((txn) => _applyOperationResult(txn, key, op['op_type'] as String, op['entity_id'] as String?, opStatus, item['error'] as String?));
      }
    }
  }

  /// Envoi des photos en attente, une à une, une fois leur déclaration créée sur le serveur.
  /// Réseau coupé : on s'arrête et on reprendra ; refus définitif du serveur : la photo est mise de côté avec son motif.
  Future<void> _pushPhotos() async {
    final rows = await db.raw.rawQuery(
        "SELECT u.*, d.local_state AS decl_state FROM pending_uploads u LEFT JOIN declarations d ON d.id = u.declaration_id AND u.subject_type = 'declaration' WHERE u.status = 'pending' ORDER BY u.created_at");
    for (final r in rows) {
      final type = r['subject_type'] as String;
      if (!canUploadPhotoFor(type, r['decl_state'] as String?)) continue;
      final file = File(r['file_path'] as String);
      if (!await file.exists()) {
        await db.raw.update('pending_uploads', {'status': 'error', 'error': 'Fichier introuvable sur l\'appareil'}, where: 'client_key = ?', whereArgs: [r['client_key']]);
        continue;
      }
      try {
        await api.upload('/documents', filePath: file.path, filename: 'photo.jpg', fields: {
          'subject_type': type, 'subject_id': r['declaration_id'] as String, 'kind': r['kind'] as String, 'client_key': r['client_key'] as String,
        });
        await db.raw.delete('pending_uploads', where: 'client_key = ?', whereArgs: [r['client_key']]);
        await file.delete().catchError((_) => file);
      } on ApiException catch (e) {
        if (e.status == 401 || e.status >= 500) rethrow; // session expirée ou panne du serveur : on réessaiera
        await db.raw.update('pending_uploads', {'status': 'error', 'error': e.message, 'attempts': (r['attempts'] as int) + 1}, where: 'client_key = ?', whereArgs: [r['client_key']]);
      }
    }
  }

  static Future<void> _applyOperationResult(
      Transaction txn, String key, String opType, String? entityId, String opStatus, String? error) async {
    await txn.rawUpdate(
        'UPDATE outbox SET status = ?, error = ?, attempts = attempts + 1, updated_at = ? WHERE idempotency_key = ?',
        [opStatus, error, DateTime.now().toIso8601String(), key]);
    final ls = localStateAfterOperation(opType: opType, opStatus: opStatus);
    if (ls != null && entityId != null) {
      await txn.update('declarations', {'local_state': ls, 'local_error': ls == 'error' || ls == 'pending_validation' ? error : null},
          where: 'id = ?', whereArgs: [entityId]);
    }
  }

  // ---------------- Réception ----------------

  /// Tâches de l'utilisateur : copiées du serveur à chaque synchronisation pour rester lisibles hors connexion (les changements d'état se font en ligne).
  Future<void> _pullTasks() async {
    try {
      final r = await api.get('/tasks');
      await _keepLocalChanges('tasks_cache', 'id', r as List<dynamic>, {'task.start': 'in_progress', 'task.submit': 'submitted'}, 'status');
    } on ApiException catch (e) {
      if (e.status == 401) rethrow; // droit « tâches » absent (403) ou autre : sans effet sur le reste
    }
    try {
      final res = await api.get('/producer-assignments', query: {'mine': '1', 'compact': '1'});
      List<dynamic> a;
      if (res is Map) {
        // Format léger : les questions sont rattachées ici à chaque élément (une seule copie par questionnaire côté serveur).
        final qs = Map<String, dynamic>.from((res['questionnaires'] ?? {}) as Map);
        a = (res['assignments'] as List).map((r) { final m = Map<String, dynamic>.from(r as Map); if (m['questionnaire_id'] != null) m['questions'] = qs[m['questionnaire_id']]; return m; }).toList();
      } else { a = res as List<dynamic>; }
      await _keepLocalChanges('assignments_cache', 'target_id', a, {'producer_assignment.done': 'done', 'questionnaire.answer': 'done'}, 'status');
    } on ApiException catch (e) {
      if (e.status == 401) rethrow;
    }
  }

  /// Copie du serveur, en gardant l'effet des actions faites hors connexion et pas encore envoyées (elles ne disparaissent pas de l'écran).
  Future<void> _keepLocalChanges(String kvKey, String idField, List<dynamic> rows, Map<String, String> opToValue, String field) async {
    final ops = await db.raw.query('outbox', where: "status IN ('pending','pending_validation')");
    for (final o in ops) {
      final v = opToValue[o['op_type']];
      if (v == null) continue;
      Map<String, dynamic> p = {};
      try { p = jsonDecode(o['payload'] as String) as Map<String, dynamic>; } catch (_) { continue; }
      final id = p['id'];
      for (final r in rows) { if (r is Map && r[idField] == id) r[field] = v; }
    }
    await db.setKv(kvKey, jsonEncode(rows));
  }

  Future<void> _pull() async {
    _received = 0;
    var cursor = await db.getKv('cursor');
    while (true) {
      final j = await api.get('/sync/changes', query: {if (cursor != null) 'cursor': cursor, 'limit': '500'}) as Map<String, dynamic>;
      final perms = (j['permissions'] as List).cast<String>();
      if (!canSync(perms)) throw ApiException(403, 'Synchronisation non autorisée pour ce compte');
      await db.raw.transaction((txn) => _apply(txn, j, perms));
      _received += ((j['changes'] ?? {}) as Map).values.fold<int>(0, (n, v) => n + (v is List ? v.length : 0));
      _step(3, SyncStepState.doing, '$_received élément(s) reçus');
      cursor = j['next_cursor'] as String;
      await db.setKv('cursor', cursor); // le curseur n'avance qu'après l'application des changements
      if (j['has_more'] != true) break;
    }
  }

  static Future<void> _apply(Transaction txn, Map<String, dynamic> j, List<String> perms) async {
    await txn.insert('kv', {'k': 'permissions', 'v': jsonEncode(perms)}, conflictAlgorithm: ConflictAlgorithm.replace);
    await txn.insert('kv', {'k': 'my_collector_id', 'v': (j['my_collector_id'] ?? '') as String}, conflictAlgorithm: ConflictAlgorithm.replace);
    await txn.insert('kv', {'k': 'me_name', 'v': (j['me_name'] ?? '') as String}, conflictAlgorithm: ConflictAlgorithm.replace);
    await txn.insert('kv', {'k': 'org_name', 'v': (j['organization_name'] ?? '') as String}, conflictAlgorithm: ConflictAlgorithm.replace);
    final ch = j['changes'] as Map<String, dynamic>;

    Future<void> upsert(String table, List<dynamic> rows, Map<String, Object?> Function(Map<String, dynamic>) map) async {
      for (final r in rows) {
        await txn.insert(table, map(r as Map<String, dynamic>), conflictAlgorithm: ConflictAlgorithm.replace);
      }
    }

    await upsert('value_chains', ch['value_chains'], (r) => {'id': r['id'], 'code': r['code'], 'name': r['name'], 'default_unit': r['default_unit'], 'status': r['status']});
    await upsert('campaigns', ch['campaigns'], (r) => {'id': r['id'], 'value_chain_id': r['value_chain_id'], 'code': r['code'], 'name': r['name'], 'starts_on': r['starts_on'], 'ends_on': r['ends_on'], 'status': r['status']});
    await upsert('unit_conversions', ch['unit_conversions'], (r) => {'id': r['id'], 'value_chain_id': r['value_chain_id'], 'from_unit': r['from_unit'], 'to_unit': r['to_unit'], 'factor': r['factor'].toString()});
    await upsert('price_versions', ch['price_versions'], (r) => {'id': r['id'], 'schedule_id': r['schedule_id'], 'value_chain_id': r['value_chain_id'], 'campaign_id': r['campaign_id'], 'unit': r['unit'], 'currency': r['currency'], 'version_no': r['version_no'], 'unit_price': r['unit_price'].toString(), 'valid_from': r['valid_from'], 'valid_to': r['valid_to']});
    await upsert('my_assignments', ch['my_assignments'], (r) => {'id': r['id'], 'collector_id': r['collector_id'], 'value_chain_id': r['value_chain_id'], 'zone': r['zone']});

    if (perms.contains('producers:read')) {
      await upsert('producers', ch['producers'], (r) => {'id': r['id'], 'internal_code': r['internal_code'], 'last_name': r['last_name'], 'first_names': r['first_names'], 'phone': r['phone'], 'section': r['section'], 'village': r['village'], 'status': r['status'], 'value_chain_ids': jsonEncode(r['value_chain_ids'])});
    } else {
      // Permission retirée : on supprime les données qui ne sont plus autorisées.
      await txn.delete('producers');
    }

    // Parcelles : on ne remplace pas un tracé dont la modification attend encore son envoi.
    for (final r in ((ch['parcels'] as List?) ?? const [])) {
      final c = r as Map<String, dynamic>;
      final held = await txn.rawQuery("SELECT 1 FROM outbox WHERE entity_id = ? AND op_type = 'parcel.update' AND status IN ('pending','pending_validation') LIMIT 1", [c['id']]);
      if (held.isNotEmpty) continue;
      await txn.insert('parcels', {
        'id': c['id'], 'code': c['code'], 'producer_id': c['producer_id'], 'value_chain_id': c['value_chain_id'], 'declared_area_ha': c['declared_area_ha']?.toString(),
        'geometry_area_ha': c['geometry_area_ha']?.toString(), 'geometry': c['geometry'] == null ? null : jsonEncode(c['geometry']), 'verification_status': c['verification_status'], 'status': c['status'],
      }, conflictAlgorithm: ConflictAlgorithm.replace);
    }

    for (final r in (ch['declarations'] as List)) {
      final d = r as Map<String, dynamic>;
      final server = <String, Object?>{
        'producer_id': d['producer_id'], 'value_chain_id': d['value_chain_id'], 'campaign_id': d['campaign_id'], 'operation_date': (d['operation_date'] as String).substring(0, 10),
        'bags': d['bags'], 'quantity': d['quantity'].toString(), 'unit': d['unit'], 'unit_price': d['unit_price']?.toString(), 'currency': d['currency'],
        'amount': d['amount']?.toString(), 'status': d['status'], 'status_reason': d['status_reason'],
        'purchase_receipt_no': d['purchase_receipt_no'], 'receipt_conflict': (d['receipt_conflict_with'] != null && d['receipt_override_by'] == null) ? 1 : 0,
      };
      final existing = await txn.query('declarations', columns: ['local_state'], where: 'id = ?', whereArgs: [d['id']]);
      if (existing.isEmpty) {
        await txn.insert('declarations', {'id': d['id'], ...server, 'local_state': 'synced', 'created_at': DateTime.now().toIso8601String()});
      } else {
        final unresolved = await txn.rawQuery("SELECT 1 FROM outbox WHERE entity_id = ? AND status IN ('pending','pending_validation') LIMIT 1", [d['id']]);
        final keep = unresolved.isNotEmpty || existing.first['local_state'] == 'error';
        await txn.update('declarations', {...server, if (!keep) 'local_state': 'synced', if (!keep) 'local_error': null}, where: 'id = ?', whereArgs: [d['id']]);
      }
    }

    // Résultats que le serveur a déjà enregistrés (utile si la réponse d'un envoi précédent s'est perdue).
    for (final r in (ch['operation_results'] as List)) {
      final key = r['idempotency_key'] as String;
      final st = r['status'] as String;
      if (st == 'received') continue;
      final local = await txn.query('outbox', where: 'idempotency_key = ?', whereArgs: [key]);
      if (local.isEmpty) continue;
      final cur = local.first['status'] as String;
      if (isRetryable(cur) && cur != st) {
        await _applyOperationResult(txn, key, local.first['op_type'] as String, local.first['entity_id'] as String?, st, r['error'] as String?);
      }
    }
  }
}
