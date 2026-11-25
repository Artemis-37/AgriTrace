import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../geo/polygon.dart';
import '../geo/polygon_files.dart';

/// Un fichier choisi par l'utilisateur, déjà lu : ses polygones, ou la raison pour laquelle il n'a pas pu l'être.
class PolygonFile {
  final String name;
  final List<ImportedPolygon> polygons;
  final String? error;
  const PolygonFile(this.name, this.polygons, {this.error});
}

const _maxFileBytes = 25 * 1024 * 1024;

/// Choix d'un ou plusieurs fichiers (KML, KMZ, GPX, GeoJSON) : null si l'utilisateur annule.
Future<List<PolygonFile>?> pickPolygonFiles() async {
  final res = await FilePicker.platform.pickFiles(allowMultiple: true, type: FileType.any, withData: true);
  if (res == null || res.files.isEmpty) return null;
  final out = <PolygonFile>[];
  for (final f in res.files) {
    out.add(await readPolygonFile(f.name, f.bytes ?? (f.path == null ? null : await File(f.path!).readAsBytes())));
  }
  return out;
}

/// Lit un fichier d'après son extension ; un KMZ est décompressé, sa première page KML est lue.
Future<PolygonFile> readPolygonFile(String name, List<int>? bytes) async {
  final ext = name.toLowerCase().split('.').last;
  if (bytes == null || bytes.isEmpty) return PolygonFile(name, const [], error: 'Fichier vide ou illisible.');
  if (bytes.length > _maxFileBytes) return PolygonFile(name, const [], error: 'Fichier trop volumineux (25 Mo au plus).');
  if (!const {'kml', 'kmz', 'gpx', 'geojson', 'json'}.contains(ext)) {
    return PolygonFile(name, const [], error: 'Format non pris en charge (KML, KMZ, GPX ou GeoJSON attendus).');
  }
  try {
    String text;
    var parseName = name;
    if (ext == 'kmz') {
      final zip = ZipDecoder().decodeBytes(bytes);
      final kmls = zip.files.where((f) => f.isFile && f.name.toLowerCase().endsWith('.kml')).toList();
      if (kmls.isEmpty) return PolygonFile(name, const [], error: 'Ce KMZ ne contient aucun fichier KML.');
      kmls.sort((a, b) => (a.name.toLowerCase() == 'doc.kml' ? 0 : 1).compareTo(b.name.toLowerCase() == 'doc.kml' ? 0 : 1));
      if (kmls.first.size > _maxFileBytes) return PolygonFile(name, const [], error: 'KMZ trop volumineux une fois décompressé.');
      text = utf8.decode(kmls.first.content as List<int>, allowMalformed: true);
      parseName = 'doc.kml';
    } else {
      text = utf8.decode(bytes, allowMalformed: true);
    }
    final polys = parsePolygonText(parseName, text);
    return polys.isEmpty
        ? PolygonFile(name, const [], error: 'Aucun polygone ni tracé trouvé dans ce fichier.')
        : PolygonFile(name, polys);
  } on FormatException {
    return PolygonFile(name, const [], error: 'Fichier mal formé.');
  } catch (_) {
    return PolygonFile(name, const [], error: 'Fichier illisible.');
  }
}

/// Exporte des parcelles (lignes de [Repository.polygons]) en fichiers KML « polygone plein », un fichier par parcelle, nommés
/// GPSWpts-ANNÉE-MOIS-JOUR-wpt-CODE-NOM Prénom.kml, et ouvre le partage d'Android (messagerie, Drive, enregistrement…).
/// Retourne le nombre de fichiers préparés.
Future<int> exportPolygons(List<Map<String, Object?>> rows, {DateTime? now}) async {
  final dir = await getTemporaryDirectory();
  final out = Directory(p.join(dir.path, 'polygones_export'));
  if (out.existsSync()) out.deleteSync(recursive: true); // pas de fichiers d'un export précédent
  out.createSync(recursive: true);
  final date = now ?? DateTime.now();
  final used = <String, int>{};
  final files = <XFile>[];
  for (final r in rows) {
    final ring = ringFromGeometry(r['geometry']);
    if (ring == null) continue;
    final code = '${r['producer_code'] ?? r['code'] ?? ''}'.trim();
    final who = '${r['last_name'] ?? ''} ${r['first_names'] ?? ''}'.trim().toUpperCase();
    var base = polygonFileName(date: date, code: code.isEmpty ? 'SANS-CODE' : code, name: who.isEmpty ? 'SANS NOM' : who);
    final n = (used[base] ?? 0) + 1; // plusieurs parcelles du même producteur : (2), (3)…
    used[base] = n;
    if (n > 1) base = '$base ($n)';
    final area = double.tryParse('${r['geometry_area_ha'] ?? ''}') ?? areaHa(ring);
    final kml = polygonToKml(name: '${code.isEmpty ? '' : '$code '}$who'.trim(), points: ring, code: code.isEmpty ? null : code, producer: who.isEmpty ? null : who, areaHa: area);
    final f = File(p.join(out.path, '$base.kml'));
    await f.writeAsString(kml, encoding: utf8);
    files.add(XFile(f.path, mimeType: 'application/vnd.google-earth.kml+xml'));
  }
  if (files.isEmpty) return 0;
  await Share.shareXFiles(files, subject: files.length == 1 ? 'Polygone' : '${files.length} polygones');
  return files.length;
}
