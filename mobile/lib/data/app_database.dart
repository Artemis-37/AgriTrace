import 'package:path/path.dart' as p;
import 'package:sqflite_sqlcipher/sqflite.dart';

/// Base locale chiffrée (SQLCipher). Le schéma est versionné : chaque version a sa migration,
/// pour mettre à jour l'application sans perdre les opérations en attente.
class AppDatabase {
  static const schemaVersion = 1;
  final Database raw;
  AppDatabase._(this.raw);

  static Future<AppDatabase> open(String key) async {
    final dir = await getDatabasesPath();
    final db = await openDatabase(
      p.join(dir, 'agritrace.db'),
      password: key,
      version: schemaVersion,
      onCreate: (d, v) async {
        for (var i = 1; i <= v; i++) {
          await _migrations[i]!(d);
        }
      },
      onUpgrade: (d, from, to) async {
        for (var i = from + 1; i <= to; i++) {
          await _migrations[i]!(d);
        }
      },
    );
    return AppDatabase._(db);
  }

  static final Map<int, Future<void> Function(Database)> _migrations = {
    1: (d) async {
      await d.execute('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)');
      await d.execute('CREATE TABLE value_chains (id TEXT PRIMARY KEY, code TEXT, name TEXT, default_unit TEXT, status TEXT)');
      await d.execute('CREATE TABLE campaigns (id TEXT PRIMARY KEY, value_chain_id TEXT, code TEXT, name TEXT, starts_on TEXT, ends_on TEXT, status TEXT)');
      await d.execute('CREATE TABLE unit_conversions (id TEXT PRIMARY KEY, value_chain_id TEXT, from_unit TEXT, to_unit TEXT, factor TEXT)');
      await d.execute('CREATE TABLE price_versions (id TEXT PRIMARY KEY, schedule_id TEXT, value_chain_id TEXT, campaign_id TEXT, unit TEXT, currency TEXT, version_no INTEGER, unit_price TEXT, valid_from TEXT, valid_to TEXT)');
      await d.execute('CREATE TABLE producers (id TEXT PRIMARY KEY, internal_code TEXT, last_name TEXT, first_names TEXT, phone TEXT, section TEXT, village TEXT, status TEXT, value_chain_ids TEXT)');
      await d.execute('CREATE INDEX idx_producers_name ON producers(last_name, first_names)');
      await d.execute('CREATE TABLE my_assignments (id TEXT PRIMARY KEY, collector_id TEXT, value_chain_id TEXT, zone TEXT)');
      // Déclarations : copie locale. local_state = état de synchronisation côté appareil ;
      // status = état métier tel que connu du serveur (vide tant que rien n'est confirmé).
      await d.execute('''CREATE TABLE declarations (
        id TEXT PRIMARY KEY, producer_id TEXT, value_chain_id TEXT, campaign_id TEXT, operation_date TEXT,
        bags INTEGER, quantity TEXT, unit TEXT, notes TEXT, unit_price TEXT, currency TEXT, amount TEXT,
        status TEXT, status_reason TEXT, local_state TEXT NOT NULL DEFAULT 'local_only', local_error TEXT,
        created_at TEXT NOT NULL)''');
      // File d'attente : conservée sur disque, reprend après fermeture ou redémarrage.
      await d.execute('''CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE, op_type TEXT NOT NULL,
        payload TEXT NOT NULL, entity_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
        error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT)''');
    },
  };

  Future<String?> getKv(String k) async {
    final r = await raw.query('kv', where: 'k = ?', whereArgs: [k]);
    return r.isEmpty ? null : r.first['v'] as String?;
  }

  Future<void> setKv(String k, String v) => raw.insert('kv', {'k': k, 'v': v}, conflictAlgorithm: ConflictAlgorithm.replace);

  Future<int> pendingCount() async {
    final r = await raw.rawQuery("SELECT count(*) c FROM outbox WHERE status IN ('pending','pending_validation')");
    return (r.first['c'] as int?) ?? 0;
  }

  Future<int> problemCount() async {
    final r = await raw.rawQuery("SELECT count(*) c FROM outbox WHERE status IN ('to_correct','rejected','conflict')");
    return (r.first['c'] as int?) ?? 0;
  }
}
