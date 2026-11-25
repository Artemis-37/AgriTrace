import 'package:agritrace_mobile/geo/polygon.dart';
import 'package:agritrace_mobile/geo/polygon_files.dart';
import 'package:flutter_test/flutter_test.dart';

List<GeoPoint> square() => const [GeoPoint(5.5, -4.2), GeoPoint(5.5, -4.199), GeoPoint(5.501, -4.199), GeoPoint(5.501, -4.2)];

final producers = <Map<String, Object?>>[
  {'id': 'p1', 'internal_code': 'AD244', 'last_name': 'ZEHOURI', 'first_names': 'Djedje'},
  {'id': 'p2', 'internal_code': 'AD028-FT', 'last_name': 'KOUASSI', 'first_names': 'Gbazare Anatole'},
  {'id': 'p3', 'internal_code': 'AD058', 'last_name': 'KOMENAN', 'first_names': 'Komenan Berenger'},
];

void main() {
  test("nom du fichier exporté : GPSWpts-année-mois-jour-wpt-code-nom", () {
    expect(polygonFileName(date: DateTime(2026, 11, 25), code: 'AD244', name: 'ZEHOURI DJEDJE'), 'GPSWpts-2026-11-25-wpt-AD244-ZEHOURI DJEDJE');
    expect(polygonFileName(date: DateTime(2026, 11, 25), code: 'AD244', name: 'ZEHOURI DJEDJE', parcel: 'P2'), 'GPSWpts-2026-11-25-wpt-AD244-ZEHOURI DJEDJE-P2');
    expect(polygonFileName(date: DateTime(2026, 1, 5), code: 'A/1', name: 'N: "X"'), 'GPSWpts-2026-01-05-wpt-A 1-N X');
  });

  test('le KML exporté est un polygone plein : intérieur jaune, contour rouge, anneau fermé', () {
    final kml = polygonToKml(name: 'AD244 ZEHOURI DJEDJE', points: square(), code: 'AD244', producer: 'ZEHOURI DJEDJE', areaHa: 1.2345);
    expect(kml, contains('<fill>1</fill>'));
    expect(kml, contains('<color>b300ffff</color>')); // jaune (aabbggrr)
    expect(kml, contains('<color>ff0000ff</color>')); // rouge
    final back = parseKml(kml);
    expect(back.length, 1);
    expect(back.first.code, 'AD244');
    expect(back.first.points.length, 4); // anneau rouvert
    expect(back.first.points.first.lat, 5.5);
    expect(back.first.points.first.lon, -4.2);
  });

  test("une ligne (chemin de l'outil GPS) devient un polygone fermé", () {
    const kml = '<kml><Document><Placemark><name>Chemin 1</name><LineString><coordinates>-4.2,5.5,0 -4.199,5.5,0 -4.199,5.501,0 -4.2,5.501,0</coordinates></LineString></Placemark></Document></kml>';
    final r = parseKml(kml);
    expect(r.single.points.length, 4);
    expect(polygonProblem(r.single.points), isNull);
  });

  test('GPX : une trace devient un polygone', () {
    const gpx = '<gpx><trk><name>T1</name><trkseg><trkpt lat="5.5" lon="-4.2"/><trkpt lat="5.5" lon="-4.199"/><trkpt lat="5.501" lon="-4.199"/></trkseg></trk></gpx>';
    final r = parseGpx(gpx);
    expect(r.single.name, 'T1');
    expect(r.single.points.length, 3);
  });

  test('GeoJSON : Polygon, MultiPolygon et code producteur en propriété', () {
    const j = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"A","code_producteur":"AD058"},"geometry":{"type":"Polygon","coordinates":[[[-4.2,5.5],[-4.199,5.5],[-4.199,5.501],[-4.2,5.5]]]}},'
        '{"type":"Feature","properties":{},"geometry":{"type":"MultiPolygon","coordinates":[[[[-4.2,5.5],[-4.1,5.5],[-4.1,5.6],[-4.2,5.5]]],[[[-4.0,5.5],[-3.9,5.5],[-3.9,5.6],[-4.0,5.5]]]]}}]}';
    final r = parseGeoJson(j);
    expect(r.length, 3);
    expect(r.first.code, 'AD058');
    expect(r.first.points.length, 3);
  });

  test('un papillon ou moins de 3 points est refusé', () {
    expect(polygonProblem(const [GeoPoint(5.5, -4.2), GeoPoint(5.5, -4.1)]), isNotNull);
    expect(polygonProblem(const [GeoPoint(0, 0), GeoPoint(1, 1), GeoPoint(1, 0), GeoPoint(0, 1)]), isNotNull);
  });

  test("rattachement par le nom de fichier, y compris un code avec tiret", () {
    final pf = parsePolygonFileName('/storage/GPSWpts-2026-11-25-wpt-AD028-FT-KOUASSI GBAZARE ANATOLE.kml');
    expect(pf, isNotNull);
    expect(pf!.date, DateTime(2026, 11, 25));
    expect(matchProducerByRest(pf.rest, producers)!['id'], 'p2'); // AD028-FT exact
    expect(matchProducerByRest('AD244-ZEHOURI DJEDJE', producers)!['id'], 'p1');
    expect(matchProducerByRest('AD028-KOUASSI', producers)!['id'], 'p2'); // AD028 seul : un seul code qui commence ainsi
    expect(matchProducerByRest('XX999-Zehouri Djedje', producers)!['id'], 'p1'); // code inconnu : par le nom
    expect(matchProducerByRest('ZZ1-INCONNU', producers), isNull);
    expect(parsePolygonFileName('parcelle.kml'), isNull);
  });

  test("rattachement par le texte : le code le plus long l'emporte", () {
    final ps = [...producers, {'id': 'p4', 'internal_code': 'AD244-FT', 'last_name': 'X', 'first_names': 'Y'}];
    expect(matchProducerByText('Parcelle AD244-FT champ 2', ps)!['id'], 'p4');
    expect(matchProducerByText('AD244 champ', ps)!['id'], 'p1');
    expect(matchProducerByText('rien', ps), isNull);
  });

  test('resolveProducer : code du fichier, puis nom du fichier, puis nom du polygone', () {
    final poly = ImportedPolygon('Parcelle 1', square());
    expect(resolveProducer('GPSWpts-2026-11-25-wpt-AD058-KOMENAN.kml', poly, producers)!['id'], 'p3');
    expect(resolveProducer('x.kml', ImportedPolygon('AD244 nord', square()), producers)!['id'], 'p1');
    expect(resolveProducer('x.kml', ImportedPolygon('AD244 nord', square(), code: 'AD058'), producers)!['id'], 'p3');
    expect(resolveProducer('x.kml', poly, producers), isNull);
  });

  test("l'anneau stocké d'une parcelle est relu en points ouverts, un tracé illisible donne null", () {
    final g = toGeoJson(square());
    final pts = ringFromGeometry(g)!;
    expect(pts.length, 4);
    expect(ringFromGeometry('{"type":"Polygon","coordinates":[[[-4.2,5.5],[-4.199,5.5],[-4.199,5.501],[-4.2,5.5]]]}')!.length, 3);
    expect(ringFromGeometry('pas du json'), isNull);
    expect(ringFromGeometry(null), isNull);
  });

  test("aller-retour : ce qu'on exporte se réimporte à l'identique et se rattache au producteur par le code", () {
    final kml = polygonToKml(name: 'AD244 ZEHOURI DJEDJE', points: square(), code: 'AD244');
    final back = parseKml(kml).single;
    expect(areaHa(back.points), closeTo(areaHa(square()), 1e-9));
    expect(resolveProducer('GPSWpts-2026-11-25-wpt-AD244-ZEHOURI DJEDJE.kml', back, producers)!['id'], 'p1');
  });

  group('centre de la parcelle', () {
    // U très ouvert : le centre de gravité tombe dans le vide, le centre doit rester dans le polygone.
    final u = [for (final p in [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [8.0, 10.0], [8.0, 2.0], [2.0, 2.0], [2.0, 10.0], [0.0, 10.0]]) GeoPoint(p[1] * 1e-4 + 6.8, p[0] * 1e-4 - 5.3)];
    test('point intérieur : carré et parcelle en U', () {
      final sq = [const GeoPoint(6.8, -5.3), const GeoPoint(6.8, -5.299), const GeoPoint(6.801, -5.299), const GeoPoint(6.801, -5.3)];
      final c = interiorPoint(sq);
      expect(pointInRing(sq, c.lat, c.lon), isTrue);
      expect(pointInRing(u, 6.8006, -5.2995), isFalse);
      final d = interiorPoint(u);
      expect(pointInRing(u, d.lat, d.lon), isTrue);
    });
    test('centerOf garde le centre placé s\'il est dans le tracé, sinon recalcule', () {
      final sq = [const GeoPoint(6.8, -5.3), const GeoPoint(6.8, -5.299), const GeoPoint(6.801, -5.299), const GeoPoint(6.801, -5.3)];
      final kept = centerOf(sq, lat: '6.8002', lon: '-5.2998');
      expect(kept.lat, closeTo(6.8002, 1e-9));
      final fixed = centerOf(sq, lat: '7.5', lon: '-5.2998');
      expect(pointInRing(sq, fixed.lat, fixed.lon), isTrue);
    });
    test('le KML exporté contient la croix du centre et se réimporte sans doublon', () {
      final sq = [const GeoPoint(6.8, -5.3), const GeoPoint(6.8, -5.299), const GeoPoint(6.801, -5.299), const GeoPoint(6.801, -5.3)];
      final kml = polygonToKml(name: 'AD244 ZEHOURI', points: sq, code: 'AD244', center: interiorPoint(sq));
      expect(kml, contains('<Point>'));
      expect(kml, contains('cross-hairs'));
      expect(parseKml(kml).length, 1);
    });
  });
}
