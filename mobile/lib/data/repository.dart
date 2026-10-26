import 'dart:convert';

import 'dart:io';

import 'package:decimal/decimal.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'app_database.dart';

/// Accès aux données locales et création d'opérations hors connexion.
/// Produits proposés à la déclaration d'un convoi : les produits actifs seulement.
List<Map<String, Object?>> activeProducts(List<dynamic> rows) => [for (final r in rows) if ((r as Map)['active'] != false) Map<String, Object?>.from(r)];

class Repository {
  final AppDatabase db;
  Repository(this.db);
  static const _uuid = Uuid();

  Future<List<String>> permissions() async {
    final v = await db.getKv('permissions');
    return v == null ? <String>[] : (jsonDecode(v) as List).cast<String>();
  }

  /// Nom de l'utilisateur et de la coopérative, mémorisés à la synchronisation (accueil).
  Future<({String name, String org, String zone})> identity() async {
    final zone = await db.raw.query('my_assignments', columns: ['zone'], where: "coalesce(zone,'') != ''", limit: 1);
    return (name: (await db.getKv('me_name')) ?? '', org: (await db.getKv('org_name')) ?? '', zone: zone.isEmpty ? '' : '${zone.first['zone']}');
  }

  Future<String?> myCollectorId() async {
    final v = await db.getKv('my_collector_id');
    return (v == null || v.isEmpty) ? null : v;
  }

  Future<List<Map<String, Object?>>> searchProducers(String q, {String? section, int limit = 200}) {
    final like = '%${q.trim().toLowerCase()}%';
    return db.raw.query('producers',
        where: "status = 'active' AND (lower(last_name) LIKE ? OR lower(first_names) LIKE ? OR lower(internal_code) LIKE ? OR coalesce(phone,'') LIKE ? OR lower(coalesce(village,'')) LIKE ?)"
            "${section == null ? '' : ' AND section = ?'}",
        whereArgs: [like, like, like, like, like, if (section != null) section], orderBy: 'last_name, first_names', limit: limit);
  }

  /// Sections présentes parmi les producteurs de l'appareil, avec leur effectif (filtre de la recherche, utilisable hors connexion).
  Future<List<Map<String, Object?>>> producerSections() => db.raw.rawQuery(
      "SELECT section, count(*) AS n FROM producers WHERE status = 'active' AND section IS NOT NULL AND trim(section) <> '' GROUP BY section ORDER BY section");

  /// Produits que ce délégué peut déclarer (affectation du délégué ; tous les produits sont liés à tous les producteurs).
  Future<List<Map<String, Object?>>> chainsFor(String producerId) async {
    final p = await db.raw.query('producers', where: 'id = ?', whereArgs: [producerId]);
    if (p.isEmpty) return [];
    final assigns = await db.raw.query('my_assignments');
    // Sans affectation de collecteur (coach, cartographe…) : toutes les filières du producteur ; sinon seulement celles affectées.
    final allChains = assigns.isEmpty || assigns.any((a) => a['value_chain_id'] == null);
    final assigned = assigns.map((a) => a['value_chain_id']).whereType<String>().toSet();
    final chains = await db.raw.query('value_chains', where: "status = 'active'");
    return chains.where((c) {
      final id = c['id'] as String;
      const okProducer = true; // tout produit de la coopérative est lié à tous les producteurs
      return okProducer && (allChains || assigned.contains(id));
    }).toList();
  }

  Future<List<Map<String, Object?>>> openCampaigns(String chainId) =>
      db.raw.query('campaigns', where: "value_chain_id = ? AND status = 'open'", whereArgs: [chainId], orderBy: 'starts_on DESC');

  Future<List<String>> unitsFor(String chainId) async {
    final c = await db.raw.query('unit_conversions', where: 'value_chain_id = ?', whereArgs: [chainId]);
    final v = await db.raw.query('value_chains', where: 'id = ?', whereArgs: [chainId]);
    final base = v.isEmpty ? 'kg' : (v.first['default_unit'] as String? ?? 'kg');
    return {base, 'kg', ...c.map((x) => x['from_unit'] as String)}.toList();
  }

  /// Estimation affichée à l'écran : le montant définitif est toujours calculé par le serveur à la soumission.
  /// Arithmétique décimale exacte (jamais de flottants pour de l'argent).
  Future<({String amount, String currency})?> estimate({
    required String chainId, required String campaignId, required String date, required String quantity, required String unit,
  }) async {
    if (!RegExp(r'^\d+(\.\d+)?$').hasMatch(quantity)) return null;
    final prices = await db.raw.query('price_versions',
        where: 'value_chain_id = ? AND campaign_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)',
        whereArgs: [chainId, campaignId, date, date], orderBy: 'valid_from DESC, version_no DESC');
    if (prices.isEmpty) return null;
    final sameUnit = prices.where((p) => p['unit'] == unit).toList();
    final price = sameUnit.isNotEmpty ? sameUnit.first : prices.first;
    var factor = Decimal.one;
    if (price['unit'] != unit) {
      final f = await db.raw.query('unit_conversions',
          where: 'value_chain_id = ? AND from_unit = ? AND to_unit = ?', whereArgs: [chainId, unit, price['unit']]);
      if (f.isEmpty) return null;
      factor = Decimal.parse(f.first['factor'] as String);
    }
    final amount = Decimal.parse(quantity) * factor * Decimal.parse(price['unit_price'] as String);
    return (amount: amount.round(scale: 0).toString(), currency: (price['currency'] as String?) ?? 'XOF');
  }

  /// Enregistre une déclaration sur l'appareil et met en file d'attente sa création puis sa soumission.
  /// Aucune connexion n'est nécessaire ; chaque opération porte sa clé d'idempotence stable.
  Future<String> createDeclaration({
    required String producerId, required String chainId, required String campaignId, required String date,
    required String quantity, required String unit, int? bags, String? notes, String? receiptNo,
  }) async {
    final id = _uuid.v4();
    final createKey = 'decl-${_uuid.v4()}';
    final submitKey = 'submit-${_uuid.v4()}';
    final now = DateTime.now().toIso8601String();
    final payload = {
      'id': id, 'idempotency_key': createKey, 'producer_id': producerId, 'value_chain_id': chainId, 'campaign_id': campaignId,
      'operation_date': date, if (bags != null) 'bags': bags, 'quantity': quantity, 'unit': unit, if (notes != null && notes.isNotEmpty) 'notes': notes,
      if (receiptNo != null && receiptNo.isNotEmpty) 'purchase_receipt_no': receiptNo,
    };
    await db.raw.transaction((txn) async {
      await txn.insert('declarations', {
        'id': id, 'producer_id': producerId, 'value_chain_id': chainId, 'campaign_id': campaignId, 'operation_date': date,
        'bags': bags, 'quantity': quantity, 'unit': unit, 'notes': notes, 'purchase_receipt_no': (receiptNo == null || receiptNo.isEmpty) ? null : receiptNo.trim().toUpperCase(), 'local_state': 'pending', 'created_at': now,
      });
      await txn.insert('outbox', {'idempotency_key': createKey, 'op_type': 'purchase_declaration.create', 'payload': jsonEncode(payload), 'entity_id': id, 'created_at': now});
      await txn.insert('outbox', {'idempotency_key': submitKey, 'op_type': 'purchase_declaration.submit', 'payload': jsonEncode({'id': id}), 'entity_id': id, 'created_at': now});
    });
    return id;
  }

  /// Photo du reçu : copiée dans le stockage de l'application (le cache de l'appareil peut être vidé) et mise en attente d'envoi.
  /// Elle part après la déclaration, avec une clé propre : un renvoi ne crée jamais de doublon.
  Future<void> queueReceiptPhoto({required String declarationId, required String sourcePath}) =>
      queuePhoto(subjectType: 'declaration', subjectId: declarationId, kind: 'Photo du reçu', sourcePath: sourcePath);

  /// Photo d'un objet du serveur (reçu, parcelle) : même mécanisme, même garantie contre les doublons.
  Future<void> queuePhoto({required String subjectType, required String subjectId, required String kind, required String sourcePath}) async {
    final dir = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'pending_photos'));
    await dir.create(recursive: true);
    final key = 'photo-${_uuid.v4()}';
    final dest = p.join(dir.path, '$key${p.extension(sourcePath).isEmpty ? '.jpg' : p.extension(sourcePath)}');
    await File(sourcePath).copy(dest);
    await db.raw.insert('pending_uploads', {'client_key': key, 'subject_type': subjectType, 'declaration_id': subjectId, 'kind': kind, 'file_path': dest, 'created_at': DateTime.now().toIso8601String()});
  }

  Future<int> pendingPhotos() async => Sqflite.firstIntValue(await db.raw.rawQuery("SELECT count(*) FROM pending_uploads WHERE status = 'pending'")) ?? 0;

  /// Convoi vers le magasin central : mis en file d'envoi, envoyé dès que le réseau revient (idempotent).
  Future<void> queueConvoy({String? convoyNo, required String driverName, required String truckNo, int? declaredBags, String? declaredKg, String? productId, List<String> declarationIds = const []}) async {
    final key = 'convoy-${_uuid.v4()}';
    final payload = {
      'idempotency_key': key, if (convoyNo != null && convoyNo.trim().isNotEmpty) 'convoy_no': convoyNo.trim(), 'driver_name': driverName.trim(), 'truck_no': truckNo.trim(),
      if (declaredBags != null) 'declared_bags': declaredBags, if (declaredKg != null && declaredKg.isNotEmpty) 'declared_kg': declaredKg,
      if (productId != null && productId.isNotEmpty) 'product_id': productId,
      if (declarationIds.isNotEmpty) 'declaration_ids': declarationIds,
    };
    await db.raw.insert('outbox', {'idempotency_key': key, 'op_type': 'convoy.create', 'payload': jsonEncode(payload), 'entity_id': key, 'created_at': DateTime.now().toIso8601String()});
  }

  /// Produits actifs (cacao, café…) : lus sur le serveur, gardés en cache pour la saisie hors connexion.
  Future<List<Map<String, Object?>>> products(Future<dynamic> Function() fetch) async {
    List<dynamic>? rows;
    try {
      rows = await fetch() as List<dynamic>;
      await db.setKv('products', jsonEncode(rows));
    } catch (_) {
      final c = await db.getKv('products');
      if (c != null) { try { rows = jsonDecode(c) as List<dynamic>; } catch (_) {/* cache illisible */} }
    }
    return activeProducts(rows ?? const []);
  }

  /// Lecture avec copie locale : renvoie les données du serveur (et les garde), ou à défaut la dernière copie
  /// avec `stale: true`. Renvoie null si le serveur est injoignable et qu'aucune copie n'existe encore.
  Future<({dynamic data, bool stale})?> cachedGet(String key, Future<dynamic> Function() fetch) async {
    try {
      final d = await fetch();
      try { await db.setKv('cache:$key', jsonEncode(d)); } catch (_) {/* copie facultative */}
      return (data: d, stale: false);
    } catch (_) {
      final c = await db.getKv('cache:$key');
      if (c != null) { try { return (data: jsonDecode(c), stale: true); } catch (_) {/* copie illisible */} }
      return null;
    }
  }

  /// Convois créés sur l'appareil et pas encore envoyés : sert à prévoir le prochain numéro automatique hors connexion.
  Future<int> pendingConvoys() async => Sqflite.firstIntValue(await db.raw.rawQuery("SELECT count(*) FROM outbox WHERE op_type = 'convoy.create'")) ?? 0;

  /// Convois créés sur l'appareil, pas encore envoyés ou refusés : affichés en tête de l'historique des convois.
  Future<List<Map<String, Object?>>> localConvoys() async {
    final out = <Map<String, Object?>>[];
    for (final o in await db.raw.query('outbox', where: "op_type = 'convoy.create'", orderBy: 'created_at DESC')) {
      final p = Map<String, Object?>.from(jsonDecode(o['payload'] as String) as Map);
      out.add({...p, 'local_status': o['status'] ?? 'pending', 'created_at': o['created_at']});
    }
    return out;
  }

  /// Achats que le délégué peut charger dans un convoi : envoyés (ou en attente d'envoi) et pas déjà chargés dans un convoi de cet appareil.
  /// [serverAvailableIds] : achats que le serveur déclare libres (null hors connexion) ; un achat déjà parti sur le serveur absent de la liste est écarté.
  Future<List<Map<String, Object?>>> linkableDeclarations({Set<String>? serverAvailableIds}) async {
    final rows = await db.raw.rawQuery('''
      SELECT d.*, p.last_name || ' ' || p.first_names AS producer_name FROM declarations d LEFT JOIN producers p ON p.id = d.producer_id
       WHERE d.local_state IN ('pending','synced') AND coalesce(d.status, '') NOT IN ('rejected','to_correct') ORDER BY d.operation_date DESC, d.created_at DESC LIMIT 300''');
    final used = <String>{};
    for (final o in await db.raw.query('outbox', where: "op_type = 'convoy.create' AND status NOT IN ('rejected','to_correct','conflict')")) {
      final ids = (jsonDecode(o['payload'] as String) as Map)['declaration_ids'];
      if (ids is List) used.addAll(ids.cast<String>());
    }
    return rows.where((r) => !used.contains(r['id']) && (r['local_state'] == 'pending' || serverAvailableIds == null || serverAvailableIds.contains(r['id']))).toList();
  }

  /// Parcelle relevée au GPS : mise en file d'envoi (idempotente), créée côté serveur dès que le réseau revient.
  /// Le serveur recalcule la surface, détecte les doublons et les chevauchements.
  Future<void> queueParcel({required String producerId, required String valueChainId, required String declaredAreaHa, required Map<String, Object> geometry}) async {
    final key = 'parcel-${_uuid.v4()}';
    final payload = {
      'idempotency_key': key, 'producer_id': producerId, 'value_chain_id': valueChainId,
      'declared_area_ha': declaredAreaHa, 'geometry': geometry,
    };
    await db.raw.insert('outbox', {'idempotency_key': key, 'op_type': 'parcel.create', 'payload': jsonEncode(payload), 'entity_id': key, 'created_at': DateTime.now().toIso8601String()});
  }

  /// Nouveau tracé d'une parcelle existante : envoyé à la synchronisation, le serveur recalcule la surface et revérifie les chevauchements.
  /// Le tracé local est remplacé tout de suite ; la prochaine synchronisation le confirme (ou le corrige).
  Future<void> queueParcelUpdate({required String parcelId, required String declaredAreaHa, required Map<String, Object> geometry}) async {
    final key = 'parcel-upd-${_uuid.v4()}';
    final payload = {'id': parcelId, 'declared_area_ha': declaredAreaHa, 'geometry': geometry};
    await db.raw.transaction((txn) async {
      await txn.insert('outbox', {'idempotency_key': key, 'op_type': 'parcel.update', 'payload': jsonEncode(payload), 'entity_id': parcelId, 'created_at': DateTime.now().toIso8601String()});
      await txn.update('parcels', {'geometry': jsonEncode(geometry), 'declared_area_ha': declaredAreaHa, 'verification_status': 'declared'}, where: 'id = ?', whereArgs: [parcelId]);
    });
  }

  /// Parcelles connues de l'appareil, avec le producteur et l'envoi en attente éventuel.
  Future<List<Map<String, Object?>>> parcels() => db.raw.rawQuery('''
    SELECT c.*, p.last_name || ' ' || p.first_names AS producer_name, p.internal_code AS producer_code,
           (SELECT count(*) FROM outbox o WHERE o.entity_id = c.id AND o.op_type = 'parcel.update' AND o.status IN ('pending','pending_validation')) AS pending_updates
      FROM parcels c LEFT JOIN producers p ON p.id = c.producer_id ORDER BY c.code LIMIT 500''');

  /// Nouveau producteur enregistré sur le terrain : disponible tout de suite sur le téléphone (relevé de parcelle, formation),
  /// créé côté serveur à la prochaine connexion avec le même identifiant. Le code officiel est attribué par le serveur.
  Future<String> queueProducer({
    required String lastName, required String firstNames, String? gender, String? birthDate, String? idDocType, String? idDocNumber,
    String? phone, String? region, String? section, String? village, required bool consent,
  }) async {
    final id = _uuid.v4();
    final key = 'producer-${_uuid.v4()}';
    final payload = <String, Object?>{
      'id': id, 'last_name': lastName, 'first_names': firstNames, 'consent': consent,
      if (gender != null) 'gender': gender, if (birthDate != null) 'birth_date': birthDate,
      if (idDocType != null) 'id_doc_type': idDocType, if (idDocNumber != null) 'id_doc_number': idDocNumber,
      if (phone != null) 'phone': phone, if (region != null) 'region': region, if (section != null) 'section': section, if (village != null) 'village': village,
    };
    await db.raw.transaction((txn) async {
      await txn.insert('outbox', {'idempotency_key': key, 'op_type': 'producer.create', 'payload': jsonEncode(payload), 'entity_id': id, 'created_at': DateTime.now().toIso8601String()});
      await txn.insert('producers', {'id': id, 'internal_code': '(en attente)', 'last_name': lastName, 'first_names': firstNames, 'phone': phone, 'section': section, 'village': village, 'status': 'active', 'value_chain_ids': '[]'}, conflictAlgorithm: ConflictAlgorithm.replace);
    });
    return id;
  }

  /// Opération simple conservée sur l'appareil et envoyée à la synchronisation (idempotente).
  Future<void> queueOp(String type, Map<String, Object?> payload, {String? entityId}) async {
    final key = 'op-${_uuid.v4()}';
    await db.raw.insert('outbox', {'idempotency_key': key, 'op_type': type, 'payload': jsonEncode(payload), 'entity_id': entityId ?? key, 'created_at': DateTime.now().toIso8601String()});
  }

  /// Copies des tâches et des éléments ajoutés aux profils, mises à jour à chaque synchronisation.
  Future<List<dynamic>> _cache(String k) async {
    final raw = await db.getKv(k);
    if (raw == null) return [];
    try { return jsonDecode(raw) as List<dynamic>; } catch (_) { return []; }
  }
  Future<List<dynamic>> cachedTasks() => _cache('tasks_cache');
  Future<List<dynamic>> cachedAssignments() => _cache('assignments_cache');
  Future<void> _patch(String k, String idField, Object id, Map<String, Object?> changes) async {
    final rows = await _cache(k);
    for (final r in rows) { if (r is Map && r[idField] == id) r.addAll(changes); }
    await db.setKv(k, jsonEncode(rows));
  }
  Future<void> patchCachedTask(Object id, Map<String, Object?> changes) => _patch('tasks_cache', 'id', id, changes);
  Future<void> patchCachedAssignment(Object targetId, Map<String, Object?> changes) => _patch('assignments_cache', 'target_id', targetId, changes);

  /// Infrastructure sociale, formation ou distribution enregistrée sur le terrain (envoi idempotent). Renvoie l'identifiant du dossier.
  Future<String> queueFieldRecord({required String kind, required String title, double? latitude, double? longitude, required Map<String, Object?> data}) async {
    final id = _uuid.v4();
    final key = 'field-${_uuid.v4()}';
    final payload = {'id': id, 'idempotency_key': key, 'kind': kind, 'title': title, if (latitude != null) 'latitude': latitude, if (longitude != null) 'longitude': longitude, 'data': data};
    await db.raw.insert('outbox', {'idempotency_key': key, 'op_type': 'field_record.create', 'payload': jsonEncode(payload), 'entity_id': id, 'created_at': DateTime.now().toIso8601String()});
    return id;
  }

  /// Éléments conservés sur l'appareil et pas encore confirmés par le serveur (opérations puis photos), du plus récent au plus ancien.
  Future<List<({String label, String detail, String state, String? error})>> pendingItems() async {
    final ops = await db.raw.query('outbox', where: "status IN ('pending','pending_validation','to_correct','rejected','conflict')", orderBy: 'seq DESC', limit: 100);
    final out = <({String label, String detail, String state, String? error})>[];
    for (final o in ops) {
      Map<String, dynamic> p = {};
      try { p = jsonDecode(o['payload'] as String) as Map<String, dynamic>; } catch (_) { /* illisible : libellé générique */ }
      final t = o['op_type'] as String;
      String label, detail = '';
      switch (t) {
        case 'producer.create': label = 'Nouveau producteur'; detail = '${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim().toUpperCase(); break;
        case 'field_record.create':
          label = const {'social_infrastructure': 'Infrastructure sociale', 'training': 'Formation', 'distribution': 'Distribution'}[p['kind']] ?? 'Enregistrement';
          detail = '${p['title'] ?? ''}'; break;
        case 'parcel.create': label = 'Parcelle relevée'; detail = '${p['declared_area_ha'] ?? ''} ha déclarés'; break;
        case 'parcel.update': label = 'Nouveau tracé de parcelle'; break;
        case 'purchase_declaration.create': label = 'Achat'; break;
        case 'convoy.create': label = 'Convoi'; detail = '${p['convoy_no'] ?? ''}'; break;
        case 'task.start': label = 'Mission démarrée'; break;
        case 'task.submit': label = 'Mission soumise'; break;
        case 'task.entry': label = 'Saisie de mission'; detail = '${p['content'] ?? p['kind'] ?? ''}'; break;
        case 'producer_assignment.done': label = 'Élément du profil marqué fait'; break;
        case 'training_result.create': label = 'Résultats de formation'; detail = '${p['village'] ?? ''}'; break;
        default: label = t;
      }
      out.add((label: label, detail: detail, state: o['status'] as String, error: o['error'] as String?));
    }
    final photos = await db.raw.query('pending_uploads', where: "status IN ('pending','error')", orderBy: 'created_at DESC', limit: 50);
    for (final f in photos) {
      out.add((label: 'Photo', detail: '${f['kind'] ?? ''}', state: f['status'] == 'error' ? 'rejected' : 'pending', error: f['error'] as String?));
    }
    return out;
  }

  /// Dossiers de ce type encore conservés sur l'appareil (avant confirmation du serveur).
  Future<List<Map<String, dynamic>>> localFieldRecords(String kind) async {
    final ops = await db.raw.query('outbox', where: "op_type = 'field_record.create' AND status IN ('pending','pending_validation','to_correct','rejected','conflict')", orderBy: 'seq DESC');
    final out = <Map<String, dynamic>>[];
    for (final o in ops) {
      try { final p = jsonDecode(o['payload'] as String) as Map<String, dynamic>; if (p['kind'] == kind) out.add({...p, 'local_status': o['status']}); } catch (_) {}
    }
    return out;
  }

  Future<List<Map<String, Object?>>> declarations() => db.raw.rawQuery('''
    SELECT d.*, p.last_name || ' ' || p.first_names AS producer_name, p.internal_code AS producer_code
      FROM declarations d LEFT JOIN producers p ON p.id = d.producer_id
     ORDER BY d.created_at DESC LIMIT 300''');

  /// Une déclaration refusée ou à corriger peut être abandonnée localement (jamais celle déjà confirmée).
  Future<void> discardFailed(String id) async {
    await db.raw.transaction((txn) async {
      final d = await txn.query('declarations', where: "id = ? AND local_state = 'error'", whereArgs: [id]);
      if (d.isEmpty) return;
      await txn.delete('outbox', where: "entity_id = ? AND status IN ('to_correct','rejected','conflict','pending')", whereArgs: [id]);
      await txn.delete('declarations', where: 'id = ?', whereArgs: [id]);
    });
  }

  /// Changement d'organisation : refusé s'il reste des opérations non envoyées, sinon on repart d'une base propre.
  Future<bool> switchOrganization(String orgId) async {
    final current = await db.getKv('org_id');
    if (current == orgId) return true;
    if (current != null && await db.pendingCount() > 0) return false;
    await db.raw.transaction((txn) async {
      for (final t in ['value_chains', 'campaigns', 'unit_conversions', 'price_versions', 'producers', 'my_assignments', 'declarations', 'outbox', 'parcels', 'pending_uploads']) {
        await txn.delete(t);
      }
      await txn.delete('kv', where: "k IN ('cursor','permissions','my_collector_id','me_name','org_name') OR k LIKE 'cache:%'");
      await txn.insert('kv', {'k': 'org_id', 'v': orgId}, conflictAlgorithm: ConflictAlgorithm.replace);
    });
    return true;
  }

  /// Accès révoqué par le serveur (compte suspendu) : on efface tout ce qui vient du serveur (producteurs, parcelles, prix,
  /// déclarations déjà envoyées, droits). Seules les saisies jamais envoyées restent, dans la base chiffrée, pour ne pas
  /// perdre le travail du délégué : elles partiront si le compte est réactivé.
  Future<void> purgeAfterRevocation() async {
    await db.raw.transaction((txn) async {
      for (final t in ['value_chains', 'campaigns', 'unit_conversions', 'price_versions', 'producers', 'my_assignments', 'parcels']) {
        await txn.delete(t);
      }
      await txn.delete('declarations', where: "local_state NOT IN ('local_only','pending','pending_validation','error')");
      await txn.delete('outbox', where: "status NOT IN ('pending','pending_validation')");
      await txn.delete('pending_uploads', where: "status != 'pending'");
      await txn.delete('kv', where: "k IN ('cursor','permissions','my_collector_id','me_name','org_name') OR k LIKE 'cache:%'");
      await txn.insert('kv', {'k': 'revoked', 'v': '1'}, conflictAlgorithm: ConflictAlgorithm.replace);
    });
  }
}
