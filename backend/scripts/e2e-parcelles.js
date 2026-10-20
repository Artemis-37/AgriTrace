// Test de bout en bout : module parcelles (déclarée → contrôlée → vérifiée, doublons, cohérence, historique).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const d = 0.0009;
const square = (lon, lat, size = d) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]] });

(async () => {
  const pw = 'MotDePasseSolide2026!';
  console.log('Mise en place');
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (code) => (await call('POST', '/organizations', { token: adm, body: { code, name: code } })).body;
  const A = await mkOrg('PC' + run), B = await mkOrg('PD' + run);
  for (const [org, mail] of [[A, `a1.${run}@t.test`], [B, `b1.${run}@t.test`]])
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
  const t1 = await login(`a1.${run}@t.test`, pw), tb = await login(`b1.${run}@t.test`, pw);
  const J = (t, o) => ({ token: t, org: o.id });
  const vc = (await call('POST', '/value-chains', { ...J(t1, A), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const p1 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const p2 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'TRAORE', first_names: 'Moussa', village: 'Zoukougbeu', section: 'S2', value_chain_ids: [vc.id] } })).body.producer;
  check('mise en place terminée', !!(vc.id && p1.id && p2.id));

  console.log('Création');
  const k1 = key('parcel');
  const P1 = await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: k1, producer_id: p1.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: square(-6, 6.8) } });
  check('parcelle créée avec polygone : code CODE-P1, statut « declared »', P1.status === 201 && /-P1$/.test(P1.body.code) && P1.body.verification_status === 'declared', P1.body);
  check('surface mesurée calculée par le serveur (≈ 1 ha) et position déduite du polygone', Number(P1.body.geometry_area_ha) > 0.95 && Number(P1.body.geometry_area_ha) < 1.05 && Math.abs(Number(P1.body.latitude) - 6.80045) < 0.0001, P1.body);
  check('renvoi : même parcelle, pas de doublon', (await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: k1, producer_id: p1.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: square(-6, 6.8) } })).body.replayed === true);
  const dup = await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '1', latitude: 6.8005, longitude: -5.9996 } });
  check('parcelle à moins de 50 m d\'une autre → 409 avec candidats', dup.status === 409 && dup.body.candidates?.[0]?.code === P1.body.code, dup.body);
  const dupOk = await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '1', latitude: 6.8005, longitude: -5.9996, confirm_not_duplicate: true } });
  check('doublon confirmé volontairement : créée', dupOk.status === 201, dupOk.body);
  const far = await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '2.5', latitude: 6.9, longitude: -5.9 } });
  check('parcelle éloignée avec point seul : créée', far.status === 201 && far.body.geometry === null, far.body);
  const noGps = await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '3' } });
  check('parcelle sans coordonnées acceptée (signalée par les contrôles)', noGps.status === 201 && noGps.body.latitude === null);
  check('latitude sans longitude → 400', (await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '1', latitude: 6.9 } })).status === 400);
  const open = square(-5, 7); open.coordinates[0].pop();
  check('polygone non fermé → 400', (await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: open } })).status === 400);
  check('coordonnées hors bornes → 400', (await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: square(-5, 95) } })).status === 400);
  check('superficie nulle → 400', (await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '0' } })).status === 400);
  check('producteur d\'une autre coopérative → 400', (await call('POST', '/parcels', { ...J(tb, B), body: { idempotency_key: key('parcel'), producer_id: p1.id, value_chain_id: vc.id, declared_area_ha: '1' } })).status === 400);

  console.log('Contrôle');
  check('contrôle sans coordonnées → 422', (await call('POST', `/parcels/${noGps.body.id}/control`, { ...J(t1, A), body: {} })).status === 422);
  const big = (await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('parcel'), producer_id: p1.id, value_chain_id: vc.id, declared_area_ha: '0.5', geometry: square(-5.5, 7.2) } })).body;
  const ctlBad = await call('POST', `/parcels/${big.id}/control`, { ...J(t1, A), body: {} });
  check('superficie déclarée 0,5 ha vs mesurée ≈ 1 ha → 422 (incohérente)', ctlBad.status === 422 && /incohérente/.test(JSON.stringify(ctlBad.body)), ctlBad.body);
  check('vérification avant contrôle → 400', (await call('POST', `/parcels/${P1.body.id}/verify`, { ...J(t1, A), body: {} })).status === 400);
  const ctl = await call('POST', `/parcels/${P1.body.id}/control`, { ...J(t1, A), body: { note: 'Relevé GPS cohérent' } });
  check('contrôle réussi : statut « controlled »', ctl.status === 201 && ctl.body.verification_status === 'controlled', ctl.body);

  console.log('Vérification par inspection de terrain');
  const nov = await call('POST', `/parcels/${P1.body.id}/verify`, { ...J(t1, A), body: {} });
  check('vérification sans inspection conforme → 422', nov.status === 422, nov.body);
  const rule = (await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'LIMITES_VISIBLES', label: 'Limites de la parcelle matérialisées', kind: 'boolean', expected_bool: true, blocking: true } })).body;
  const insp = (await call('POST', '/inspections', { ...J(t1, A), body: { idempotency_key: key('insp'), subject_type: 'parcel', subject_id: P1.body.id, kind: 'field' } })).body;
  check('inspection de terrain planifiée sur la parcelle', insp.subject_type === 'parcel', insp);
  await call('POST', `/inspections/${insp.id}/start`, J(t1, A));
  await call('POST', `/inspections/${insp.id}/results`, { ...J(t1, A), body: { results: [{ rule_id: rule.id, value_bool: true }] } });
  const done = (await call('POST', `/inspections/${insp.id}/complete`, { ...J(t1, A), body: { summary: 'Limites conformes' } })).body;
  check('inspection conforme', done.outcome === 'compliant', done);
  const ver = await call('POST', `/parcels/${P1.body.id}/verify`, { ...J(t1, A), body: {} });
  check('vérification réussie : statut « verified », inspection référencée', ver.status === 201 && ver.body.verification_status === 'verified' && ver.body.verified_inspection_id === insp.id, ver.body);

  console.log('Modification, historique et niveaux de données');
  const upd = await call('POST', `/parcels/${P1.body.id}/update`, { ...J(t1, A), body: { declared_area_ha: '1.1' } });
  check('modification : retour à « declared », validations effacées', upd.status === 201 && upd.body.verification_status === 'declared' && upd.body.verified_at === null && upd.body.controlled_at === null, upd.body);
  check('re-vérification impossible sans nouveau contrôle → 400', (await call('POST', `/parcels/${P1.body.id}/verify`, { ...J(t1, A), body: {} })).status === 400);
  await call('POST', `/parcels/${P1.body.id}/control`, { ...J(t1, A), body: {} });
  check('ancienne inspection ne couvre pas les données modifiées → 422', (await call('POST', `/parcels/${P1.body.id}/verify`, { ...J(t1, A), body: {} })).status === 422);
  const det = (await call('GET', `/parcels/${P1.body.id}`, J(t1, A))).body;
  check('historique complet : created, controlled, verified, updated, reset, controlled', det.history.map((h) => h.event).join() === 'created,controlled,verified,updated,reset,controlled', det.history.map((h) => h.event));
  check('niveaux de données : déclarées + contrôlées, pas vérifiées', det.data_levels.declared && det.data_levels.controlled && !det.data_levels.verified && det.inspections.length === 1);
  check('modification sans champ → 400', (await call('POST', `/parcels/${P1.body.id}/update`, { ...J(t1, A), body: {} })).status === 400);

  console.log('Contrôles de qualité des données');
  const ck = (await call('GET', '/parcels/checks', J(t1, A))).body;
  check('coordonnées manquantes signalées', ck.missing_coordinates.some((x) => x.id === noGps.body.id));
  check('doublon potentiel signalé (paire à < 50 m)', ck.potential_duplicates.length === 1 && ck.potential_duplicates[0].distance_m < 50, ck.potential_duplicates);
  check('superficie incohérente signalée (0,5 déclaré vs ≈ 1 mesuré)', ck.inconsistent_area.some((x) => x.id === big.id), ck.inconsistent_area);
  check('inspections à renouveler : parcelle jamais inspectée oui, parcelle inspectée non', ck.inspections_to_renew.some((x) => x.id === far.body.id) && !ck.inspections_to_renew.some((x) => x.id === P1.body.id), ck.counts);

  console.log('Documents, archivage, isolation');
  const f = new FormData();
  f.append('file', new Blob([Buffer.from('%PDF-1.4\n% croquis\n%%EOF\n')], { type: 'application/pdf' }), 'croquis.pdf');
  f.append('subject_type', 'parcel'); f.append('subject_id', P1.body.id); f.append('kind', 'croquis');
  check('document rattaché à la parcelle', (await call('POST', '/documents', { ...J(t1, A), form: f })).status === 201);
  check('le document apparaît dans la fiche parcelle', (await call('GET', `/parcels/${P1.body.id}`, J(t1, A))).body.documents.length === 1);
  check('liste filtrée par producteur', (await call('GET', `/parcels?producer_id=${p2.id}`, J(t1, A))).body.length === 3);
  check('parcelle invisible pour une autre coopérative', (await call('GET', `/parcels/${P1.body.id}`, J(tb, B))).status === 404 && (await call('GET', '/parcels', J(tb, B))).body.length === 0);
  check('accès à A avec le jeton de B → 403', (await call('GET', '/parcels', J(tb, A))).status === 403);
  check('archivage', (await call('POST', `/parcels/${far.body.id}/archive`, J(t1, A))).body.status === 'archived');
  check('modification d\'une parcelle archivée → 400', (await call('POST', `/parcels/${far.body.id}/update`, { ...J(t1, A), body: { declared_area_ha: '9' } })).status === 400);
  check('journal d\'audit alimenté', JSON.stringify((await call('GET', '/audit-logs?limit=500', J(t1, A))).body).includes('parcel.verify'));

  // Relevé GPS fait sur le mobile hors connexion : la parcelle arrive par la synchronisation (idempotente).
  const sk = key('sync-parcel');
  const op = { idempotency_key: sk, type: 'parcel.create', payload: { idempotency_key: key('parcel'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: square(-4.2, 5.5, 0.0009), confirm_not_duplicate: true } };
  const sy = await call('POST', '/sync/batch', { ...J(t1, A), body: { operations: [op] } });
  const r1 = sy.body.results?.[0];
  check('synchronisation : parcelle relevée au GPS acceptée, surface mesurée ≈ 1 ha', r1?.status === 'accepted' && Number(r1.result?.geometry_area_ha) > 0.9 && Number(r1.result?.geometry_area_ha) < 1.1, sy.body);
  const sy2 = await call('POST', '/sync/batch', { ...J(t1, A), body: { operations: [op] } });
  const n = (await call('GET', `/parcels?producer_id=${p2.id}`, J(t1, A))).body.filter((x) => Number(x.geometry_area_ha) > 0.9 && Number(x.geometry_area_ha) < 1.1).length;
  check('synchronisation rejouée : même résultat, une seule parcelle créée', sy2.body.results?.[0]?.status === 'accepted' && sy2.body.results[0].result?.id === r1.result?.id && n === 1, { n, r: sy2.body });
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
