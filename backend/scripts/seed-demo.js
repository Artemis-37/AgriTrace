// Données de démonstration (coopérative fictive) pour explorer le portail. NE PAS exécuter en production.
// Usage : API=http://localhost:3000/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... DEMO_PASSWORD=... node scripts/seed-demo.js
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 12) { console.error('DEMO_PASSWORD (12 caractères minimum) requis'); process.exit(1); }
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${t.slice(0, 200)}`);
  return j;
}
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).access_token;
  const org = await call('POST', '/organizations', { token: adm, body: { code: 'DEMO' + run, name: 'Coopérative Démo de Hiré' } });
  const email = `demo.${run.toLowerCase()}@agritrace.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email, full_name: 'Administrateur Démo', password: DEMO_PASSWORD } });
  const t = (await call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } })).access_token;
  const J = { token: t, org: org.id };

  const vc = await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao' } });
  await call('POST', '/unit-conversions', { ...J, body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = await call('POST', '/campaigns', { ...J, body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne 2025-2026', starts_on: '2025-10-01', ends_on: '2026-09-30' } });
  const sched = await call('POST', '/price-schedules', { ...J, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } });
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J, body: { unit_price: '1000', valid_from: '2025-10-01' } });

  const names = [['KONE', 'Awa', 'Hiré'], ['TRAORE', 'Moussa', 'Zoukougbeu'], ['YAO', 'Kouadio', 'Hiré'], ['KOUASSI', 'Adjoua', 'Tiassalé'], ['BAMBA', 'Seydou', 'Hiré'], ['DIALLO', 'Fatoumata', 'Zoukougbeu'],
    ['N\'GUESSAN', 'Affoué', 'Hiré'], ['OUATTARA', 'Ibrahim', 'Tiassalé'], ['KOFFI', 'Yves', 'Hiré'], ['SANGARE', 'Mariam', 'Zoukougbeu']];
  const producers = [];
  for (const [l, f, v] of names) producers.push((await call('POST', '/producers', { ...J, body: { last_name: l, first_names: f, village: v, section: v === 'Hiré' ? 'S1' : 'S2', phone: '+22507' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), value_chain_ids: [vc.id] } })).producer);

  const wh = await call('POST', '/warehouses', { ...J, body: { code: 'MAG1', name: 'Magasin principal' } });
  const role = await call('POST', '/roles', { ...J, body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use'] } });
  const cu = await call('POST', '/users', { ...J, body: { email: `collecteur.${run.toLowerCase()}@agritrace.test`, full_name: 'Collecteur Démo', password: DEMO_PASSWORD, role_id: role.id } });
  const col = await call('POST', '/collectors', { ...J, body: { user_id: cu.id } });
  await call('POST', `/collectors/${col.id}/assignments`, { ...J, body: { value_chain_id: vc.id } });
  const tc = (await call('POST', '/auth/login', { body: { email: `collecteur.${run.toLowerCase()}@agritrace.test`, password: DEMO_PASSWORD } })).access_token;

  const decls = [];
  for (let i = 0; i < 8; i++) {
    const id = crypto.randomUUID();
    await call('POST', '/purchase-declarations', { token: tc, org: org.id, body: { id, idempotency_key: key('decl'), producer_id: producers[i].id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: days(-10 + i), quantity: String(2 + (i % 3)), unit: 'sac', bags: 2 + (i % 3), purchase_receipt_no: 'DEMO-' + String(i + 1).padStart(4, '0') } });
    if (i < 7) await call('POST', `/purchase-declarations/${id}/submit`, { token: tc, org: org.id });
    decls.push(id);
  }
  let lotId;
  for (let i = 0; i < 5; i++) {
    await call('POST', `/purchase-declarations/${decls[i]}/transition`, { ...J, body: { to: 'in_review' } });
    await call('POST', `/purchase-declarations/${decls[i]}/transition`, { ...J, body: { to: 'accepted' } });
    const declared = (2 + (i % 3)) * 65;
    const w = await call('POST', '/weighings', { ...J, body: { idempotency_key: key('w'), declaration_id: decls[i], warehouse_id: wh.id, gross_kg: String(declared + 5), tare_kg: '5' } });
    const r = await call('POST', '/receipts', { ...J, body: { weighing_id: w.id, ...(lotId ? { lot_id: lotId } : {}) } });
    lotId = lotId ?? r.lot_id;
  }

  const reg = await call('POST', '/cash-registers', { ...J, body: { name: 'principale' } });
  const rCS = await call('POST', '/roles/standard', { ...J, body: { code: 'caissier' } });
  await call('POST', '/users', { ...J, body: { email: `caisse.${run.toLowerCase()}@agritrace.test`, full_name: 'Caissier Démo', password: DEMO_PASSWORD, role_id: rCS.id } });
  const tCS = (await call('POST', '/auth/login', { body: { email: `caisse.${run.toLowerCase()}@agritrace.test`, password: DEMO_PASSWORD } })).access_token;
  const sess = await call('POST', `/cash-registers/${reg.id}/sessions`, { token: tCS, org: org.id, body: { opening_amount: '500000' } });
  const loan = await call('POST', '/loans', { ...J, body: { idempotency_key: key('loan'), kind: 'prefinancing', borrower_type: 'producer', borrower_id: producers[0].id, amount: '90000', purpose: 'Intrants et main-d\'œuvre' } });
  console.log('Prêt demandé (approbation par un second utilisateur requise)', loan.id);
  const pay = await call('POST', '/payments', { ...J, body: { idempotency_key: key('pay'), source_account_id: reg.account_id, payee_type: 'producer', payee_id: producers[1].id, amount: '130000', method: 'cash' } });
  await call('POST', `/payments/${pay.id}/transition`, { ...J, body: { to: 'initiated' } });

  const centre = [[-5.9, 7.0], [-5.89, 7.01], [-5.91, 7.02], [-5.88, 7.0], [-5.92, 7.03], [-5.87, 7.02]];
  const parcels = [];
  for (let i = 0; i < centre.length; i++) {
    const [lon, lat] = centre[i], s = 0.0009;
    parcels.push(await call('POST', '/parcels', { ...J, body: { idempotency_key: key('parcel'), producer_id: producers[i].id, value_chain_id: vc.id, declared_area_ha: '1',
      geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] } } }));
  }
  await call('POST', '/parcels', { ...J, body: { idempotency_key: key('parcel'), producer_id: producers[6].id, value_chain_id: vc.id, declared_area_ha: '2.5' } });
  await call('POST', `/parcels/${parcels[0].id}/control`, { ...J, body: {} });

  const rule = await call('POST', '/quality-rules', { ...J, body: { code: 'HUMIDITE', label: 'Humidité (%)', kind: 'numeric', max_value: '8', unit: '%', blocking: true, value_chain_id: vc.id } });
  const insp = await call('POST', '/inspections', { ...J, body: { idempotency_key: key('insp'), subject_type: 'lot', subject_id: lotId, kind: 'quality' } });
  await call('POST', `/inspections/${insp.id}/start`, J);
  await call('POST', `/inspections/${insp.id}/results`, { ...J, body: { results: [{ rule_id: rule.id, value_num: '7.2' }] } });
  await call('POST', `/inspections/${insp.id}/complete`, { ...J, body: { summary: 'Humidité conforme' } });
  await call('POST', '/certificates', { ...J, body: { holder_type: 'organization', scheme: 'Rainforest Alliance (exemple)', number: 'DEMO-' + run, issuer: 'Organisme fictif', issued_on: days(-340), expires_on: days(25) } });

  console.log(`\nCoopérative de démonstration créée : ${org.name}\n  Administrateur : ${email}\n  Collecteur     : collecteur.${run.toLowerCase()}@agritrace.test\n  Mot de passe   : (DEMO_PASSWORD)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
