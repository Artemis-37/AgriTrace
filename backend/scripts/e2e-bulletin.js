// Test de bout en bout : convoi du collecteur -> réception au magasin central -> traitement en caisse -> compte du collecteur.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'BP' + run, name: 'BP' + run } })).body;
  const mail = `bp.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });
  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(t0), body: { code, name: code, permissions } })).body;
  const rCol = await role('collecteur', ['convoys:create', 'convoys:read', 'sync:use', 'collector:stock', 'producers:read']);
  const rMag = await role('magasinier', ['convoys:receive', 'convoys:read', 'sync:use', 'cancellations:request']);
  const rCai = await role('caissier', ['convoys:settle', 'convoys:read', 'finance:read', 'cash:operate']);
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email, pw) }; };
  const c1 = await user('kouame', rCol), c2 = await user('yao', rCol), mag = await user('magasinier', rMag), cai = await user('caissier', rCai);
  const col1 = (await call('POST', '/collectors', { ...J(t0), body: { user_id: c1.id } })).body;
  const col2 = (await call('POST', '/collectors', { ...J(t0), body: { user_id: c2.id } })).body;
  const wh = (await call('POST', '/warehouses', { ...J(t0), body: { code: 'MC', name: 'Magasin central' } })).body;
  check('mise en place', !!(col1.id && col2.id && wh.id));
  const mkConvoy = async (no, extra = {}) => (await call('POST', '/convoys', { ...J(c1.t), body: { idempotency_key: key('cv'), convoy_no: no, driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', declared_bags: 40, declared_kg: '39900', ...extra } })).body;
  const rec = (no, extra) => call('POST', '/convoys/receive', { ...J(mag.t), body: { idempotency_key: key('rc'), collector_id: col1.id, convoy_no: no, warehouse_id: wh.id, bags: 40, ...extra } });
  console.log('Bulletin de pesée');
  await mkConvoy('BP-1');
  check('entrée sans sortie refusée', (await rec('BP-1', { weigh_in_kg: '52000' })).status === 400);
  check('sortie supérieure à l’entrée refusée', (await rec('BP-1', { weigh_in_kg: '12000', weigh_out_kg: '12500' })).status === 400);
  check('net incohérent avec total_kg refusé', (await rec('BP-1', { weigh_in_kg: '52000', weigh_out_kg: '12000', total_kg: '39000' })).status === 400);
  check('sacs refusés > déchargés refusé', (await rec('BP-1', { total_kg: '39900', bags_unloaded: 3, bags_refused: 5 })).status === 400);
  const r = await rec('BP-1', { weigh_in_kg: '52000', weigh_out_kg: '12000', bag_tare_kg: '20', refaction_kg: '100', grade: 'GRADE 1', trailer_no: 'RM 55', origin: 'Zone A', bags_unloaded: 40, bags_refused: 0, analysis: { 'Humidité': '7.5' }, notes: 'RAS' });
  check('réception avec double pesée', r.status === 201 && Number(r.body.total_kg) === 39880 && Number(r.body.gross_kg) === 40000 && /^BP-\d{4}-000001$/.test(r.body.bulletin_no), r.body);
  const p = await call('GET', `/operation-receipts/convoy_reception/${r.body.id}`, J(mag.t));
  const b = p.body.bulletin || {};
  check('bulletin : poids en kg entiers, espace pour les milliers, sans virgule', b.gross === '40\u202f000' && b.net === '39\u202f880' && b.weigh_in === '52\u202f000' && b.refaction === '100' && p.body.lines.every((l) => !l.value.includes(',')), b);
  check('lignes du reçu sans « .000 » ni virgule', p.body.lines.some((l) => l.label === 'Poids reçu' && l.value === '39\u202f880 kg'), p.body.lines);
  check('analyse et visas conservés', b.analysis['Humidité'] === '7.5' && b.grade === 'GRADE 1' && b.trailer === 'RM 55', b);
  await mkConvoy('BP-2');
  const r2 = await rec('BP-2', { total_kg: '39900' });
  check('réception simple : bulletin sans pesées, numéro suivant', r2.status === 201 && r2.body.bulletin_no.endsWith('000002') && r2.body.gross_kg == null, r2.body);
  const b2 = (await call('GET', `/operation-receipts/convoy_reception/${r2.body.id}`, J(mag.t))).body.bulletin;
  check('bulletin simple : champs absents = null', b2.weigh_in === null && b2.net === '39\u202f900', b2);
  const pa = await call('PATCH', `/convoys/receptions/${r2.body.id}/analysis`, { ...J(mag.t), body: { analysis: { Humidité: '8.1', Crabots: '2.0' }, grade: 'GRADE 2' } });
  check('analyse saisie après la pesée', pa.status === 200, pa.body);
  const b3 = (await call('GET', `/operation-receipts/convoy_reception/${r2.body.id}`, J(mag.t))).body.bulletin;
  check('bulletin : analyse et grade mis à jour, net inchangé', b3.analysis.Humidité === '8.1' && b3.grade === 'GRADE 2' && b3.net === '39\u202f900', b3);
  check('analyse invalide refusée', (await call('PATCH', `/convoys/receptions/${r2.body.id}/analysis`, { ...J(mag.t), body: { analysis: { X: '12345678901' } } })).status === 400);
  check('le collecteur ne peut pas saisir l’analyse', (await call('PATCH', `/convoys/receptions/${r2.body.id}/analysis`, { ...J(c1.t), body: { analysis: {} } })).status === 403);
  const lst = await call('GET', '/convoys/receptions/recent', J(mag.t));
  check('liste des réceptions récentes', lst.status === 200 && lst.body.length === 2, lst.body);
  console.log(`\n${ok} ok, ${ko} ko`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
