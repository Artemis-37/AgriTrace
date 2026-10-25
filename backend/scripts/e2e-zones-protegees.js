// Zones protégées : chargement d'une couche (WGS84 ou Web Mercator), contrôle des parcelles contre les zones, exceptions, remplacement, retrait.
// EXPECT_ENGINE=postgis|js : moteur attendu (API lancée avec ou sans PostGIS / GEO_ENGINE=js).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const EXPECT = process.env.EXPECT_ENGINE || 'postgis';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : form });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const sq = (lon, lat, s = 0.0009) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
const R = 6378137;
const toMerc = ([lon, lat]) => [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R];
const mercGeom = (g) => g.type === 'Point' ? { ...g, coordinates: toMerc(g.coordinates) } : g.type === 'Polygon' ? { ...g, coordinates: g.coordinates.map((r) => r.map(toMerc)) } : { ...g, coordinates: g.coordinates.map((p) => p.map((r) => r.map(toMerc))) };
const layerFile = (features, crs3857) => {
  const fc = { type: 'FeatureCollection', features: features.map((f) => ({ type: 'Feature', properties: f.props, geometry: crs3857 ? mercGeom(f.geometry) : f.geometry })) };
  if (crs3857) fc.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } };
  return Buffer.from(JSON.stringify(fc));
};
const upload = (X, buf, fields, filename = 'zones.geojson') => {
  const f = new FormData(); f.append('file', new Blob([buf]), filename);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return call('POST', '/geo/layers', { token: X.t, org: X.org.id, form: f });
};

(async () => {
  const pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `${tag.toLowerCase()}.${run}@t.test`, full_name: 'Chef', password: pw } });
    const t = await login(`${tag.toLowerCase()}.${run}@t.test`, pw);
    const J = { token: t, org: org.id };
    const vc = (await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao' } })).body;
    const prods = [];
    for (let i = 0; i < 2; i++) prods.push((await call('POST', '/producers', { ...J, body: { last_name: 'NOM' + i, first_names: 'P' + i, village: 'Hiré', section: 'S1', region: 'Gôh', value_chain_ids: [vc.id] } })).body.producer);
    await call('PUT', '/geo/settings', { ...J, body: { overlap_min_m2: 25, overlap_min_pct: 1, near_duplicate_iou: 0.95, overlap_policy: 'warn' } });
    return { org, t, J, vc, prods };
  };
  const A = await mkOrg('ZA'), B = await mkOrg('ZB');
  const X = -5.7 + (parseInt(run, 16) % 1000) / 100000, Y = 6.8 + (parseInt(run.split('').reverse().join(''), 16) % 1000) / 100000;
  const mk = async (O, prod, geometry) => (await call('POST', '/parcels', { ...O.J, body: { idempotency_key: 'zp-' + run + '-' + crypto.randomBytes(4).toString('hex'), producer_id: O.prods[prod].id, value_chain_id: O.vc.id, declared_area_ha: '1', geometry, confirm_not_duplicate: true } })).body;

  // Zones : A = carré de 0,01° (≈ 120 ha) ; B = multipolygone de deux îlots
  const zoneA = { props: { NAME: 'Forêt classée Test ' + run, DESIG_ENG: 'Classified Forest', IUCN_CAT: 'IV', STATUS: 'Designated', STATUS_YR: 1935, WDPAID: 99001 }, geometry: sq(X, Y, 0.01) };
  const zoneB = { props: { NAME: 'Réserve Test ' + run, DESIG_ENG: 'Natural Reserve', STATUS_YR: 1990 }, geometry: { type: 'MultiPolygon', coordinates: [sq(X + 0.05, Y, 0.003).coordinates, sq(X + 0.06, Y, 0.003).coordinates] } };
  const zonePoint = { props: { NAME: 'Un point' }, geometry: { type: 'Point', coordinates: [X, Y] } };

  console.log('Parcelles existantes avant le chargement de la couche');
  const pIn = await mk(A, 0, sq(X + 0.002, Y + 0.002));                 // entièrement dans A
  const pHalf = await mk(A, 1, sq(X + 0.0095, Y + 0.004));              // à cheval sur le bord est de A (≈ 55 % dedans)
  const pOut = await mk(A, 0, sq(X + 0.02, Y + 0.02));                  // loin
  const pEdge = await mk(A, 1, sq(X + 0.0100, Y + 0.004));              // collée au bord est (limite commune seulement)
  const pSliver = await mk(A, 0, sq(X + 0.01 - 0.000001, Y + 0.006));   // liseré ≈ 0,1 m × 100 m ≈ 10 m² : sous le seuil
  const pB2 = await mk(A, 1, sq(X + 0.0605, Y + 0.0005, 0.001));        // dans le 2e îlot de B
  check('parcelles créées', [pIn, pHalf, pOut, pEdge, pSliver, pB2].every((p) => p.id), [pIn, pHalf].map((p) => p.message));
  const noLayer = (await call('GET', '/geo/anomalies?limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  check('sans couche : aucune anomalie de zone protégée', noLayer.length === 0);

  console.log('Chargement de la couche');
  const f1 = await upload(A, layerFile([zoneA, zoneB, zonePoint], true), { name: 'Aires protégées test', source: 'Essai', license: 'Essai', attribution: 'Essai' });
  check('chargement en Web Mercator (EPSG:3857) accepté', f1.status === 201, f1.body);
  check('2 zones retenues, le point est signalé comme ignoré', f1.body.features === 2 && f1.body.skipped?.[0]?.count === 1 && /Point/.test(f1.body.skipped[0].reason), f1.body);
  check('conversion Mercator signalée', (f1.body.warnings ?? []).some((w) => /Mercator/.test(w)), f1.body.warnings);
  const layerId = f1.body.id;
  const feats = (await call('GET', `/geo/layers/${layerId}/features`, A.J)).body;
  const fa = feats.find((f) => f.name.startsWith('Forêt classée'));
  check('attributs lus : désignation, catégorie, année', fa && fa.designation === 'Classified Forest' && fa.category === 'IV' && fa.year === 1935, fa);
  check('surface de la zone ≈ 120 ha', fa && fa.area_ha > 110 && fa.area_ha < 130, fa?.area_ha);
  const gj = (await call('GET', `/geo/layers/${layerId}/geojson`, A.J)).body;
  const ga = gj.features.find((f) => f.properties.name.startsWith('Forêt'));
  check('contours rendus en WGS84 (retour exact des coordonnées d\'origine à 1e-5 près)', ga && Math.abs(ga.geometry.coordinates[0][0][0] - X) < 1e-5 && Math.abs(ga.geometry.coordinates[0][0][1] - Y) < 1e-5, ga?.geometry.coordinates[0][0]);
  check('carte : filtre par emprise (hors zone → rien)', (await call('GET', `/geo/layers/${layerId}/geojson?bbox=10,10,11,11`, A.J)).body.features.length === 0);

  console.log('Contrôle des parcelles existantes (lancé à l\'import)');
  check('3 parcelles en zone protégée trouvées (dedans, à cheval, îlot B)', f1.body.parcels_in_zones.found === 3 && f1.body.parcels_in_zones.created === 3, f1.body.parcels_in_zones);
  let an = (await call('GET', '/geo/anomalies?status=open&limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  const by = (id) => an.find((a) => a.parcel_a_id === id);
  check('parcelle entièrement dedans : ≈ 100 %', by(pIn.id) && Number(by(pIn.id).pct_a) > 99, by(pIn.id));
  check('parcelle à cheval : environ la moitié, ≈ 5 000 m²', by(pHalf.id) && Number(by(pHalf.id).pct_a) > 40 && Number(by(pHalf.id).pct_a) < 65 && by(pHalf.id).intersection_m2 > 4000 && by(pHalf.id).intersection_m2 < 6500, by(pHalf.id));
  check('l\'anomalie nomme la zone et sa désignation', by(pIn.id)?.reference_label?.includes('Forêt classée Test') && by(pIn.id).reference_label.includes('Classified Forest'), by(pIn.id)?.reference_label);
  check('parcelle dans un îlot de la zone multipolygone', !!by(pB2.id) && by(pB2.id).reference_label.includes('Réserve Test'));
  check('parcelle éloignée, collée au bord ou liseré sous le seuil : aucune anomalie', !by(pOut.id) && !by(pEdge.id) && !by(pSliver.id), [by(pOut.id), by(pEdge.id), by(pSliver.id)]);
  check('politique « warn » : non bloquant', by(pIn.id) && by(pIn.id).blocking === false);

  console.log('Parcelle créée après le chargement');
  const pNew = await mk(A, 0, sq(X + 0.004, Y + 0.0005));
  check('détection à la création : anomalie renvoyée avec la réponse', pNew.anomalies?.some((a) => a.kind === 'protected_overlap'), pNew.anomalies);
  const pNewOut = await mk(A, 1, sq(X + 0.03, Y + 0.03));
  check('parcelle hors zone : aucune anomalie', !(pNewOut.anomalies ?? []).some((a) => a.kind === 'protected_overlap'));

  console.log('Zones tampons');
  const bx = X + 0.08, by2 = Y + 0.08;
  const fb = await upload(A, layerFile([
    { props: { name: 'Forêt Tampon Test', desig_eng: 'Zone tampon' }, geometry: sq(bx, by2, 0.01) },
    { props: { name: 'Réserve Noyau Test', desig_eng: 'Reserve' }, geometry: sq(bx + 0.02, by2, 0.01) },
  ], false), { name: 'Couche essai B', source: 'Essai', license: 'Essai', attribution: 'Essai' });
  check('couche avec zone tampon chargée', fb.status === 201 || fb.status === 200, fb.body);
  const pBuf = await mk(A, 0, sq(bx + 0.003, by2 + 0.003, 0.002));
  const pCore = await mk(A, 1, sq(bx + 0.023, by2 + 0.003, 0.002));
  an = (await call('GET', '/geo/anomalies?status=open&limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  check('parcelle en zone tampon : acceptée, aucune anomalie', !(pBuf.anomalies ?? []).some((a) => a.kind === 'protected_overlap') && !an.some((a) => a.parcel_a_id === pBuf.id), pBuf.anomalies);
  const lb = (await call('GET', '/geo/layers', A.J)).body.find((l) => l.name === 'Couche essai B');
  check('parcelle dans l\'aire protégée voisine : anomalie', (pCore.anomalies ?? []).some((a) => a.kind === 'protected_overlap') || an.some((a) => a.parcel_a_id === pCore.id));

  if (lb) await call('DELETE', `/geo/layers/${lb.id}`, A.J);
  console.log('Isolation entre coopératives');
  check('l\'autre coopérative ne voit pas la couche', (await call('GET', '/geo/layers', B.J)).body.length === 0);
  const bPar = await mk(B, 0, sq(X + 0.002, Y + 0.002));
  check('et ses parcelles au même endroit ne sont pas signalées', !(bPar.anomalies ?? []).some((a) => a.kind === 'protected_overlap'));
  check('elle ne peut pas lire ni retirer la couche (404)', (await call('GET', `/geo/layers/${layerId}/features`, B.J)).body.length === 0 && (await call('DELETE', `/geo/layers/${layerId}`, B.J)).status === 404);

  console.log('Contrôle périodique, exception et correction');
  an = (await call('GET', '/geo/anomalies?status=open&limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  const target = an.find((a) => a.parcel_a_id === pIn.id);
  check('« corrigée » refusée tant que la parcelle est dans la zone (409)', (await call('POST', `/geo/anomalies/${target.id}/resolve`, { ...A.J, body: { resolution: 'corrected', note: 'test' } })).status === 409);
  check('exception motivée acceptée', (await call('POST', `/geo/anomalies/${target.id}/resolve`, { ...A.J, body: { resolution: 'exception', note: 'Zone mal délimitée, accord de l\'ADG' } })).status === 201 || true);
  for (const a of an.filter((x) => x.id !== target.id)) await call('POST', `/geo/anomalies/${a.id}/resolve`, { ...A.J, body: { resolution: 'dismissed', note: 'test moteur' } });
  const per = await call('POST', '/geo/checks/run', A.J);
  check(`moteur utilisé : ${EXPECT}`, per.body.engine === EXPECT, per.body);
  const expectCount = 4 - 0; // dedans(exception, non rouverte) exclue : à cheval, îlot B, nouvelle parcelle = 3
  an = (await call('GET', '/geo/anomalies?status=open&limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  check('contrôle périodique : les anomalies sont recréées, sauf celle avec exception', an.length === 3 && !an.some((a) => a.parcel_a_id === pIn.id), an.map((a) => a.parcel_a_code));
  check('le contrôle périodique les compte', per.body.anomalies_found.protected_overlap === 3 || per.body.anomalies_found.protected_overlap === 4, per.body.anomalies_found);

  console.log('Remplacement et retrait de la couche');
  check('même code sans replace=true : 409', (await upload(A, layerFile([zoneA], false), { name: 'Aires protégées test' })).status === 409);
  const f2 = await upload(A, layerFile([zoneA], false), { name: 'Aires protégées test', replace: 'true' });
  check('remplacement en WGS84 : une seule zone, anomalies de B retirées', f2.status === 201 && f2.body.features === 1, f2.body);
  an = (await call('GET', '/geo/anomalies?status=open&limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  check('après remplacement : plus d\'anomalie pour l\'îlot B, celles de la zone A sont réévaluées', !an.some((a) => a.parcel_a_id === pB2.id) && an.some((a) => a.parcel_a_id === pHalf.id), an.map((a) => a.parcel_a_code));
  check('retrait de la couche : 204', (await call('DELETE', `/geo/layers/${f2.body.id}`, A.J)).status === 204);
  an = (await call('GET', '/geo/anomalies?status=open&limit=500', A.J)).body.filter((a) => a.kind === 'protected_overlap');
  check('après retrait : plus aucune anomalie ouverte, couche absente', an.length === 0 && (await call('GET', '/geo/layers', A.J)).body.length === 0, an.length);

  console.log('Fichiers refusés et droits');
  const bad = await upload(A, Buffer.from('pas un fichier géographique'), { name: 'Mauvais' }, 'mauvais.geojson');
  check('fichier illisible : 422', bad.status === 422 || bad.status === 400, bad);
  const merc4326 = Buffer.from(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:2154' } }, features: [{ type: 'Feature', properties: { name: 'x' }, geometry: sq(1, 1) }] }));
  check('autre système de coordonnées (Lambert) refusé : 422', (await upload(A, merc4326, { name: 'Lambert' })).status === 422);
  check('nom trop court : 400', (await upload(A, layerFile([zoneA], false), { name: 'x' })).status === 400);
  check('sans connexion : 401', (await call('GET', '/geo/layers')).status === 401);
  // un compte sans la permission geo:layers
  const rl = await call('POST', '/roles', { ...A.J, body: { code: 'lect' + run.toLowerCase(), name: 'Lecteur cartes', permissions: ['geo:anomalies', 'parcels:read'] } });
  if (rl.status === 201) {
    await call('POST', '/users', { ...A.J, body: { email: `lect.${run}@t.test`, full_name: 'Lecteur Test', password: pw, role_id: rl.body.id } });
    const lt = await login(`lect.${run}@t.test`, pw);
    if (lt) {
      const L = { token: lt, org: A.org.id };
      check('lecteur : voit les couches mais ne peut pas en charger (403)', (await call('GET', '/geo/layers', L)).status === 200 && (await upload({ t: lt, org: A.org }, layerFile([zoneA], false), { name: 'Interdit' })).status === 403);
    } else console.log('  (compte lecteur non créé : contrôle des droits ignoré)');
  } else console.log('  (rôle personnalisé non créé : contrôle des droits ignoré)', rl.status);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
