import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';

import '../geo/tiles.dart';
import 'api_client.dart';

/// Ce que l'on sait d'un paquet de fond de carte (celui du serveur ou celui déjà sur le téléphone).
class MapPackInfo {
  final String id, name, sha256;
  final int sizeBytes;
  const MapPackInfo({required this.id, required this.name, required this.sha256, required this.sizeBytes});
  factory MapPackInfo.fromJson(Map<String, dynamic> j) =>
      MapPackInfo(id: j['id'] as String, name: j['name'] as String, sha256: j['sha256'] as String, sizeBytes: (j['size_bytes'] as num).toInt());
  Map<String, Object?> toJson() => {'id': id, 'name': name, 'sha256': sha256, 'size_bytes': sizeBytes};
}

/// Le paquet de tuiles (MBTiles raster) est téléchargé une fois depuis le serveur de la coopérative, vérifié par son empreinte SHA-256,
/// puis lu sur le téléphone sans aucune connexion. Reprise automatique d'un téléchargement interrompu.
class MapPackStore {
  final ApiClient api;
  MapPackStore(this.api);

  Database? _db;
  MapPackInfo? local;
  int minZoom = 0, maxZoom = 22;
  /// Étendue couverte (ouest, sud, est, nord) si le paquet la déclare.
  ({double w, double s, double e, double n})? bounds;

  Future<Directory> _dir() async {
    final d = Directory(p.join((await getApplicationSupportDirectory()).path, 'map'));
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  bool get ready => _db != null && local != null;

  /// Avancement du téléchargement en cours (0 à 1), null si aucun. Écouté par l'écran « Fond de carte ».
  final ValueNotifier<double?> progress = ValueNotifier<double?>(null);
  String? lastError;
  bool _busy = false;
  bool get busy => _busy;

  /// Vérifie le serveur puis télécharge si le paquet a changé. Ne lève jamais : l'erreur est rangée dans [lastError] (réseau coupé = on réessaiera).
  /// Retourne true si un nouveau paquet vient d'être installé.
  Future<bool> sync({MapPackInfo? known}) async {
    if (_busy) return false;
    _busy = true; lastError = null; progress.value = null;
    try {
      final r = known ?? await remote();
      if (!needsDownload(r)) return false;
      progress.value = 0;
      await download(r!, onProgress: (f) => progress.value = f.clamp(0, 1).toDouble());
      return true;
    } on NetworkException catch (e) {
      lastError = 'Connexion interrompue : le téléchargement reprendra là où il s\'est arrêté (${e.message}).';
    } catch (e) {
      lastError = e is ApiException ? e.message : e is NetworkException ? e.message : 'Téléchargement interrompu. Réessayez avec une bonne connexion.';
    } finally {
      _busy = false; progress.value = null;
    }
    return false;
  }

  /// Ouvre le paquet déjà présent sur le téléphone, s'il y en a un.
  Future<void> load() async {
    final dir = await _dir();
    final meta = File(p.join(dir.path, 'pack.json')), data = File(p.join(dir.path, 'pack.mbtiles'));
    if (!await meta.exists() || !await data.exists()) return;
    try {
      final info = MapPackInfo.fromJson(jsonDecode(await meta.readAsString()) as Map<String, dynamic>);
      await _open(data.path);
      local = info;
    } catch (_) {
      await _close();
      local = null;
    }
  }

  Future<void> _close() async { await _db?.close(); _db = null; }

  Future<void> _open(String path) async {
    await _close();
    // Paquet public (non chiffré) : ouvert en lecture seule sans mot de passe.
    final db = await openDatabase(path, readOnly: true);
    try {
      final rows = await db.rawQuery('SELECT name, value FROM metadata');
      final m = {for (final r in rows) '${r['name']}': '${r['value']}'};
      minZoom = int.tryParse(m['minzoom'] ?? '') ?? 0;
      maxZoom = int.tryParse(m['maxzoom'] ?? '') ?? 22;
      final b = (m['bounds'] ?? '').split(',').map((e) => double.tryParse(e.trim())).toList();
      bounds = b.length == 4 && b.every((e) => e != null) ? (w: b[0]!, s: b[1]!, e: b[2]!, n: b[3]!) : null;
      await db.rawQuery('SELECT 1 FROM tiles LIMIT 1'); // vérifie que la table existe
    } catch (_) {
      await db.close();
      rethrow;
    }
    _db = db;
  }

  /// Fond de carte proposé par le serveur (null : aucun ou serveur injoignable).
  Future<MapPackInfo?> remote() async {
    try {
      final r = await api.get('/map-packs/current') as Map<String, dynamic>;
      return r['available'] == true ? MapPackInfo.fromJson(r) : null;
    } catch (_) {
      return null;
    }
  }

  bool needsDownload(MapPackInfo? remote) => remote != null && (local == null || local!.sha256 != remote.sha256);

  /// Télécharge, vérifie l'empreinte puis installe le paquet. Lève une exception si l'empreinte ne correspond pas (le fichier est alors supprimé).
  Future<void> download(MapPackInfo info, {void Function(double fraction)? onProgress}) async {
    final dir = await _dir();
    final part = File(p.join(dir.path, 'download.part'));
    // Une reprise n'a de sens que pour le même paquet.
    final tag = File(p.join(dir.path, 'download.id'));
    if (!await tag.exists() || await tag.readAsString() != info.sha256) {
      if (await part.exists()) await part.delete();
      await tag.writeAsString(info.sha256);
    }
    await api.download('/map-packs/${info.id}/file', part, onBytes: (n) => onProgress?.call(n / info.sizeBytes));
    final size = await part.length();
    final digest = await sha256.bind(part.openRead()).first;
    if (size != info.sizeBytes || digest.toString() != info.sha256) {
      await part.delete();
      throw StateError('Le fond de carte reçu est incomplet ou altéré : réessayez.');
    }
    final data = File(p.join(dir.path, 'pack.mbtiles'));
    await _close();
    if (await data.exists()) await data.delete();
    await part.rename(data.path);
    await tag.delete();
    await _open(data.path);
    local = info;
    await File(p.join(dir.path, 'pack.json')).writeAsString(jsonEncode(info.toJson()));
  }

  /// Image (PNG ou JPEG) de la tuile z/x/y, ou null si le paquet ne la contient pas.
  Future<Uint8List?> tile(int z, int x, int y) async {
    final db = _db;
    if (db == null || z < minZoom || z > maxZoom) return null;
    final rows = await db.rawQuery('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?', [z, x, tmsRow(y, z)]);
    if (rows.isEmpty) return null;
    final d = rows.first['tile_data'];
    return d is Uint8List ? d : null;
  }
}
