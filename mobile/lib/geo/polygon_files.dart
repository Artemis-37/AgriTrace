import 'dart:convert';

import 'polygon.dart';

/// Fichiers de polygones : export KML « polygone plein » (intérieur jaune, contour rouge) et import KML / GPX / GeoJSON.
/// Tout est en Dart pur (aucune dépendance), donc testable hors de l'appareil.

/// Un polygone lu dans un fichier, avant rattachement au producteur.
class ImportedPolygon {
  final String name;
  final List<GeoPoint> points; // anneau ouvert (le dernier point n'est pas répété)
  final String? code; // code producteur trouvé dans le fichier (données étendues, propriétés), s'il y en a un
  const ImportedPolygon(this.name, this.points, {this.code});
}

String _two(int n) => n.toString().padLeft(2, '0');

/// Retire ce que Windows et Android refusent dans un nom de fichier.
String sanitizeFileName(String s) => s.replaceAll(RegExp(r'[\\/:*?"<>|\r\n\t]'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();

/// Nom du fichier exporté, sans extension :
/// GPSWpts-ANNÉE-MOIS-JOUR(d'exportation)-wpt-CODE du producteur-NOM et prénom du producteur-Numéro de la parcelle.
String polygonFileName({required DateTime date, required String code, required String name, String parcel = ''}) =>
    sanitizeFileName('GPSWpts-${date.year}-${_two(date.month)}-${_two(date.day)}-wpt-${code.trim()}-${name.trim()}${parcel.trim().isEmpty ? '' : '-${parcel.trim()}'}');

String _xml(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const _centreStyle = '<Style id="centre"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-blank.png</href></Icon>'
    '<hotSpot x="0.5" y="0" xunits="fraction" yunits="fraction"/></IconStyle></Style>';

/// Un waypoint à exporter : le centre (centroïde) d'une parcelle.
class Waypoint {
  final String name;
  final GeoPoint point;
  final String? code, producer, parcel;
  final double? areaHa;
  const Waypoint({required this.name, required this.point, this.code, this.producer, this.parcel, this.areaHa});
}

/// KML de waypoints (un point par parcelle, comme les « waypoints » de l'outil GPS), tous avec l'icône du centre.
String waypointsToKml({required String name, required List<Waypoint> items}) {
  final b = StringBuffer()
    ..writeln('<?xml version="1.0" encoding="UTF-8"?>')
    ..writeln('<kml xmlns="http://www.opengis.net/kml/2.2">')
    ..writeln('<Document>')
    ..writeln('<name>${_xml(name)}</name>')
    ..writeln(_centreStyle);
  for (final w in items) {
    b
      ..writeln('<Placemark>')
      ..writeln('<name>${_xml(w.name)}</name>')
      ..writeln('<styleUrl>#centre</styleUrl>');
    if (w.code != null || w.producer != null || w.parcel != null || w.areaHa != null) {
      b.writeln('<ExtendedData>');
      if (w.code != null) b.writeln('<Data name="code_producteur"><value>${_xml(w.code!)}</value></Data>');
      if (w.producer != null) b.writeln('<Data name="producteur"><value>${_xml(w.producer!)}</value></Data>');
      if (w.parcel != null) b.writeln('<Data name="parcelle"><value>${_xml(w.parcel!)}</value></Data>');
      if (w.areaHa != null) b.writeln('<Data name="surface_ha"><value>${w.areaHa!.toStringAsFixed(4)}</value></Data>');
      b.writeln('</ExtendedData>');
    }
    b
      ..writeln('<Point><coordinates>${w.point.lon.toStringAsFixed(6)},${w.point.lat.toStringAsFixed(6)},0</coordinates></Point>')
      ..writeln('</Placemark>');
  }
  b..writeln('</Document>')..writeln('</kml>');
  return b.toString();
}

/// KML d'une parcelle : polygone plein — intérieur jaune (translucide, l'imagerie reste visible dessous), contour rouge.
/// Les couleurs KML s'écrivent aabbggrr.
String polygonToKml({required String name, required List<GeoPoint> points, String? code, String? producer, double? areaHa, GeoPoint? center}) {
  final ring = closedRing(points).map((p) => '${p[0]},${p[1]},0').join(' ');
  final b = StringBuffer()
    ..writeln('<?xml version="1.0" encoding="UTF-8"?>')
    ..writeln('<kml xmlns="http://www.opengis.net/kml/2.2">')
    ..writeln('<Document>')
    ..writeln('<name>${_xml(name)}</name>')
    ..writeln('<Style id="parcelle"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle>'
        '<PolyStyle><color>b300ffff</color><fill>1</fill><outline>1</outline></PolyStyle></Style>')
    ..writeln(_centreStyle)
    ..writeln('<Placemark>')
    ..writeln('<name>${_xml(name)}</name>')
    ..writeln('<styleUrl>#parcelle</styleUrl>');
  if (code != null || producer != null || areaHa != null) {
    b.writeln('<ExtendedData>');
    if (code != null) b.writeln('<Data name="code_producteur"><value>${_xml(code)}</value></Data>');
    if (producer != null) b.writeln('<Data name="producteur"><value>${_xml(producer)}</value></Data>');
    if (areaHa != null) b.writeln('<Data name="surface_ha"><value>${areaHa.toStringAsFixed(4)}</value></Data>');
    b.writeln('</ExtendedData>');
  }
  b
    ..writeln('<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>$ring</coordinates></LinearRing></outerBoundaryIs></Polygon>')
    ..writeln('</Placemark>');
  // Centre de la parcelle (point intérieur au polygone) : une croix, comme dans l'application.
  if (center != null) {
    b
      ..writeln('<Placemark>')
      ..writeln('<name>${_xml('Centre ${name.trim()}'.trim())}</name>')
      ..writeln('<styleUrl>#centre</styleUrl>')
      ..writeln('<Point><coordinates>${center.lon.toStringAsFixed(6)},${center.lat.toStringAsFixed(6)},0</coordinates></Point>')
      ..writeln('</Placemark>');
  }
  b
    ..writeln('</Document>')
    ..writeln('</kml>');
  return b.toString();
}

String _unCdata(String s) {
  final m = RegExp(r'^\s*<!\[CDATA\[(.*)\]\]>\s*$', dotAll: true).firstMatch(s);
  return _unxml((m != null ? m.group(1)! : s).trim());
}

String _unxml(String s) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');

/// Anneau ouvert : le point de fermeture répété est retiré, les points consécutifs identiques aussi.
List<GeoPoint> _open(List<GeoPoint> pts) {
  final out = <GeoPoint>[];
  for (final p in pts) {
    if (out.isNotEmpty && out.last.lat == p.lat && out.last.lon == p.lon) continue;
    out.add(p);
  }
  if (out.length > 1 && out.first.lat == out.last.lat && out.first.lon == out.last.lon) out.removeLast();
  return out;
}

List<GeoPoint> _kmlCoords(String s) {
  final out = <GeoPoint>[];
  for (final tok in s.trim().split(RegExp(r'\s+'))) {
    final p = tok.split(',');
    if (p.length < 2) continue;
    final lon = double.tryParse(p[0]), lat = double.tryParse(p[1]);
    if (lon == null || lat == null || lat.abs() > 90 || lon.abs() > 180) continue;
    out.add(GeoPoint(lat, lon));
  }
  return out;
}

/// Lit un KML : chaque Polygon donne un polygone ; une ligne (LineString, « chemin » de l'outil GPS) de 3 points ou plus
/// est refermée en polygone — c'est le cas des tracés relevés au GPS en mode chemin.
List<ImportedPolygon> parseKml(String xml) {
  final out = <ImportedPolygon>[];
  final placemarks = RegExp(r'<Placemark\b.*?</Placemark>', dotAll: true, caseSensitive: false).allMatches(xml).map((m) => m.group(0)!).toList();
  var n = 0;
  for (final pm in placemarks) {
    final nm = RegExp(r'<name>(.*?)</name>', dotAll: true).firstMatch(pm);
    final name = nm == null ? '' : _unCdata(nm.group(1)!);
    String? code;
    final cm = RegExp(r'<Data\s+name="(?:code_producteur|producer_code|code)"\s*>\s*<value>(.*?)</value>', dotAll: true, caseSensitive: false).firstMatch(pm);
    if (cm != null) code = _unCdata(cm.group(1)!);
    final shapes = <List<GeoPoint>>[];
    for (final m in RegExp(r'<Polygon\b.*?</Polygon>', dotAll: true).allMatches(pm)) {
      final outer = RegExp(r'<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>', dotAll: true).firstMatch(m.group(0)!);
      if (outer != null) shapes.add(_open(_kmlCoords(outer.group(1)!)));
    }
    if (shapes.isEmpty) {
      for (final m in RegExp(r'<LineString\b.*?<coordinates>(.*?)</coordinates>', dotAll: true).allMatches(pm)) {
        shapes.add(_open(_kmlCoords(m.group(1)!)));
      }
    }
    for (final s in shapes) {
      n++;
      out.add(ImportedPolygon(name.isEmpty ? 'Polygone $n' : name, s, code: code));
    }
  }
  return out;
}

/// GPX : chaque trace (trk/trkseg) ou route (rte) devient un polygone fermé.
List<ImportedPolygon> parseGpx(String xml) {
  final out = <ImportedPolygon>[];
  var n = 0;
  List<GeoPoint> pts(String block, String tag) {
    final r = <GeoPoint>[];
    for (final m in RegExp('<$tag\\b([^>]*)>', caseSensitive: false).allMatches(block)) {
      final a = m.group(1)!;
      final lat = double.tryParse(RegExp(r'lat\s*=\s*"([^"]+)"').firstMatch(a)?.group(1) ?? '');
      final lon = double.tryParse(RegExp(r'lon\s*=\s*"([^"]+)"').firstMatch(a)?.group(1) ?? '');
      if (lat != null && lon != null) r.add(GeoPoint(lat, lon));
    }
    return r;
  }
  for (final trk in RegExp(r'<trk\b.*?</trk>', dotAll: true).allMatches(xml)) {
    final b = trk.group(0)!;
    final nm = RegExp(r'<name>(.*?)</name>', dotAll: true).firstMatch(b);
    final segs = RegExp(r'<trkseg\b.*?</trkseg>', dotAll: true).allMatches(b).map((m) => m.group(0)!).toList();
    for (final seg in (segs.isEmpty ? [b] : segs)) {
      n++;
      out.add(ImportedPolygon(nm == null ? 'Polygone $n' : _unCdata(nm.group(1)!), _open(pts(seg, 'trkpt'))));
    }
  }
  for (final rte in RegExp(r'<rte\b.*?</rte>', dotAll: true).allMatches(xml)) {
    final b = rte.group(0)!;
    final nm = RegExp(r'<name>(.*?)</name>', dotAll: true).firstMatch(b);
    n++;
    out.add(ImportedPolygon(nm == null ? 'Polygone $n' : _unCdata(nm.group(1)!), _open(pts(b, 'rtept'))));
  }
  return out;
}

/// GeoJSON : Polygon, MultiPolygon et LineString (refermée) ; la propriété `code_producteur` (ou `code`) rattache au producteur.
List<ImportedPolygon> parseGeoJson(String text) {
  final out = <ImportedPolygon>[];
  var n = 0;
  List<GeoPoint> ring(Object? coords) => _open([
        for (final c in (coords as List? ?? const []))
          if (c is List && c.length >= 2 && c[0] is num && c[1] is num) GeoPoint((c[1] as num).toDouble(), (c[0] as num).toDouble()),
      ]);
  void geom(Object? g, String name, String? code) {
    if (g is! Map) return;
    switch (g['type']) {
      case 'Polygon':
        final rings = g['coordinates'] as List?;
        if (rings != null && rings.isNotEmpty) { n++; out.add(ImportedPolygon(name.isEmpty ? 'Polygone $n' : name, ring(rings.first), code: code)); }
      case 'MultiPolygon':
        for (final poly in (g['coordinates'] as List? ?? const [])) {
          if (poly is List && poly.isNotEmpty) { n++; out.add(ImportedPolygon(name.isEmpty ? 'Polygone $n' : name, ring(poly.first), code: code)); }
        }
      case 'LineString':
        n++;
        out.add(ImportedPolygon(name.isEmpty ? 'Polygone $n' : name, ring(g['coordinates']), code: code));
      case 'GeometryCollection':
        for (final x in (g['geometries'] as List? ?? const [])) { geom(x, name, code); }
    }
  }
  void walk(Object? j) {
    if (j is! Map) return;
    switch (j['type']) {
      case 'FeatureCollection':
        for (final f in (j['features'] as List? ?? const [])) { walk(f); }
      case 'Feature':
        final props = (j['properties'] as Map?) ?? const {};
        final name = '${props['name'] ?? props['nom'] ?? ''}'.trim();
        final code = '${props['code_producteur'] ?? props['producer_code'] ?? props['code'] ?? ''}'.trim();
        geom(j['geometry'], name, code.isEmpty ? null : code);
      default:
        geom(j, '', null);
    }
  }
  walk(jsonDecode(text));
  return out;
}

/// Lit un fichier d'après son extension (le contenu d'un KMZ doit d'abord être extrait, voir [parsePolygonFile]).
List<ImportedPolygon> parsePolygonText(String fileName, String text) {
  final ext = fileName.toLowerCase().split('.').last;
  if (ext == 'gpx') return parseGpx(text);
  if (ext == 'geojson' || ext == 'json') return parseGeoJson(text);
  return parseKml(text);
}

/// Message d'erreur si le polygone lu ne peut pas être enregistré, sinon null (mêmes règles que le relevé sur le terrain).
String? polygonProblem(List<GeoPoint> pts) => validateTrace(pts);

// ---------------------------------------------------------------------------------------------------------------------
// Rattachement au producteur

/// Texte comparable : majuscules, sans accents ni ponctuation.
String normText(String s) {
  const from = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ';
  const to = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY';
  final b = StringBuffer();
  for (final r in s.runes) {
    final ch = String.fromCharCode(r);
    final i = from.indexOf(ch);
    b.write(i >= 0 ? to[i] : ch);
  }
  return b.toString().toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]+'), ' ').trim();
}

String _codeKey(String s) => s.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');

/// Nom de fichier d'un export de l'application : date et « code-nom » (le code peut contenir un tiret).
class ParsedFileName {
  final DateTime date;
  final String rest; // « CODE-NOM Prénom »
  const ParsedFileName(this.date, this.rest);
}

ParsedFileName? parsePolygonFileName(String fileName) {
  var base = fileName.replaceAll('\\', '/').split('/').last;
  final dot = base.lastIndexOf('.');
  if (dot > 0) base = base.substring(0, dot);
  final m = RegExp(r'^GPSWpts-(\d{4})-(\d{2})-(\d{2})-wpt-(.+)$', caseSensitive: false).firstMatch(base.trim());
  if (m == null) return null;
  final y = int.parse(m.group(1)!), mo = int.parse(m.group(2)!), d = int.parse(m.group(3)!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return ParsedFileName(DateTime(y, mo, d), m.group(4)!.trim());
}

String _nameOf(Map<String, Object?> p) => '${p['last_name'] ?? ''} ${p['first_names'] ?? ''}'.trim();

/// Producteur désigné par « CODE-NOM Prénom » : on essaie chaque découpage possible au tiret (AD244-FT-NOM → code AD244-FT),
/// d'abord le code exact, puis un code qui commence ainsi s'il est unique ; en dernier recours le nom complet.
Map<String, Object?>? matchProducerByRest(String rest, List<Map<String, Object?>> producers) {
  final parts = rest.split('-').map((s) => s.trim()).toList();
  for (var i = 1; i <= parts.length; i++) {
    final key = _codeKey(parts.sublist(0, i).join('-'));
    if (key.isEmpty) continue;
    final exact = producers.where((p) => _codeKey('${p['internal_code'] ?? ''}') == key).toList();
    if (exact.length == 1) return exact.first;
    if (exact.isEmpty && i == 1) {
      final starts = producers.where((p) { final c = _codeKey('${p['internal_code'] ?? ''}'); return c.startsWith(key) && c.length > key.length; }).toList();
      if (starts.length == 1) return starts.first;
    }
  }
  // Nom et prénom, avec ou sans le numéro de parcelle qui peut terminer le nom (CODE-NOM Prénom-Numéro).
  for (final drop in [0, 1]) {
    if (parts.length - drop < 2 && drop == 1) continue;
    final body = parts.length > 1 ? parts.sublist(1, parts.length - drop) : parts;
    final nameKey = normText(body.join(' '));
    if (nameKey.isEmpty) continue;
    final byName = producers.where((p) => normText(_nameOf(p)) == nameKey || normText('${p['first_names'] ?? ''} ${p['last_name'] ?? ''}') == nameKey).toList();
    if (byName.length == 1) return byName.first;
  }
  return null;
}

/// Producteur dont le code figure comme mot dans un texte libre (nom du polygone, propriété du fichier).
Map<String, Object?>? matchProducerByText(String text, List<Map<String, Object?>> producers) {
  final t = ' ${text.toUpperCase()} ';
  final found = <Map<String, Object?>>[];
  for (final p in producers) {
    final code = '${p['internal_code'] ?? ''}'.trim().toUpperCase();
    if (code.length < 3) continue;
    final re = RegExp('(?<![A-Z0-9])${RegExp.escape(code)}(?![A-Z0-9])');
    if (re.hasMatch(t)) found.add(p);
  }
  if (found.isEmpty) return null;
  found.sort((a, b) => '${b['internal_code']}'.length.compareTo('${a['internal_code']}'.length)); // le code le plus long d'abord (AD244-FT avant AD244)
  return found.first;
}

/// Producteur d'un polygone importé : code du fichier, puis nom du fichier d'export, puis nom du polygone.
Map<String, Object?>? resolveProducer(String fileName, ImportedPolygon poly, List<Map<String, Object?>> producers) {
  if (poly.code != null && poly.code!.isNotEmpty) {
    final byCode = matchProducerByRest(poly.code!, producers);
    if (byCode != null) return byCode;
  }
  final pf = parsePolygonFileName(fileName);
  if (pf != null) {
    final byFile = matchProducerByRest(pf.rest, producers);
    if (byFile != null) return byFile;
  }
  return matchProducerByText(poly.name, producers);
}

/// Anneau ouvert d'un GeoJSON Polygon (texte JSON ou déjà décodé), tel que stocké pour une parcelle ; null s'il est illisible.
List<GeoPoint>? ringFromGeometry(Object? geometry) {
  try {
    final j = geometry is String ? jsonDecode(geometry) : geometry;
    final ring = _open([
      for (final c in ((j as Map)['coordinates'] as List).first as List) GeoPoint((c[1] as num).toDouble(), (c[0] as num).toDouble()),
    ]);
    return ring.length >= 3 ? ring : null;
  } catch (_) {
    return null;
  }
}
