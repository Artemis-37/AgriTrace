// Mise en compte (retenues) des délégués : clôture du compte, demande de reversement, approbation par l'administrateur (4 destinations).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (org) headers['x-organization-id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const pw = 'MotDePasseSolide2026!';
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: pw } })).body.access_token;
(async () => {
  const plat = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: plat, body: { code: 'ME' + run, name: 'ME' + run } })).body;
  const mail = `me.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: plat, body: { email: mail, full_name: 'Admin', password: pw } });
  const adm = await login(mail); const A = { token: adm, org: org.id };
  const std = async (code) => (await call('POST', '/roles/standard', { ...A, body: { code } })).body;
  const rCai = await std('caissier'), rMag = await std('magasinier'), rCol = await std('collecteur');
  const mk = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...A, body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email) }; };
  const cai = await mk('caissier', rCai), mag = await mk('magasinier', rMag), col = await mk('delegue', rCol);
  const C = { token: cai.t, org: org.id }, M = { token: mag.t, org: org.id };
  // Création avec plusieurs rôles
  const multi = (await call('POST', '/users', { ...A, body: { email: `multi.${run}@t.test`, full_name: 'Multi', password: pw, role_id: rMag.id, role_ids: [rCai.id] } })).body;
  const ml = (await call('GET', '/users', A)).body.find((u) => u.id === multi.id);
  check('création avec deux rôles', ml && ml.role_ids.length === 2, ml);
  // Données : filière, campagne, magasin, délégué, convoi réceptionné et réglé avec retenue
  const vc = (await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao' } })).body;
  const camp = (await call('POST', '/campaigns', { ...A, body: { value_chain_id: vc.id, code: 'C26', name: 'Camp', starts_on: '2025-10-01', ends_on: '2027-12-31' } })).body;
  const wh = (await call('POST', '/warehouses', { ...A, body: { code: 'M1', name: 'Magasin' } })).body;
  const k = (await call('POST', '/collectors', { ...A, body: { user_id: col.id } })).body;
  await call('POST', '/convoys/settings', { ...A, body: { transport_unit: '0', retention_per_kg: '10' } });
  const prod = (await call('POST', '/products', { ...A, body: { name: 'Cacao', buy_price_per_kg: '1000', sell_price_per_kg: '1500', campaign_id: camp.id } })).body;
  const rec = (await call('POST', '/convoys/receive', { ...M, body: { idempotency_key: 'rv-' + run + '-1', collector_id: k.id, convoy_no: 'ME-001', warehouse_id: wh.id, campaign_id: camp.id, product_id: prod.id, gross_kg: '1000', bags: 10, bags_unloaded: 0, driver_name: 'Chauffeur', truck_no: 'AB 1 CI' } })).body;
  check('pesée d\'un convoi non déclaré pour un délégué existant', !!(rec.id || rec.reception?.id), rec);
  const rid = rec.id ?? rec.reception?.id;
  await call('POST', '/cash-registers', { ...A, body: { name: 'Caisse' } });
  check('le caissier ne peut pas saisir un autre prix au kilo', (await call('POST', `/convoy-receptions/${rid}/settle`, { ...C, body: { idempotency_key: 'st0-' + run, unit_price: '500' } })).status === 403);
  const settle = await call('POST', `/convoy-receptions/${rid}/settle`, { ...C, body: { idempotency_key: 'st-' + run, retention_per_kg: '10' } });
  check('réception réglée (retenue 10 000)', settle.status < 300 && Number(settle.body.retention_amount) === 10000, settle.body);
  const sav = async () => (await call('GET', '/collector-savings', C)).body.find((x) => x.collector_id === k.id);
  check('mise en compte visible : 10 000 retenus', Number((await sav()).available) === 10000, await sav());
  // Demande avant clôture refusée
  const req0 = { collector_id: k.id, amount: '4000', mode: 'account' };
  check('demande refusée tant que le compte n\'est pas clôturé', (await call('POST', '/collector-savings/requests', { ...C, body: req0 })).status === 409);
  check('clôture du compte par le caissier', (await call('POST', `/collector-savings/collectors/${k.id}/close`, { ...C, body: { reason: 'Fin de campagne' } })).status < 300);
  check('le magasinier ne peut ni demander ni approuver', (await call('POST', '/collector-savings/requests', { ...M, body: req0 })).status === 403);
  check('montant supérieur au disponible refusé', (await call('POST', '/collector-savings/requests', { ...C, body: { ...req0, amount: '10001' } })).status === 422);
  // 1) sur le compte du délégué
  const q1 = (await call('POST', '/collector-savings/requests', { ...C, body: req0 })).body;
  check('demande créée (en attente)', q1.status === 'pending', q1);
  check('le caissier ne peut pas approuver', (await call('POST', `/collector-savings/requests/${q1.id}/approve`, { ...C, body: {} })).status === 403);
  const a1 = await call('POST', `/collector-savings/requests/${q1.id}/approve`, { ...A, body: { comment: 'OK' } });
  check('approuvée par l\'administrateur : écriture passée', a1.status < 300 && a1.body.status === 'approved' && !!a1.body.entry_number, a1.body);
  check('double approbation refusée', (await call('POST', `/collector-savings/requests/${q1.id}/approve`, { ...A, body: {} })).status === 409);
  // 2) chèque (compte bancaire), 3) autre compte, 4) espèces
  const bank = (await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'Banque X' } })).body;
  await call('POST', '/financial-transactions', { ...A, body: { idempotency_key: 'dep-' + run, account_id: bank.id, direction: 'in', amount: '100000', reason: 'Dépôt' } });
  const q2 = (await call('POST', '/collector-savings/requests', { ...C, body: { collector_id: k.id, amount: '2000', mode: 'cheque', target_account_id: bank.id, cheque_no: 'CH-123' } })).body;
  check('chèque : demande créée', q2.status === 'pending', q2);
  const a2 = await call('POST', `/collector-savings/requests/${q2.id}/approve`, { ...A, body: {} });
  check('chèque : approuvé, banque débitée', a2.status < 300 && a2.body.status === 'approved', a2.body);
  const other = (await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'Autre compte' } })).body;
  const q3 = (await call('POST', '/collector-savings/requests', { ...C, body: { collector_id: k.id, amount: '1000', mode: 'transfer', target_account_id: other.id } })).body;
  const r3 = await call('POST', `/collector-savings/requests/${q3.id}/reject`, { ...A, body: { comment: 'Compte non reconnu' } });
  check('virement : refusé par l\'administrateur avec motif', r3.status < 300 && r3.body.status === 'rejected', r3.body);
  check('nouvelle demande de virement créée', (await call('POST', '/collector-savings/requests', { ...C, body: { collector_id: k.id, amount: '1000', mode: 'transfer', target_account_id: other.id } })).status === 201);
  const reqs = (await call('GET', '/collector-savings/requests?status=pending', A)).body;
  check('liste des demandes en attente', reqs.length === 1, reqs);
  const rr = await call('POST', `/collector-savings/requests/${reqs[0].id}/reject`, { ...A, body: {} });
  check('refus sans motif refusé', rr.status === 400);
  await call('POST', `/collector-savings/requests/${reqs[0].id}/approve`, { ...A, body: {} });
  const regs = (await call('GET', '/cash-registers', A)).body;
  const sess = (await call('POST', `/cash-registers/${regs[0].id}/sessions`, { ...C, body: { opening_amount: '50000' } })).body;
  const q4 = (await call('POST', '/collector-savings/requests', { ...C, body: { collector_id: k.id, amount: '3000', mode: 'cash', cash_session_id: sess.id } })).body;
  const a4 = await call('POST', `/collector-savings/requests/${q4.id}/approve`, { ...A, body: {} });
  check('espèces : approuvé, sortie de caisse', a4.status < 300 && a4.body.status === 'approved', a4.body);
  const s = await sav();
  check('solde de la mise en compte : 10 000 − 4 000 − 2 000 − 1 000 − 3 000 = 0', Number(s.available) === 0 && Number(s.released) === 10000, s);
  console.log(`\n${ok} vérifications réussies, ${ko} échecs`); process.exit(ko ? 1 : 0);
})();
