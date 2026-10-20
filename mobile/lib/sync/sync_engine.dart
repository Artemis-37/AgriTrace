import 'dart:convert';

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
  final ValueNotifier<SyncStatus> status = ValueNotifier(const SyncStatus(SyncPhase.idle));

  SyncEngine(this.db, this.api);

  Future<void> run() async {
    if (_running) return; // une seule synchronisation à la fois
    _running = true;
    final previousSuccess = status.value.lastSuccess;
    status.value = SyncStatus(SyncPhase.syncing, lastSuccess: previousSuccess);
    try {
      await _push();
      await _pull();
      status.value = SyncStatus(SyncPhase.idle, lastSuccess: DateTime.now());
    } on NetworkException catch (e) {
      status.value = SyncStatus(SyncPhase.offline, lastSuccess: previousSuccess, message: e.message);
    } on ApiException catch (e) {
      final blocked = e.status == 401 || e.status == 403;
      status.value = SyncStatus(blocked ? SyncPhase.blocked : SyncPhase.error, lastSuccess: previousSuccess, message: e.message);
    } catch (e) {
      status.value = SyncStatus(SyncPhase.error, lastSuccess: previousSuccess, message: e.toString());
    } finally {
      _running = false;
    }
  }

  // ---------------- Envoi ----------------

  Future<void> _push() async {
    var lastSeq = 0;
    while (true) {
      final rows = await db.raw.query('outbox',
          where: "status IN ('pending','pending_validation') AND seq > ?",
          whereArgs: [lastSeq], orderBy: 'seq', limit: Config.batchSize);
      if (rows.isEmpty) return;
      lastSeq = rows.last['seq'] as int;

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

  Future<void> _pull() async {
    var cursor = await db.getKv('cursor');
    while (true) {
      final j = await api.get('/sync/changes', query: {if (cursor != null) 'cursor': cursor, 'limit': '500'}) as Map<String, dynamic>;
      final perms = (j['permissions'] as List).cast<String>();
      if (!canSync(perms)) throw ApiException(403, 'Synchronisation non autorisée pour ce compte');
      await db.raw.transaction((txn) => _apply(txn, j, perms));
      cursor = j['next_cursor'] as String;
      await db.setKv('cursor', cursor); // le curseur n'avance qu'après l'application des changements
      if (j['has_more'] != true) break;
    }
  }

  static Future<void> _apply(Transaction txn, Map<String, dynamic> j, List<String> perms) async {
    await txn.insert('kv', {'k': 'permissions', 'v': jsonEncode(perms)}, conflictAlgorithm: ConflictAlgorithm.replace);
    await txn.insert('kv', {'k': 'my_collector_id', 'v': (j['my_collector_id'] ?? '') as String}, conflictAlgorithm: ConflictAlgorithm.replace);
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

    for (final r in (ch['declarations'] as List)) {
      final d = r as Map<String, dynamic>;
      final server = <String, Object?>{
        'producer_id': d['producer_id'], 'value_chain_id': d['value_chain_id'], 'campaign_id': d['campaign_id'], 'operation_date': (d['operation_date'] as String).substring(0, 10),
        'bags': d['bags'], 'quantity': d['quantity'].toString(), 'unit': d['unit'], 'unit_price': d['unit_price']?.toString(), 'currency': d['currency'],
        'amount': d['amount']?.toString(), 'status': d['status'], 'status_reason': d['status_reason'],
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
