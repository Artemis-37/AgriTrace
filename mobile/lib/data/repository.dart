import 'dart:convert';

import 'dart:io';

import 'package:decimal/decimal.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'app_database.dart';

/// Accès aux données locales et création d'opérations hors connexion.
class Repository {
  final AppDatabase db;
  Repository(this.db);
  static const _uuid = Uuid();

  Future<List<String>> permissions() async {
    final v = await db.getKv('permissions');
    return v == null ? <String>[] : (jsonDecode(v) as List).cast<String>();
  }

  Future<String?> myCollectorId() async {
    final v = await db.getKv('my_collector_id');
    return (v == null || v.isEmpty) ? null : v;
  }

  Future<List<Map<String, Object?>>> searchProducers(String q) {
    final like = '%${q.trim().toLowerCase()}%';
    return db.raw.query('producers',
        where: "status = 'active' AND (lower(last_name) LIKE ? OR lower(first_names) LIKE ? OR lower(internal_code) LIKE ? OR coalesce(phone,'') LIKE ?)",
        whereArgs: [like, like, like, like], orderBy: 'last_name, first_names', limit: 50);
  }

  /// Filières que ce collecteur peut déclarer pour ce producteur (affectation du collecteur ∩ filières du producteur).
  Future<List<Map<String, Object?>>> chainsFor(String producerId) async {
    final p = await db.raw.query('producers', where: 'id = ?', whereArgs: [producerId]);
    if (p.isEmpty) return [];
    final producerChains = (jsonDecode((p.first['value_chain_ids'] as String?) ?? '[]') as List).cast<String>();
    final assigns = await db.raw.query('my_assignments');
    final allChains = assigns.any((a) => a['value_chain_id'] == null);
    final assigned = assigns.map((a) => a['value_chain_id']).whereType<String>().toSet();
    final chains = await db.raw.query('value_chains', where: "status = 'active'");
    return chains.where((c) {
      final id = c['id'] as String;
      final okProducer = producerChains.isEmpty || producerChains.contains(id);
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
  Future<void> queueConvoy({required String convoyNo, required String driverName, required String truckNo, int? declaredBags, String? declaredKg, List<String> declarationIds = const []}) async {
    final key = 'convoy-${_uuid.v4()}';
    final payload = {
      'idempotency_key': key, 'convoy_no': convoyNo.trim(), 'driver_name': driverName.trim(), 'truck_no': truckNo.trim(),
      if (declaredBags != null) 'declared_bags': declaredBags, if (declaredKg != null && declaredKg.isNotEmpty) 'declared_kg': declaredKg,
      if (declarationIds.isNotEmpty) 'declaration_ids': declarationIds,
    };
    await db.raw.insert('outbox', {'idempotency_key': key, 'op_type': 'convoy.create', 'payload': jsonEncode(payload), 'entity_id': key, 'created_at': DateTime.now().toIso8601String()});
  }

  /// Achats que le collecteur peut charger dans un convoi : envoyés (ou en attente d'envoi) et pas déjà chargés dans un convoi de cet appareil.
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
      await txn.delete('kv', where: "k IN ('cursor','permissions','my_collector_id')");
      await txn.insert('kv', {'k': 'org_id', 'v': orgId}, conflictAlgorithm: ConflictAlgorithm.replace);
    });
    return true;
  }

  /// Accès révoqué par le serveur (compte suspendu) : on efface tout ce qui vient du serveur (producteurs, parcelles, prix,
  /// déclarations déjà envoyées, droits). Seules les saisies jamais envoyées restent, dans la base chiffrée, pour ne pas
  /// perdre le travail du collecteur : elles partiront si le compte est réactivé.
  Future<void> purgeAfterRevocation() async {
    await db.raw.transaction((txn) async {
      for (final t in ['value_chains', 'campaigns', 'unit_conversions', 'price_versions', 'producers', 'my_assignments', 'parcels']) {
        await txn.delete(t);
      }
      await txn.delete('declarations', where: "local_state NOT IN ('local_only','pending','pending_validation','error')");
      await txn.delete('outbox', where: "status NOT IN ('pending','pending_validation')");
      await txn.delete('pending_uploads', where: "status != 'pending'");
      await txn.delete('kv', where: "k IN ('cursor','permissions','my_collector_id')");
      await txn.insert('kv', {'k': 'revoked', 'v': '1'}, conflictAlgorithm: ConflictAlgorithm.replace);
    });
  }
}
