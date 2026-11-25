import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';

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

const _downloads = MethodChannel('ci.agritrace/downloads');

/// Exporte des parcelles (lignes de [Repository.polygons]) en fichiers KML « polygone plein », un fichier par parcelle, nommés
/// GPSWpts-ANNÉE-MOIS-JOUR-wpt-CODE-NOM Prénom-Numéro de parcelle.kml, et les enregistre directement dans le dossier Téléchargements du téléphone.
/// Retourne les noms des fichiers enregistrés (Android peut ajouter « (1) » si un fichier de même nom existe déjà).
Future<List<String>> exportPolygons(List<Map<String, Object?>> rows, {DateTime? now}) async {
  final date = now ?? DateTime.now();
  final used = <String, int>{};
  final saved = <String>[];
  for (final r in rows) {
    final ring = ringFromGeometry(r['geometry']);
    if (ring == null) continue;
    final code = '${r['producer_code'] ?? ''}'.trim();
    final who = '${r['last_name'] ?? ''} ${r['first_names'] ?? ''}'.trim().toUpperCase();
    var parcel = '${r['code'] ?? ''}'.trim();
    if (code.isNotEmpty && parcel.toUpperCase().startsWith('${code.toUpperCase()}-')) parcel = parcel.substring(code.length + 1); // numéro seul
    var base = polygonFileName(date: date, code: code.isEmpty ? 'SANS-CODE' : code, name: who.isEmpty ? 'SANS NOM' : who, parcel: parcel);
    final n = (used[base] ?? 0) + 1; // même nom dans un même export : (2), (3)…
    used[base] = n;
    if (n > 1) base = '$base ($n)';
    final area = double.tryParse('${r['geometry_area_ha'] ?? ''}') ?? areaHa(ring);
    final kml = polygonToKml(name: '${code.isEmpty ? '' : '$code '}$who${parcel.isEmpty ? '' : ' $parcel'}'.trim(), points: ring, code: code.isEmpty ? null : code, producer: who.isEmpty ? null : who, areaHa: area);
    final name = await _downloads.invokeMethod<String>('save', {
      'name': '$base.kml', 'mime': 'application/vnd.google-earth.kml+xml', 'bytes': Uint8List.fromList(utf8.encode(kml)),
    });
    saved.add(name ?? '$base.kml');
  }
  return saved;
}
