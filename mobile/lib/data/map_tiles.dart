import 'dart:async';
import 'dart:collection';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../config.dart';
import 'map_pack.dart';

/// Les fonds de carte proposés dans le levé de parcelle.
enum BaseLayer {
  /// Plan OpenStreetMap : tuiles en ligne, gardées sur l'appareil au fur et à mesure qu'on les consulte (donc revisibles hors ligne).
  plan('Plan', '© les contributeurs d\'OpenStreetMap', 19),
  /// Imagerie satellite : tuiles en ligne ; hors connexion, seules les zones déjà consultées s'affichent.
  satellite('Satellite', 'Imagerie © Esri, Maxar, Earthstar Geographics', 18),
  /// Google Maps (plan) par l'API officielle « Map Tiles » : nécessite la clé GOOGLE_MAPS_KEY fournie à la compilation.
  google('Google Maps', 'Données cartographiques © Google', 21),
  /// Paquet MBTiles déposé par l'administrateur de la coopérative : lu sur le téléphone, sans réseau.
  pack('Coopérative', '', 22);

  final String label, attribution;
  final int maxZoom;
  const BaseLayer(this.label, this.attribution, this.maxZoom);
}

/// Cache disque des tuiles consultées, plafonné en taille : les plus anciennes sont supprimées en premier.
class TileCache {
  final Directory dir;
  final int maxBytes;
  TileCache(this.dir, {this.maxBytes = 150 * 1024 * 1024});
  int _puts = 0;

  File _file(String layer, int z, int x, int y) => File(p.join(dir.path, layer, '$z', '${x}_$y.tile'));

  Future<Uint8List?> get(String layer, int z, int x, int y) async {
    final f = _file(layer, z, x, y);
    try {
      return await f.exists() ? await f.readAsBytes() : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> put(String layer, int z, int x, int y, Uint8List bytes) async {
    try {
      final f = _file(layer, z, x, y);
      await f.parent.create(recursive: true);
      await f.writeAsBytes(bytes, flush: false);
      if (++_puts % 200 == 0) unawaited(prune());
    } catch (_) { /* disque plein ou illisible : on s'en passe, la tuile sera redemandée */ }
  }

  /// Taille totale en octets.
  Future<int> size() async {
    var n = 0;
    if (!await dir.exists()) return 0;
    await for (final e in dir.list(recursive: true, followLinks: false)) {
      if (e is File) n += await e.length();
    }
    return n;
  }

  /// Supprime les tuiles les plus anciennes jusqu'à repasser sous 90 % du plafond.
  Future<void> prune() async {
    if (!await dir.exists()) return;
    final files = <(File, int, DateTime)>[];
    var total = 0;
    await for (final e in dir.list(recursive: true, followLinks: false)) {
      if (e is File) {
        final st = await e.stat();
        files.add((e, st.size, st.modified));
        total += st.size;
      }
    }
    if (total <= maxBytes) return;
    files.sort((a, b) => a.$3.compareTo(b.$3));
    final target = (maxBytes * 0.9).toInt();
    for (final f in files) {
      if (total <= target) break;
      try { await f.$1.delete(); total -= f.$2; } catch (_) {}
    }
  }

  Future<void> clear() async { if (await dir.exists()) await dir.delete(recursive: true); }
}

/// Fournit les tuiles de chaque couche : d'abord le cache de l'appareil, puis le réseau (et mise en cache). Au plus 2 requêtes simultanées
/// (règle d'usage d'OpenStreetMap) ; après un échec réseau, on cesse d'interroger pendant quelques secondes pour ne pas harceler un réseau absent.
class MapTiles {
  final MapPackStore pack;
  final Future<Directory> Function() _cacheDir;
  final http.Client _client;
  final String planUrl, satelliteUrl, googleKey;
  Future<String?>? _googleSession;
  final Duration offlineBackoff;
  final int maxParallel;
  TileCache? _cache;
  DateTime? _offlineUntil;
  int _running = 0;
  final Queue<Completer<void>> _waiting = Queue();
  final Map<String, Future<Uint8List?>> _inflight = {};

  /// Indique que le réseau semble absent (dernier essai échoué) : l'écran peut en avertir l'utilisateur.
  final ValueNotifier<bool> offline = ValueNotifier<bool>(false);

  MapTiles(this.pack, {Future<Directory> Function()? cacheDir, http.Client? client, this.planUrl = Config.osmTileUrl, this.satelliteUrl = Config.satelliteTileUrl, this.googleKey = Config.googleMapsKey,
      this.offlineBackoff = const Duration(seconds: 20), this.maxParallel = 2})
      : _cacheDir = cacheDir ?? (() async => Directory(p.join((await getApplicationSupportDirectory()).path, 'tiles'))),
        _client = client ?? http.Client();

  Future<TileCache> _cacheOnce() async => _cache ??= TileCache(await _cacheDir());

  int minZoom(BaseLayer l) => l == BaseLayer.pack ? pack.minZoom : 0;
  int maxZoom(BaseLayer l) => l == BaseLayer.pack ? pack.maxZoom : l.maxZoom;
  bool available(BaseLayer l) => l == BaseLayer.pack ? pack.ready : l == BaseLayer.google ? googleKey.isNotEmpty : true;

  /// Au démarrage : nettoie le cache s'il dépasse son plafond.
  Future<void> init() async => unawaited((await _cacheOnce()).prune());

  Future<int> cacheSize() async => (await _cacheOnce()).size();
  Future<void> clearCache() async => (await _cacheOnce()).clear();

  /// Session de l'API Map Tiles de Google (une par lancement) ; null si la clé est refusée ou le réseau absent (nouvel essai au prochain affichage).
  Future<String?> _session() => _googleSession ??= () async {
        try {
          final r = await _client.post(Uri.parse('https://tile.googleapis.com/v1/createSession?key=$googleKey'),
              headers: {'content-type': 'application/json'}, body: '{"mapType":"roadmap","language":"fr","region":"CI"}').timeout(const Duration(seconds: 8));
          if (r.statusCode != 200) { _googleSession = null; return null; }
          return RegExp(r'"session"\s*:\s*"([^"]+)"').firstMatch(r.body)?.group(1);
        } catch (_) { _googleSession = null; return null; }
      }();

  String _url(BaseLayer l, int z, int x, int y) =>
      (l == BaseLayer.plan ? planUrl : satelliteUrl).replaceAll('{z}', '$z').replaceAll('{x}', '$x').replaceAll('{y}', '$y');

  Future<Uint8List?> tile(BaseLayer l, int z, int x, int y) {
    if (l == BaseLayer.pack) return pack.tile(z, x, y);
    if (z < 0 || z > l.maxZoom) return Future.value(null);
    final key = '${l.name}/$z/$x/$y';
    // Les accolades comptent : whenComplete attendrait la valeur renvoyée par remove(), c'est-à-dire cette même future (blocage).
    return _inflight.putIfAbsent(key, () => _load(l, z, x, y).whenComplete(() { _inflight.remove(key); }));
  }

  Future<Uint8List?> _load(BaseLayer l, int z, int x, int y) async {
    final cache = await _cacheOnce();
    final hit = await cache.get(l.name, z, x, y);
    if (hit != null) return hit;
    if (_offlineUntil != null && DateTime.now().isBefore(_offlineUntil!)) return null;
    await _acquire();
    try {
      // Une autre demande a pu remplir le cache pendant l'attente.
      final again = await cache.get(l.name, z, x, y);
      if (again != null) return again;
      if (_offlineUntil != null && DateTime.now().isBefore(_offlineUntil!)) return null;
      var url = _url(l, z, x, y);
      if (l == BaseLayer.google) {
        final sess = await _session();
        if (sess == null) return null;
        url = 'https://tile.googleapis.com/v1/2dtiles/$z/$x/$y?session=$sess&key=$googleKey';
      }
      final res = await _client.get(Uri.parse(url), headers: {'user-agent': Config.tileUserAgent}).timeout(const Duration(seconds: 8));
      offline.value = false;
      _offlineUntil = null;
      if (res.statusCode != 200 || res.bodyBytes.isEmpty) return null;
      final type = res.headers['content-type'] ?? '';
      if (type.isNotEmpty && !type.startsWith('image/')) return null; // page d'erreur ou portail captif
      await cache.put(l.name, z, x, y, res.bodyBytes);
      return res.bodyBytes;
    } on TimeoutException {
      _markOffline();
    } on SocketException {
      _markOffline();
    } on http.ClientException {
      _markOffline();
    } finally {
      _release();
    }
    return null;
  }

  void _markOffline() {
    _offlineUntil = DateTime.now().add(offlineBackoff);
    offline.value = true;
  }

  Future<void> _acquire() async {
    if (_running < maxParallel) { _running++; return; }
    final c = Completer<void>();
    _waiting.add(c);
    await c.future;
  }

  void _release() {
    if (_waiting.isNotEmpty) {
      _waiting.removeFirst().complete(); // la place est transmise telle quelle
    } else {
      _running--;
    }
  }
}
