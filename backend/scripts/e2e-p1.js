// Test de bout en bout P0+P1 contre une API démarrée.
// Usage : API=http://localhost:3111/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/e2e-p1.js
const ExcelJS = require('exceljs');
const crypto = require('crypto');

const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;

async function call(method, path, { token, org, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
function check(name, cond, extra) {
  if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra ?? ''); }
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;

(async () => {
  console.log('Mise en place');
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (code) => (await call('POST', '/organizations', { token: adm, body: { code, name: code } })).body;
  const A = await mkOrg('A' + run), B = await mkOrg('B' + run);
  const pw = 'MotDePasseSolide2026!';
  for (const [org, mail] of [[A, `admin.a.${run}@t.test`], [B, `admin.b.${run}@t.test`]])
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Admin ' + org.code, password: pw } });
  const ta = await login(`admin.a.${run}@t.test`, pw), tb = await login(`admin.b.${run}@t.test`, pw);
  await call('PUT', '/purchase-declarations/settings/receipts', { token: ta, org: A.id, body: { mode: 'physical', series: 'A', required: false } }); // ces scénarios ne testent pas le reçu d'achat (voir e2e-recus.js)

  console.log('Référentiels et prix');
  const vc = (await call('POST', '/value-chains', { token: ta, org: A.id, body: { code: 'CACAO', name: 'Cacao', default_unit: 'kg' } })).body;
  check('filière créée', !!vc.id, vc);
  await call('POST', '/unit-conversions', { token: ta, org: A.id, body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = (await call('POST', '/campaigns', { token: ta, org: A.id, body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne 2025-26', starts_on: '2025-10-01', ends_on: '2026-09-30' } })).body;
  check('campagne créée', !!camp.id, camp);
  const sched = (await call('POST', '/price-schedules', { token: ta, org: A.id, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).body;
  const v1 = (await call('POST', `/price-schedules/${sched.id}/versions`, { token: ta, org: A.id, body: { unit_price: '1000', valid_from: '2025-10-01' } })).body;
  check('prix v1 créé', v1.version_no === 1, v1);

  console.log('Producteurs');
  const p = (await call('POST', '/producers', { token: ta, org: A.id, body: { last_name: 'KONE', first_names: 'Awa', phone: '+2250701020304', village: 'Hiré', value_chain_ids: [vc.id] } })).body;
  check('producteur créé avec code généré', /^P\d{5}$/.test(p.producer?.internal_code), p);
  const dup = (await call('POST', '/producers', { token: ta, org: A.id, body: { last_name: 'KONE', first_names: 'Awa', phone: '+2250701020304', village: 'Hiré' } })).body;
  check('doublon signalé sans fusion', dup.potential_duplicates?.length >= 1 && dup.producer?.id !== p.producer.id, dup);
  const seen = await call('GET', '/producers', { token: tb, org: B.id });
  check('autre coopérative ne voit pas les producteurs', seen.body.length === 0, seen.body);
  const cross = await call('GET', `/producers/${p.producer.id}`, { token: tb, org: B.id });
  check('lecture par identifiant d\'une autre coopérative → 404', cross.status === 404, cross.status);
  const forbidden = await call('GET', '/producers', { token: tb, org: A.id });
  check('en-tête vers une organisation non attribuée → 403', forbidden.status === 403, forbidden.status);

  console.log('Import Excel');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('P');
  ws.addRow(['Code', 'Nom', 'Prénoms', 'Téléphone', 'Village', 'Filières']);
  ws.addRow(['', 'TRAORE', 'Moussa', '0705050505', 'Hiré', 'CACAO']);
  ws.addRow(['', 'KONE', 'Awa', '', 'Hiré', 'CACAO']);       // doublon de la base
  ws.addRow(['', '', 'Sans nom', '', '', '']);                // erreur
  ws.addRow(['', 'DIABATE', 'Issa', '', 'Zoukougbeu', 'CAFE']); // filière inconnue
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const form = () => { const f = new FormData(); f.append('file', new Blob([buf]), 'p.xlsx'); return f; };
  const dry = await call('POST', '/producers/imports', { token: ta, org: A.id, body: form() });
  check('simulation : 1 valide, 3 ignorées, rien inséré', dry.body.dry_run === true && dry.body.created === 1 && dry.body.skipped === 3, dry.body);
  const real = await call('POST', '/producers/imports?confirm=true', { token: ta, org: A.id, body: form() });
  check('import confirmé : 1 créé', real.body.created === 1 && real.body.dry_run === false, real.body);
  const notXlsx = new FormData(); notXlsx.append('file', new Blob(['pas un xlsx']), 'x.xlsx');
  check('fichier non .xlsx refusé', (await call('POST', '/producers/imports', { token: ta, org: A.id, body: notXlsx })).status === 400);

  console.log('Collecteur et déclarations');
  const role = (await call('POST', '/roles', { token: ta, org: A.id, body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'campaigns:read', 'prices:read'] } })).body;
  check('rôle limité créé', !!role.id, role);
  const col = (await call('POST', '/users', { token: ta, org: A.id, body: { email: `col.${run}@t.test`, full_name: 'Collecteur Un', password: pw, role_id: role.id } })).body;
  const colB = (await call('POST', '/users', { token: ta, org: A.id, body: { email: `col2.${run}@t.test`, full_name: 'Collecteur Deux', password: pw, role_id: role.id } })).body;
  const collector2 = (await call('POST', '/collectors', { token: ta, org: A.id, body: { user_id: colB.id } })).body;
  await call('POST', `/collectors/${collector2.id}/assignments`, { token: ta, org: A.id, body: {} });
  const collector = (await call('POST', '/collectors', { token: ta, org: A.id, body: { user_id: col.id } })).body;
  check('collecteur créé', !!collector.id, collector);
  const noAssign = await call('POST', '/purchase-declarations', { token: await login(`col.${run}@t.test`, pw), org: A.id, body: decl(p.producer.id, vc.id, camp.id, 'k1-' + run) });
  check('collecteur non affecté → 403', noAssign.status === 403, noAssign.body);
  await call('POST', `/collectors/${collector.id}/assignments`, { token: ta, org: A.id, body: { value_chain_id: vc.id } });
  const tc = await login(`col.${run}@t.test`, pw);
  const d1 = (await call('POST', '/purchase-declarations', { token: tc, org: A.id, body: decl(p.producer.id, vc.id, camp.id, 'key-' + run) })).body;
  check('déclaration créée en brouillon', d1.status === 'draft' && d1.replayed === false, d1);
  const replay = (await call('POST', '/purchase-declarations', { token: tc, org: A.id, body: decl(p.producer.id, vc.id, camp.id, 'key-' + run) })).body;
  check('rejeu idempotent : même déclaration, pas de doublon', replay.id === d1.id && replay.replayed === true, replay);
  const sub = (await call('POST', `/purchase-declarations/${d1.id}/submit`, { token: tc, org: A.id })).body;
  check('soumission : 2 sacs × 65 kg × 1000 = 130000', sub.status === 'received' && Number(sub.amount) === 130000, sub);
  // Prix officiel du produit rattaché à la filière : prioritaire sur le barème (fixé par l'administrateur seul)
  const prodC = (await call('POST', '/products', { token: ta, org: A.id, body: { name: 'Cacao officiel ' + run, buy_price_per_kg: '1500', value_chain_id: vc.id, campaign_id: camp.id } })).body;
  check('produit rattaché à la filière', prodC.value_chain_id === vc.id, prodC);
  const dP = (await call('POST', '/purchase-declarations', { token: tc, org: A.id, body: decl(p.producer.id, vc.id, camp.id, 'keyprod-' + run) })).body;
  const subP = (await call('POST', `/purchase-declarations/${dP.id}/submit`, { token: tc, org: A.id })).body;
  check('déclaration : 2 sacs × 65 kg × 1500 (prix officiel du produit) = 195000', Number(subP.amount) === 195000 && Number(subP.unit_price) === 1500, subP);
  await call('PUT', `/products/${prodC.id}`, { token: ta, org: A.id, body: { name: prodC.name, buy_price_per_kg: '1500', value_chain_id: null } });
  // nouvelle version de prix : l'ancienne déclaration ne bouge pas
  await call('POST', `/price-schedules/${sched.id}/versions`, { token: ta, org: A.id, body: { unit_price: '1200', valid_from: '2026-06-01' } });
  const other = await call('GET', `/purchase-declarations/${d1.id}`, { token: await login(`col2.${run}@t.test`, pw), org: A.id });
  check('un collecteur ne voit pas les déclarations d\'un autre → 404', other.status === 404, other.status);
  const noPerm = await call('POST', `/purchase-declarations/${d1.id}/transition`, { token: tc, org: A.id, body: { to: 'in_review' } });
  check('collecteur ne peut pas valider → 403', noPerm.status === 403, noPerm.status);
  const again = (await call('GET', `/purchase-declarations/${d1.id}`, { token: tc, org: A.id })).body;
  check('prix historique conservé après changement de barème', Number(again.amount) === 130000 && Number(again.unit_price) === 1000, again);
  const bad = await call('POST', `/purchase-declarations/${d1.id}/transition`, { token: ta, org: A.id, body: { to: 'accepted' } });
  check('saut d\'état received → accepted refusé', bad.status === 400, bad.body);
  await call('POST', `/purchase-declarations/${d1.id}/transition`, { token: ta, org: A.id, body: { to: 'in_review' } });
  const acc = await call('POST', `/purchase-declarations/${d1.id}/transition`, { token: ta, org: A.id, body: { to: 'accepted' } });
  check('vérification puis acceptation', acc.body.status === 'accepted', acc.body);
  const noPrice = await call('POST', '/purchase-declarations', { token: tc, org: A.id, body: { ...decl(p.producer.id, vc.id, camp.id, 'key2-' + run), operation_date: '2025-01-01' } });
  const np = await call('POST', `/purchase-declarations/${noPrice.body.id}/submit`, { token: tc, org: A.id });
  check('aucun prix applicable → 422', np.status === 422, np.body);

  console.log('Caisse et finances');
  const reg = (await call('POST', '/cash-registers', { token: ta, org: A.id, body: { name: 'Caisse principale' } })).body;
  const sess = (await call('POST', `/cash-registers/${reg.id}/sessions`, { token: ta, org: A.id, body: { opening_amount: '100000' } })).body;
  check('session ouverte avec fonds', !!sess.id, sess);
  check('2e session sur la même caisse refusée', (await call('POST', `/cash-registers/${reg.id}/sessions`, { token: ta, org: A.id, body: { opening_amount: '0' } })).status === 409);
  const out1 = await call('POST', '/financial-transactions', { token: ta, org: A.id, body: { idempotency_key: 'tx-1-' + run, account_id: reg.account_id, cash_session_id: sess.id, direction: 'out', amount: '60000', reason: 'Paiement producteur' } });
  check('sortie 60 000 acceptée', out1.status === 201, out1.body);
  const out1b = await call('POST', '/financial-transactions', { token: ta, org: A.id, body: { idempotency_key: 'tx-1-' + run, account_id: reg.account_id, cash_session_id: sess.id, direction: 'out', amount: '60000', reason: 'Paiement producteur' } });
  check('double envoi : même transaction, solde inchangé', out1b.body.id === out1.body.id && out1b.body.replayed === true, out1b.body);
  const over = await call('POST', '/financial-transactions', { token: ta, org: A.id, body: { idempotency_key: 'tx-2-' + run, account_id: reg.account_id, cash_session_id: sess.id, direction: 'out', amount: '50000', reason: 'Dépassement' } });
  check('dépassement du solde de caisse → 422', over.status === 422, over.body);
  const rev = await call('POST', `/financial-transactions/${out1.body.id}/reverse`, { token: ta, org: A.id, body: { reason: 'Erreur de saisie' } });
  check('écriture compensatoire créée', rev.status === 201 && rev.body.direction === 'in', rev.body);
  check('double compensation refusée', (await call('POST', `/financial-transactions/${out1.body.id}/reverse`, { token: ta, org: A.id, body: { reason: 'Encore' } })).status === 409);
  const closed = (await call('POST', `/cash-sessions/${sess.id}/close`, { token: ta, org: A.id, body: { counted_amount: '99000' } })).body;
  check('clôture : attendu 100 000, écart −1 000', Number(closed.expected_amount) === 100000 && Number(closed.variance) === -1000, closed);
  const accts = (await call('GET', '/financial-accounts', { token: tb, org: B.id })).body;
  check('autre coopérative ne voit aucun compte', accts.length === 0, accts);

  console.log('Audit');
  const au = (await call('GET', '/audit-logs?limit=500', { token: ta, org: A.id })).body;
  check('journal d\'audit alimenté', au.some((r) => r.action === 'declaration.submit') && au.some((r) => r.action === 'transaction.reverse'));
  const auB = (await call('GET', '/audit-logs', { token: tb, org: B.id })).body;
  check('audit de A invisible depuis B', !auB.some((r) => r.action === 'declaration.submit'));

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);

  function decl(producer, chain, campaign, key) {
    return { id: crypto.randomUUID(), idempotency_key: key, producer_id: producer, value_chain_id: chain, campaign_id: campaign,
             operation_date: '2026-02-10', bags: 2, quantity: '2', unit: 'sac', notes: 'test' };
  }
})().catch((e) => { console.error(e); process.exit(2); });
