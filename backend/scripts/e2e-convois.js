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
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'CV' + run, name: 'CV' + run } })).body;
  const mail = `cv.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });
  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(t0), body: { code, name: code, permissions } })).body;
  const rCol = await role('collecteur', ['convoys:create', 'convoys:read', 'sync:use', 'collector:stock', 'producers:read']);
  const rMag = await role('magasinier', ['convoys:receive', 'convoys:read', 'sync:use']);
  const rCai = await role('caissier', ['convoys:settle', 'convoys:read', 'finance:read']);
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email, pw) }; };
  const c1 = await user('kouame', rCol), c2 = await user('yao', rCol), mag = await user('magasinier', rMag), cai = await user('caissier', rCai);
  const col1 = (await call('POST', '/collectors', { ...J(t0), body: { user_id: c1.id } })).body;
  const col2 = (await call('POST', '/collectors', { ...J(t0), body: { user_id: c2.id } })).body;
  const wh = (await call('POST', '/warehouses', { ...J(t0), body: { code: 'MC', name: 'Magasin central' } })).body;
  check('mise en place', !!(col1.id && col2.id && wh.id));

  console.log('Convoi du collecteur');
  const k1 = key('cv');
  const body = { idempotency_key: k1, convoy_no: 'CV-2026-001', driver_name: 'Traoré Moussa', truck_no: 'ab 1234 ci', declared_bags: 40, declared_kg: '2600' };
  const v = await call('POST', '/convoys', { ...J(c1.t), body });
  check('création du convoi par le collecteur', v.status === 201 && v.body.collector_id === col1.id && v.body.truck_no === 'AB 1234 CI' && v.body.status === 'in_transit', v.body);
  check('renvoi de la même clé : pas de doublon', (await call('POST', '/convoys', { ...J(c1.t), body })).body.id === v.body.id);
  check('n° de convoi déjà utilisé refusé', (await call('POST', '/convoys', { ...J(c2.t), body: { ...body, idempotency_key: key('cv') } })).status === 409);
  check('chauffeur et camion obligatoires', (await call('POST', '/convoys', { ...J(c1.t), body: { idempotency_key: key('cv'), convoy_no: 'CV-X' } })).status === 400);
  check('le magasinier ne peut pas déclarer un convoi', (await call('POST', '/convoys', { ...J(mag.t), body: { ...body, idempotency_key: key('cv'), convoy_no: 'CV-Y' } })).status === 403);
  check('collecteur : ne voit que ses convois', (await call('GET', '/convoys', J(c2.t))).body.length === 0 && (await call('GET', '/convoys', J(c1.t))).body.length === 1);

  console.log('Réception au magasin central');
  const exp = await call('GET', `/convoys/expected?collector_id=${col1.id}`, J(mag.t));
  check('le magasinier voit les convois attendus du collecteur', exp.body.length === 1 && exp.body[0].convoy_no === 'CV-2026-001', exp.body);
  const rk = key('rc');
  const rb = { idempotency_key: rk, collector_id: col1.id, convoy_no: 'CV-2026-001', warehouse_id: wh.id, total_kg: '2587.500', bags: 40 };
  check('mauvais collecteur : convoi introuvable', (await call('POST', '/convoys/receive', { ...J(mag.t), body: { ...rb, idempotency_key: key('rc'), collector_id: col2.id } })).status === 404);
  check('poids nul refusé', (await call('POST', '/convoys/receive', { ...J(mag.t), body: { ...rb, idempotency_key: key('rc'), total_kg: '0' } })).status === 400);
  check('le collecteur ne peut pas réceptionner', (await call('POST', '/convoys/receive', { ...J(c1.t), body: rb })).status === 403);
  const r = await call('POST', '/convoys/receive', { ...J(mag.t), body: rb });
  check('réception : poids, sacs, écart calculé, en attente de caisse', r.status === 201 && r.body.status === 'pending_cashier' && Number(r.body.variance_kg) === -12.5 && r.body.bags === 40, r.body);
  check('renvoi de la réception : idempotent', (await call('POST', '/convoys/receive', { ...J(mag.t), body: rb })).body.id === r.body.id);
  check('seconde réception du même convoi refusée', (await call('POST', '/convoys/receive', { ...J(mag.t), body: { ...rb, idempotency_key: key('rc') } })).status === 409);

  console.log('Caisse');
  check('le magasinier n\'a pas accès à la file de la caisse', (await call('GET', '/convoys/cashier-queue', J(mag.t))).status === 403);
  const q = await call('GET', '/convoys/cashier-queue', J(cai.t));
  check('la réception est dans la file de la caisse', q.body.length === 1 && q.body[0].id === r.body.id && q.body[0].collector_name === 'kouame', q.body);
  check('prix nul refusé', (await call('POST', `/convoy-receptions/${r.body.id}/settle`, { ...J(cai.t), body: { idempotency_key: key('st'), unit_price: '0' } })).status === 400);
  check('le magasinier ne peut pas traiter en caisse', (await call('POST', `/convoy-receptions/${r.body.id}/settle`, { ...J(mag.t), body: { idempotency_key: key('st'), unit_price: '1000' } })).status === 403);
  const sk = key('st');
  const s = await call('POST', `/convoy-receptions/${r.body.id}/settle`, { ...J(cai.t), body: { idempotency_key: sk, unit_price: '1000.5' } });
  check('traitement : montant exact poids × prix', s.status === 201 && s.body.status === 'settled' && Number(s.body.amount) === 2587.5 * 1000.5, s.body);
  const s2 = await call('POST', `/convoy-receptions/${r.body.id}/settle`, { ...J(cai.t), body: { idempotency_key: key('st'), unit_price: '1' } });
  check('second traitement : sans nouvelle écriture', s2.body.tx_id === s.body.tx_id && s2.body.replayed === true, s2.body);
  const accs = (await call('GET', '/financial-accounts', J(cai.t))).body;
  const acc = accs.find((a) => a.owner_type === 'collector' && a.owner_id === col1.id);
  check('compte du collecteur créé et crédité', !!acc && Number(acc.balance) === 2587.5 * 1000.5, acc);
  check('autre collecteur : aucun compte', !accs.find((a) => a.owner_id === col2.id));
  const txs = (await call('GET', `/financial-accounts/${acc.id}/transactions`, J(cai.t))).body;
  check('écriture liée à la réception', txs.length === 1 && txs[0].reference_type === 'convoy_reception' && txs[0].reference_id === r.body.id && txs[0].direction === 'in', txs);
  check('convoi marqué réglé', (await call('GET', '/convoys', J(cai.t))).body[0].status === 'settled');
  check('file de la caisse vidée', (await call('GET', '/convoys/cashier-queue', J(cai.t))).body.length === 0);

  console.log('Hors connexion (file de synchronisation)');
  const sync = await call('POST', '/sync/batch', { ...J(c2.t), body: { operations: [{ idempotency_key: key('o'), type: 'convoy.create',
    payload: { idempotency_key: key('cv'), convoy_no: 'CV-2026-002', driver_name: 'Koffi', truck_no: 'XY 99' } }] } });
  check('convoi créé hors ligne puis synchronisé', sync.body.results?.[0]?.status === 'accepted', sync.body);
  const sync2 = await call('POST', '/sync/batch', { ...J(mag.t), body: { operations: [{ idempotency_key: key('o'), type: 'convoy.receive',
    payload: { idempotency_key: key('rc'), collector_id: col2.id, convoy_no: 'CV-2026-002', warehouse_id: wh.id, total_kg: '650', bags: 10 } }] } });
  check('réception hors ligne synchronisée', sync2.body.results?.[0]?.status === 'accepted', sync2.body);

  console.log('Périmètre selon la nature du compte');
  const meC = (await call('GET', '/me', J(c1.t))).body, meM = (await call('GET', '/me', J(mag.t))).body;
  check('collecteur : compte mobile', meC.account_kind === 'collector' && meC.mobile_first === true, meC);
  check('magasinier : personnel', meM.account_kind === 'staff' && meM.mobile_first === false, meM);
  const st = await call('GET', '/convoys/my-stock', J(c1.t));
  check('stock du collecteur : livré et solde du compte', st.status === 200 && st.body.collector && Number(st.body.delivered_kg) === 2587.5 && Number(st.body.balance) === 2587.5 * 1000.5 && st.body.delivered_bags === 40, st.body);
  check('stock : refusé à qui n\'a pas la permission', (await call('GET', '/convoys/my-stock', J(mag.t))).status === 403);
  check('un autre collecteur ne voit pas ce solde', Number((await call('GET', '/convoys/my-stock', J(c2.t))).body.balance) === 0);
  const vc = (await call('POST', '/value-chains', { ...J(t0), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const vc2 = (await call('POST', '/value-chains', { ...J(t0), body: { code: 'CAFE', name: 'Café' } })).body;
  await call('POST', '/producers', { ...J(t0), body: { last_name: 'KONE', first_names: 'Awa', value_chain_ids: [vc.id] } });
  await call('POST', '/producers', { ...J(t0), body: { last_name: 'DIALLO', first_names: 'Ali', value_chain_ids: [vc2.id] } });
  await call('POST', `/collectors/${col1.id}/assignments`, { ...J(t0), body: { value_chain_id: vc.id } });
  const l1 = (await call('GET', '/producers', J(c1.t))).body, l2 = (await call('GET', '/producers', J(c2.t))).body, lAll = (await call('GET', '/producers', J(t0))).body;
  check('collecteur : voit seulement les producteurs de sa filière', l1.length === 1 && l1[0].last_name === 'KONE', l1);
  check('collecteur sans affectation : aucun producteur', l2.length === 0, l2);
  check('administrateur : voit tous les producteurs', lAll.length === 2);
  check('détail d\'un producteur hors périmètre : introuvable', (await call('GET', `/producers/${lAll.find((p) => p.last_name === 'DIALLO').id}`, J(c1.t))).status === 404);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
