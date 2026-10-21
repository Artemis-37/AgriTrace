// Moteur géospatial : mêmes classements et mêmes ordres de grandeur avec PostGIS et avec le repli Node.
// À lancer contre l'API en mode voulu : EXPECT_ENGINE=postgis (base avec PostGIS) ou EXPECT_ENGINE=js (GEO_ENGINE=js ou base sans PostGIS).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const EXPECT = process.env.EXPECT_ENGINE || 'postgis';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const sq = (lon, lat, s = 0.0009) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
const r7 = (n) => Math.round(n * 1e7) / 1e7;

(async () => {
  const pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'PG' + run, name: 'PG' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `pg.${run}@t.test`, full_name: 'Chef', password: pw } });
  const t = await login(`pg.${run}@t.test`, pw);
  const J = { token: t, org: org.id };
  const vc = (await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao' } })).body;
  const prods = [];
  for (let i = 0; i < 2; i++) prods.push((await call('POST', '/producers', { ...J, body: { last_name: 'NOM' + i, first_names: 'P' + i, village: 'Hiré', section: 'S1', region: 'Gôh', value_chain_ids: [vc.id] } })).body.producer);
  await call('PUT', '/geo/settings', { ...J, body: { overlap_min_m2: 25, overlap_min_pct: 1, near_duplicate_iou: 0.95, overlap_policy: 'warn' } });
  const X = -5.6 + (parseInt(run, 16) % 1000) / 100000, Y = 6.9 + (parseInt(run.split('').reverse().join(''), 16) % 1000) / 100000;
  const mk = async (prod, geometry) => (await call('POST', '/parcels', { ...J, body: { idempotency_key: 'pg-' + run + '-' + crypto.randomBytes(4).toString('hex'), producer_id: prods[prod].id, value_chain_id: vc.id, declared_area_ha: '1', geometry, confirm_not_duplicate: true } })).body;

  console.log(`Scénarios (moteur attendu : ${EXPECT})`);
  const S = [];  // { name, a, b, expect }
  const pair = async (name, off, ga, gb, expectKind) => { const a = await mk(0, ga(X + off, Y)); const b = await mk(1, gb(X + off, Y)); S.push({ name, a, b, expect: expectKind }); };
  await pair('tracés identiques', 0.00, (x, y) => sq(x, y), (x, y) => sq(x, y), 'duplicate_identical');
  const ring = (x, y) => sq(x, y).coordinates[0].slice(0, -1);
  await pair('même tracé, autre point de départ et sens inverse', 0.01, (x, y) => sq(x, y),
    (x, y) => { const r = ring(x, y).reverse(); const rot = [...r.slice(2), ...r.slice(0, 2)]; return { type: 'Polygon', coordinates: [[...rot, rot[0]]] }; }, 'duplicate_equivalent');
  await pair('presque identiques (décalage ~1 m)', 0.02, (x, y) => sq(x, y), (x, y) => sq(r7(x + 0.00001), y), 'duplicate_near');
  await pair('chevauchement partiel', 0.03, (x, y) => sq(x, y), (x, y) => sq(r7(x + 0.0005), y), 'overlap_partial');
  await pair('inclusion', 0.04, (x, y) => sq(x, y), (x, y) => sq(r7(x + 0.0003), r7(y + 0.0003), 0.0003), 'overlap_inclusion');
  await pair('limite commune seulement', 0.05, (x, y) => sq(x, y), (x, y) => sq(r7(x + 0.0009), y), null);
  await pair('recouvrement sous les seuils (~20 m²)', 0.06, (x, y) => sq(x, y), (x, y) => sq(r7(x + 0.0009 - 0.000002), y), null);
  await pair('parcelles éloignées', 0.07, (x, y) => sq(x, y), (x, y) => sq(r7(x + 0.01), y), null);

  const listAnoms = async (status) => (await call('GET', `/geo/anomalies?${status ? 'status=' + status + '&' : ''}limit=500`, J)).body;
  const kindFor = (anoms, s) => anoms.find((a) => (a.parcel_a_id === s.a.id && a.parcel_b_id === s.b.id) || (a.parcel_a_id === s.b.id && a.parcel_b_id === s.a.id));

  console.log('Détection à l\'enregistrement d\'une parcelle');
  let anoms = await listAnoms('open');
  for (const s of S) {
    const f = kindFor(anoms, s);
    check(`${s.name} : ${s.expect ?? 'aucune anomalie'}`, (f?.kind ?? null) === s.expect, f);
  }
  const partial = kindFor(anoms, S[3]);
  check('intersection du chevauchement partiel : ordre de grandeur (≈ 4 400 m²)', partial && partial.intersection_m2 > 4300 && partial.intersection_m2 < 4550, partial?.intersection_m2);
  const incl = kindFor(anoms, S[4]);
  check('inclusion : la parcelle incluse est couverte à 100 %', incl && Math.max(Number(incl.pct_a), Number(incl.pct_b)) > 99.9, incl);

  console.log('Contrôle périodique (anomalies classées sans suite, puis recalculées)');
  for (const a of anoms) await call('POST', `/geo/anomalies/${a.id}/resolve`, { ...J, body: { resolution: 'dismissed', note: 'test moteur' } });
  const per = await call('POST', '/geo/checks/run', J);
  check(`moteur utilisé : ${EXPECT}`, per.body.engine === EXPECT, per.body);
  const expected = S.filter((s) => s.expect).length;
  check(`${expected} anomalies retrouvées par le contrôle périodique`, per.body.new_anomalies === expected, per.body);
  anoms = await listAnoms('open');
  for (const s of S) {
    const f = kindFor(anoms, s);
    check(`périodique — ${s.name} : ${s.expect ?? 'aucune anomalie'}`, (f?.kind ?? null) === s.expect, f);
  }
  const partial2 = kindFor(anoms, S[3]);
  check('périodique — intersection du chevauchement partiel cohérente', partial2 && Math.abs(partial2.intersection_m2 - partial.intersection_m2) / partial.intersection_m2 < 0.01, [partial2?.intersection_m2, partial.intersection_m2]);

  console.log('Comparaison de deux parcelles enregistrées');
  const cmp = await call('POST', `/geo/anomalies/${partial2.id}/resolve`, { ...J, body: { resolution: 'corrected', note: 'test' } });
  check('« corrigée » refusée tant que le chevauchement subsiste (409)', cmp.status === 409, cmp.body);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
