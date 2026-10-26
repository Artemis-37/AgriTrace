// Test de bout en bout : la synchronisation envoie à chaque profil seulement ce qu'il utilise
// (délégué acheteur, agent de terrain, personnel) et le délégué ne voit que les producteurs de ses filières.
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
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const sq = (lon, lat, s = 0.0009) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'SP' + run, name: 'SP' + run } })).body;
  const mail = `sp.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
  const t = await login(mail, pw);
  const J = (tok = t) => ({ token: tok, org: org.id });

  const cacao = (await call('POST', '/value-chains', { ...J(), body: { code: 'CACAO', name: 'Cacao', default_unit: 'kg' } })).body;
  const cafe = (await call('POST', '/value-chains', { ...J(), body: { code: 'CAFE', name: 'Café', default_unit: 'kg' } })).body;
  await call('POST', '/campaigns', { ...J(), body: { value_chain_id: cacao.id, code: 'C26', name: 'Campagne', starts_on: '2025-10-01', ends_on: '2026-12-31' } });
  const pCacao = (await call('POST', '/producers', { ...J(), body: { last_name: 'CACAO', first_names: 'A', village: 'Hiré', value_chain_ids: [cacao.id] } })).body.producer;
  const pCafe = (await call('POST', '/producers', { ...J(), body: { last_name: 'CAFE', first_names: 'B', village: 'Hiré', value_chain_ids: [cafe.id] } })).body.producer;
  await call('POST', '/parcels', { ...J(), body: { idempotency_key: 'sp-' + run, producer_id: pCacao.id, value_chain_id: cacao.id, declared_area_ha: '1', geometry: sq(-5.5, 6.1) } });

  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(), body: { code, name: code, permissions } })).body;
  const user = async (tag, r) => {
    const email = `${tag}.${run}@t.test`;
    const u = (await call('POST', '/users', { ...J(), body: { email, full_name: tag, password: pw, role_id: r.id } })).body;
    return { id: u.id, t: await login(email, pw) };
  };
  const rDel = await role('delegue', ['products:read', 'declarations:create', 'declarations:read', 'producers:read', 'convoys:create', 'convoys:read', 'collector:stock', 'messages:use', 'sync:use']);
  const rCoach = await role('agent', ['producers:read', 'producers:create', 'producers:update', 'parcels:read', 'parcels:create', 'field_records:create', 'field_records:read', 'messages:use', 'sync:use']);
  const del = await user('del', rDel), coach = await user('coach', rCoach);
  const col = (await call('POST', '/collectors', { ...J(), body: { user_id: del.id } })).body;
  await call('POST', `/collectors/${col.id}/assignments`, { ...J(), body: { value_chain_id: cacao.id } });

  const feed = async (tok) => (await call('GET', '/sync/changes?limit=1000', J(tok))).body;
  const d = await feed(del.t), c = await feed(coach.t), admin = await feed(t);
  const keys = ['value_chains', 'campaigns', 'unit_conversions', 'price_versions', 'producers', 'parcels', 'my_assignments', 'declarations', 'tasks', 'notifications', 'operation_results'];

  console.log('Délégué acheteur');
  check('toutes les clés sont présentes (listes vides si non concernées)', keys.every((k) => Array.isArray(d.changes[k]) && Array.isArray(c.changes[k])), Object.keys(d.changes));
  check('reçoit les campagnes, ses affectations et ses producteurs', d.changes.campaigns.length >= 1 && d.changes.my_assignments.length === 1 && d.changes.producers.length >= 1);
  check('ne reçoit que les producteurs de ses filières', d.changes.producers.some((p) => p.id === pCacao.id) && !d.changes.producers.some((p) => p.id === pCafe.id), d.changes.producers.map((p) => p.last_name));
  check('ne reçoit aucune parcelle', d.changes.parcels.length === 0);

  console.log('Agent de terrain');
  check('reçoit les producteurs et les parcelles', c.changes.producers.length === 2 && c.changes.parcels.length === 1, [c.changes.producers.length, c.changes.parcels.length]);
  check('ne reçoit ni prix, ni campagnes, ni achats, ni affectations', c.changes.campaigns.length === 0 && c.changes.price_versions.length === 0 && c.changes.declarations.length === 0 && c.changes.my_assignments.length === 0);

  console.log('Droits renvoyés');
  check('les droits courants sont toujours envoyés', Array.isArray(d.permissions) && d.permissions.includes('declarations:create') && !c.permissions.includes('declarations:create'));
  check('l\'administrateur reçoit tout ce qui le concerne', admin.changes.producers.length === 2 && admin.changes.value_chains.length === 2);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
