// Test de bout en bout : reçu d'achat à la déclaration (modes physique / généré), conflits, corrections, recherche,
// et codes de parcelle « CODE_PRODUCTEUR-Pn ».
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
  console.log('Mise en place');
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (code) => (await call('POST', '/organizations', { token: adm, body: { code, name: code } })).body;
  const A = await mkOrg('RA' + run), B = await mkOrg('RB' + run);
  for (const [org, mail] of [[A, `a1.${run}@t.test`], [B, `b1.${run}@t.test`]])
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
  const t1 = await login(`a1.${run}@t.test`, pw), tb = await login(`b1.${run}@t.test`, pw);
  const J = (t, o) => ({ token: t, org: o.id });
  const vc = (await call('POST', '/value-chains', { ...J(t1, A), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const camp = (await call('POST', '/campaigns', { ...J(t1, A), body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne 2025-26', starts_on: '2025-10-01', ends_on: '2026-09-30' } })).body;
  const sched = (await call('POST', '/price-schedules', { ...J(t1, A), body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).body;
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J(t1, A), body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const p1 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const p2 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'TRAORE', first_names: 'Moussa', village: 'Zoukougbeu', section: 'S2', value_chain_ids: [vc.id] } })).body.producer;
  const wh = (await call('POST', '/warehouses', { ...J(t1, A), body: { code: 'MAG1', name: 'Magasin 1' } })).body;
  const role = (await call('POST', '/roles', { ...J(t1, A), body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use'] } })).body;
  const cu = (await call('POST', '/users', { ...J(t1, A), body: { email: `c1.${run}@t.test`, full_name: 'Collecteur', password: pw, role_id: role.id } })).body;
  const col = (await call('POST', '/collectors', { ...J(t1, A), body: { user_id: cu.id } })).body;
  await call('POST', `/collectors/${col.id}/assignments`, { ...J(t1, A), body: { value_chain_id: vc.id } });
  const tc = await login(`c1.${run}@t.test`, pw);
  const decl = (extra = {}) => ({ id: crypto.randomUUID(), idempotency_key: key('d'), producer_id: p1.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', quantity: '130', unit: 'kg', bags: 2, ...extra });
  const post = (t, body) => call('POST', '/purchase-declarations', { ...J(t, A), body });
  check('mise en place terminée', !!(vc.id && camp.id && p1.id && col.id && tc));

  console.log('Mode physique : numéro saisi dès la déclaration');
  const s0 = (await call('GET', '/purchase-declarations/settings/receipts', J(tc, A))).body;
  check('réglage par défaut : physique, obligatoire', s0.mode === 'physical' && s0.required === true, s0);
  check('collecteur ne peut pas modifier les réglages → 403', (await call('PUT', '/purchase-declarations/settings/receipts', { ...J(tc, A), body: { mode: 'physical', series: 'A', required: true } })).status === 403);
  const noNum = await post(tc, decl());
  check('numéro manquant alors qu\'il est obligatoire → 400', noNum.status === 400, noNum.body);
  const set = await call('PUT', '/purchase-declarations/settings/receipts', { ...J(t1, A), body: { mode: 'physical', series: 'A', required: true, mask: 'RA-####' } });
  check('réglage : masque RA-####', set.status === 200 && set.body.mask === 'RA-####', set.body);
  check('format invalide → 400', (await post(tc, decl({ purchase_receipt_no: 'XX-12' }))).status === 400);
  const d1 = await post(tc, decl({ purchase_receipt_no: ' ra-0001 ' }));
  check('numéro accepté et normalisé (RA-0001), valeur saisie conservée', d1.status === 201 && d1.body.purchase_receipt_no === 'RA-0001' && d1.body.purchase_receipt_entered === ' ra-0001 ' && !d1.body.receipt_conflict_with, d1.body);
  const again = await post(tc, { ...decl({ purchase_receipt_no: 'RA-0001' }), id: d1.body.id, idempotency_key: d1.body.idempotency_key });
  check('renvoi de la même opération : pas de doublon', again.body.replayed === true && again.body.id === d1.body.id, again.body);

  console.log('Doublon : enregistré en conflit, jamais validé silencieusement');
  const d2 = await post(tc, decl({ purchase_receipt_no: 'RA-0001', producer_id: p2.id }));
  check('même numéro : déclaration enregistrée avec conflit', d2.status === 201 && d2.body.receipt_conflict_with === d1.body.id, d2.body);
  check('soumission d\'une déclaration en conflit → 409', (await call('POST', `/purchase-declarations/${d2.body.id}/submit`, J(tc, A))).status === 409);
  check('collecteur ne peut pas corriger → 403', (await call('POST', `/purchase-declarations/${d2.body.id}/receipt-number`, { ...J(tc, A), body: { purchase_receipt_no: 'RA-0002', reason: 'erreur de saisie' } })).status === 403);
  check('correction vers un numéro déjà pris → 409', (await call('POST', `/purchase-declarations/${d2.body.id}/receipt-number`, { ...J(t1, A), body: { purchase_receipt_no: 'RA-0001', reason: 'test' } })).status === 409);
  check('correction vers un format invalide → 400', (await call('POST', `/purchase-declarations/${d2.body.id}/receipt-number`, { ...J(t1, A), body: { purchase_receipt_no: 'ZZ', reason: 'test' } })).status === 400);
  const fix = await call('POST', `/purchase-declarations/${d2.body.id}/receipt-number`, { ...J(t1, A), body: { purchase_receipt_no: 'RA-0002', reason: 'Le reçu papier portait le n° 0002' } });
  check('correction autorisée : conflit levé, original conservé', fix.status === 201 && fix.body.purchase_receipt_no === 'RA-0002' && !fix.body.receipt_conflict_with && fix.body.purchase_receipt_entered === 'RA-0001', fix.body);
  const sub2 = await call('POST', `/purchase-declarations/${d2.body.id}/submit`, J(tc, A));
  check('soumission possible après correction', sub2.status === 201 && sub2.body.status === 'received', sub2.body);

  const d3 = await post(tc, decl({ purchase_receipt_no: 'RA-0001', producer_id: p2.id }));
  check('autre doublon créé', d3.body.receipt_conflict_with === d1.body.id);
  check('exception sans permission → 403', (await call('POST', `/purchase-declarations/${d3.body.id}/receipt-override`, { ...J(tc, A), body: { reason: 'accord' } })).status === 403);
  check('exception sans motif → 400', (await call('POST', `/purchase-declarations/${d3.body.id}/receipt-override`, { ...J(t1, A), body: { reason: '' } })).status === 400);
  const ov = await call('POST', `/purchase-declarations/${d3.body.id}/receipt-override`, { ...J(t1, A), body: { reason: 'Deux carnets ont été imprimés avec la même série' } });
  check('exception autorisée et auditée', ov.status === 201 && !!ov.body.receipt_override_by, ov.body);
  check('soumission possible après exception', (await call('POST', `/purchase-declarations/${d3.body.id}/submit`, J(tc, A))).status === 201);
  const aud = (await call('GET', '/audit-logs?limit=50', J(t1, A))).body;
  check('corrections et exceptions dans le journal d\'audit', JSON.stringify(aud).includes('declaration.receipt_override') && JSON.stringify(aud).includes('declaration.receipt_correct'));

  console.log('Synchronisation : doublon de numéro → conflit');
  const ds = decl({ purchase_receipt_no: 'RA-0001' });
  const sy = await call('POST', '/sync/batch', { ...J(tc, A), body: { operations: [{ idempotency_key: ds.idempotency_key, type: 'purchase_declaration.create', payload: ds }] } });
  check('résultat « conflict » avec explication, déclaration conservée', sy.body.results?.[0]?.status === 'conflict' && /déjà utilisé/.test(sy.body.results[0].error || '') && sy.body.results[0].result?.receipt_conflict_with, sy.body);
  const sy2 = await call('POST', '/sync/batch', { ...J(tc, A), body: { operations: [{ idempotency_key: ds.idempotency_key, type: 'purchase_declaration.create', payload: ds }] } });
  check('renvoi : même résultat, pas de doublon', sy2.body.results?.[0]?.status === 'conflict');

  console.log('Recherche par numéro de reçu et liaison avec la pesée / la réception');
  const tr = await call('POST', `/purchase-declarations/${d1.body.id}/submit`, J(tc, A));
  await call('POST', `/purchase-declarations/${d1.body.id}/transition`, { ...J(t1, A), body: { to: 'in_review' } });
  const acc = await call('POST', `/purchase-declarations/${d1.body.id}/transition`, { ...J(t1, A), body: { to: 'accepted' } });
  check('déclaration valide : acceptée', tr.status === 201 && acc.body.status === 'accepted', acc.body);
  const w = (await call('POST', '/weighings', { ...J(t1, A), body: { idempotency_key: key('w'), declaration_id: d1.body.id, warehouse_id: wh.id, gross_kg: '135', tare_kg: '5' } })).body;
  const r = (await call('POST', '/receipts', { ...J(t1, A), body: { weighing_id: w.id } })).body.receipt;
  const found = await call('GET', '/purchase-declarations/search/by-receipt?number=ra-0001', J(t1, A));
  check('recherche : déclaration, pesée et réception retrouvées', found.status === 200 && found.body.declarations?.length >= 1 && found.body.weighings?.length === 1 && found.body.receipts?.[0]?.id === r.id, found.body);
  check('recherche réservée aux rôles autorisés → 403', (await call('GET', '/purchase-declarations/search/by-receipt?number=RA-0001', J(tc, A))).status === 403);
  check('recherche : autre coopérative ne voit rien', (await call('GET', '/purchase-declarations/search/by-receipt?number=RA-0001', J(tb, B))).body.declarations?.length === 0);
  const lst = await call('GET', '/purchase-declarations?receipt_no=RA-000', J(t1, A));
  check('liste filtrée par préfixe de numéro', lst.body.length >= 3 && lst.body.every((x) => x.purchase_receipt_no.startsWith('RA-000')), lst.body.length);
  const pdf = await fetch(`${API}/receipts/${r.id}/pdf`, { headers: { authorization: `Bearer ${t1}`, 'x-organization-id': A.id } });
  check('bon de pesée PDF généré', pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 500);
  const rd = (await call('GET', `/receipts/${r.id}`, J(t1, A))).body;
  check('le bon de pesée porte le numéro du reçu d\'achat', rd.purchase_receipt_no === 'RA-0001', rd);
  const tx = (await call('GET', `/lots/${r.lot_id}/traceability`, J(t1, A))).body;
  check('la traçabilité du lot porte le numéro du reçu d\'achat', JSON.stringify(tx).includes('RA-0001'));

  console.log('Mode généré : numéro attribué par le serveur, sans mélange des séries');
  const mixed = await call('PUT', '/purchase-declarations/settings/receipts', { ...J(t1, A), body: { mode: 'generated', series: 'A', required: true } });
  check('même série, autre mode → 409', mixed.status === 409, mixed.body);
  const g = await call('PUT', '/purchase-declarations/settings/receipts', { ...J(t1, A), body: { mode: 'generated', series: 'B', required: true, prefix: 'AT' } });
  check('nouvelle série « B » en mode généré', g.status === 200 && g.body.mode === 'generated', g.body);
  check('numéro saisi en mode généré → 400', (await post(tc, decl({ purchase_receipt_no: 'AT-1' }))).status === 400);
  const gen = await Promise.all([1, 2, 3, 4, 5].map(() => post(tc, decl())));
  const nums = gen.map((x) => x.body.purchase_receipt_no);
  check('5 créations simultanées : 5 numéros générés distincts', gen.every((x) => x.status === 201) && new Set(nums).size === 5 && nums.every((n) => /^AT-\d{4}-\d{6}$/.test(n)), nums);
  check('numéro généré non corrigeable → 400', (await call('POST', `/purchase-declarations/${gen[0].body.id}/receipt-number`, { ...J(t1, A), body: { purchase_receipt_no: 'AT-0000', reason: 'test' } })).status === 400);
  const back = await call('PUT', '/purchase-declarations/settings/receipts', { ...J(t1, A), body: { mode: 'physical', series: 'B', required: true } });
  check('retour de la série « B » en mode physique → 409', back.status === 409);

  console.log('Codes de parcelle CODE_PRODUCTEUR-Pn');
  const mk = (extra) => call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('pc'), producer_id: p1.id, value_chain_id: vc.id, declared_area_ha: '1', ...extra } });
  const a = await mk({ geometry: sq(-6, 6.8) }), b = await mk({ geometry: sq(-5.95, 6.8) });
  check('P1 puis P2 pour le même producteur', a.body.code === `${p1.internal_code}-P1` && b.body.code === `${p1.internal_code}-P2`, [a.body.code, b.body.code]);
  const par = await Promise.all([0, 1, 2, 3, 4].map((i) => mk({ latitude: 6.9 + i * 0.01, longitude: -5.8, confirm_not_duplicate: true })));
  const codes = par.map((x) => x.body.code);
  check('5 créations simultanées : codes distincts', par.every((x) => x.status === 201) && new Set(codes).size === 5, codes);
  await call('POST', `/parcels/${b.body.id}/archive`, J(t1, A));
  const after = await mk({ latitude: 7.5, longitude: -5.7 });
  check('un code archivé n\'est jamais réattribué', !codes.includes(after.body.code) && after.body.code !== b.body.code && after.body.code === `${p1.internal_code}-P8`, after.body.code);
  const pB = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'DIALLO', first_names: 'Fanta', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const c1 = await call('POST', '/parcels', { ...J(t1, A), body: { idempotency_key: key('pc'), producer_id: pB.id, value_chain_id: vc.id, declared_area_ha: '2', latitude: 7.9, longitude: -5.5 } });
  check('compteur propre à chaque producteur', c1.body.code === `${pB.internal_code}-P1`, c1.body.code);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
