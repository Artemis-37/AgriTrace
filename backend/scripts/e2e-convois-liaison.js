// Test de bout en bout : liaison d'un convoi à des achats précis (poids annoncé déduit, une seule fois chacun, périmètre du collecteur).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload; if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const sq = (lon, lat, s = 0.0009) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });

(async () => {
  const pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const A = (await call('POST', '/organizations', { token: adm, body: { code: 'CL' + run, name: 'CL' + run } })).body;
  await call('POST', `/organizations/${A.id}/admins`, { token: adm, body: { email: `a1.${run}@t.test`, full_name: 'Admin', password: pw } });
  const t1 = await login(`a1.${run}@t.test`, pw);
  const J = (t) => ({ token: t, org: A.id });
  const vc = (await call('POST', '/value-chains', { ...J(t1), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const camp = (await call('POST', '/campaigns', { ...J(t1), body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne', starts_on: '2025-10-01', ends_on: '2026-09-30' } })).body;
  const sched = (await call('POST', '/price-schedules', { ...J(t1), body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).body;
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J(t1), body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const p1 = (await call('POST', '/producers', { ...J(t1), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const wh = (await call('POST', '/warehouses', { ...J(t1), body: { code: 'MAG1', name: 'Magasin 1' } })).body;
  const rCol = (await call('POST', '/roles', { ...J(t1), body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use', 'convoys:create', 'convoys:read'] } })).body;
  const rMag = (await call('POST', '/roles', { ...J(t1), body: { code: 'magasinier', name: 'Magasinier', permissions: ['convoys:receive', 'convoys:read'] } })).body;
  const mk = async (tag) => { const u = (await call('POST', '/users', { ...J(t1), body: { email: `${tag}.${run}@t.test`, full_name: tag, password: pw, role_id: rCol.id } })).body; const k = (await call('POST', '/collectors', { ...J(t1), body: { user_id: u.id } })).body; await call('POST', `/collectors/${k.id}/assignments`, { ...J(t1), body: { value_chain_id: vc.id } }); return { k, t: await login(`${tag}.${run}@t.test`, pw) }; };
  const c1 = await mk('c1'), c2 = await mk('c2');
  await call('POST', '/users', { ...J(t1), body: { email: `mag.${run}@t.test`, full_name: 'mag', password: pw, role_id: rMag.id } });
  const tmag = await login(`mag.${run}@t.test`, pw);
  const decl = (extra = {}) => ({ id: crypto.randomUUID(), idempotency_key: key('d'), producer_id: p1.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', quantity: '100', unit: 'kg', bags: 2, ...extra });
  const mkd = async (c, q, bags, n) => { const d = decl({ quantity: q, bags, purchase_receipt_no: 'LC' + run + n }); const r = await call('POST', '/purchase-declarations', { ...J(c.t), body: d }); if (r.status !== 201) console.log('décl', r.status, JSON.stringify(r.body).slice(0, 200)); const sb = await call('POST', `/purchase-declarations/${d.id}/submit`, { ...J(c.t), body: {} }); if (sb.status >= 300) console.log('submit', sb.status, JSON.stringify(sb.body).slice(0, 200)); return r.body; };
  const d1 = await mkd(c1, '100', 2, 1), d2 = await mkd(c1, '250', 5, 2), d3 = await mkd(c2, '80', 2, 3);
  console.log('Liaison convoi / achats');
  const av = await call('GET', '/convoys/available-declarations', J(c1.t));
  check('achats disponibles : les deux achats du collecteur, pas ceux d\'un autre', Array.isArray(av.body) && av.body.length === 2 && av.body.every((x) => [d1.id, d2.id].includes(x.id)), av.body);
  const base = (no, ids, extra = {}) => ({ idempotency_key: key('cv'), convoy_no: no, driver_name: 'Koffi', truck_no: 'ab 1 ci', declaration_ids: ids, ...extra });
  const bad1 = await call('POST', '/convoys', { ...J(c1.t), body: base('L-1', [d3.id]) });
  check('achat d\'un autre collecteur refusé', bad1.status === 400, bad1.body);
  const bad2 = await call('POST', '/convoys', { ...J(c1.t), body: base('L-2', [crypto.randomUUID()]) });
  check('achat inconnu refusé', bad2.status === 400, bad2.body);
  const cv = await call('POST', '/convoys', { ...J(c1.t), body: base('L-3', [d1.id, d2.id, d1.id]) });
  check('convoi créé avec ses achats : poids et sacs annoncés déduits (350 kg, 7 sacs)', cv.status === 201 && Number(cv.body.declared_kg) === 350 && cv.body.declared_bags === 7, cv.body);
  const rp = await call('POST', '/convoys', { ...J(c1.t), body: { ...base('L-3', [d1.id, d2.id]), idempotency_key: cv.body.idempotency_key } });
  check('renvoi de la même clé : même convoi, pas de doublon', rp.body.id === cv.body.id, rp.body);
  const bad3 = await call('POST', '/convoys', { ...J(c1.t), body: base('L-4', [d1.id]) });
  check('un achat déjà chargé ne part pas dans un second convoi (409)', bad3.status === 409, bad3.body);
  check('plus aucun achat disponible', (await call('GET', '/convoys/available-declarations', J(c1.t))).body.length === 0);
  const dl = await call('GET', `/convoys/${cv.body.id}/declarations`, J(tmag));
  check('le magasinier voit le contenu du convoi (2 achats, 350 kg)', Array.isArray(dl.body) && dl.body.length === 2 && dl.body.reduce((a, x) => a + Number(x.kg), 0) === 350, dl.body);
  check('un autre collecteur ne voit pas ce convoi (404)', (await call('GET', `/convoys/${cv.body.id}/declarations`, J(c2.t))).status === 404);
  const ex = await call('GET', '/convoys/expected', J(tmag));
  check('convois attendus : nombre d\'achats liés', ex.body.find((x) => x.id === cv.body.id)?.declaration_count === 2, ex.body);
  const manual = await call('POST', '/convoys', { ...J(c2.t), body: base('L-5', [d3.id], { declared_kg: '90', declared_bags: 3 }) });
  check('poids annoncé saisi à la main conservé', manual.status === 201 && Number(manual.body.declared_kg) === 90 && manual.body.declared_bags === 3, manual.body);
  const free = await call('POST', '/convoys', { ...J(c2.t), body: { idempotency_key: key('cv'), convoy_no: 'L-6', driver_name: 'Ko', truck_no: 'ZZ 1' } });
  check('un convoi reste possible sans achats liés', free.status === 201 && free.body.declared_kg == null, free.body);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
