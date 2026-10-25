// Tout produit créé par la coopérative est lié à tous ses producteurs ; un producteur créé sans produit est lié à tous les produits.
//   API=http://localhost:3000/v1 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-produits-producteurs.js
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x ?? ''); } };
async function call(method, path, { token, org, body } = {}) {
  const headers = { 'x-client': 'web' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, body: j };
}
(async () => {
  const PW = 'MotDePasseSolide2026!';
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'PRD' + run, name: 'Coop produits ' + run} })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `a${run}@prd.test`, full_name: 'Admin Produits', password: PW } });
  const t = (await call('POST', '/auth/login', { body: { email: `a${run}@prd.test`, password: PW } })).body.access_token;
  const O = { token: t, org: org.id };
  const c1 = (await call('POST', '/value-chains', { ...O, body: { code: 'CACAO', name: 'Cacao' } })).body;
  const mk = (n, extra = {}) => call('POST', '/producers', { ...O, body: { last_name: 'Kouadio', first_names: 'Test ' + n, village: 'Hiré', section: 'S1', region: 'Gôh', consent: true, ...extra } });
  const r1 = await mk(1); if (!r1.body.producer) console.log(r1.status, JSON.stringify(r1.body).slice(0,300)); const p1 = r1.body.producer;
  const list = async () => (await call('GET', '/producers', O)).body;
  const get = async (id) => (Array.isArray(await list()) ? await list() : (await list()).items).find((p) => p.id === id);
  check('producteur sans produit indiqué : lié à tous les produits', (await get(p1.id)).value_chain_ids.includes(c1.id), await get(p1.id));
  const c2 = (await call('POST', '/value-chains', { ...O, body: { code: 'CAFE', name: 'Café' } })).body;
  check('nouveau produit : lié aux producteurs existants', (await get(p1.id)).value_chain_ids.includes(c2.id));
  const p2 = (await mk(2, { value_chain_ids: [c1.id] })).body.producer;
  check('produit choisi explicitement : respecté', (await get(p2.id)).value_chain_ids.length === 1);
  console.log(`\n${ok} réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
