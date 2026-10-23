// Test de bout en bout : partenaires/fournisseurs, échéances (factures fournisseurs, emprunts, prestations, ventes d'autres produits, impôts), règlements, BIC, produit déclaré du convoi.
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
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'DU' + run, name: 'DU' + run } })).body;
  const mail = `du.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });
  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(t0), body: { code, name: code, permissions } })).body;
  const rLec = await role('lecteur', ['dues:read', 'partners:read']);
  const rCol = await role('collecteur', ['convoys:create', 'convoys:read', 'products:read', 'sync:use', 'collector:stock', 'producers:read']);
  const rMag = await role('magasinier', ['convoys:receive', 'convoys:read', 'products:read', 'campaigns:read', 'warehouses:read']);
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email, pw) }; };
  const lec = await user('lecteur', rLec), col = await user('kone', rCol), mag = await user('mag', rMag);

  console.log('Partenaires');
  const sup = await call('POST', '/partners', { ...J(t0), body: { kind: 'supplier', name: 'Quincaillerie Test ' + run, phone: '0700000000' } });
  check('fournisseur créé', sup.status === 201, sup.body);
  check('doublon refusé', (await call('POST', '/partners', { ...J(t0), body: { kind: 'supplier', name: 'quincaillerie test ' + run } })).status === 409);
  const bank = await call('POST', '/partners', { ...J(t0), body: { kind: 'lender', name: 'Banque Test ' + run } });
  check('liste filtrée par rubrique', (await call('GET', '/partners?kind=lender', J(t0))).body.length === 1);
  check('lecteur ne peut pas créer', (await call('POST', '/partners', { ...J(lec.t), body: { kind: 'client', name: 'X' } })).status === 403);
  check('lecteur peut lire', (await call('GET', '/partners', J(lec.t))).status === 200);

  const acc = (await call('POST', '/financial-accounts', { ...J(t0), body: { owner_type: 'other', name: 'Banque principale' } })).body;
  console.log('Échéances');
  const inv = await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key('d'), kind: 'supplier_invoice', partner_id: sup.body.id, ref_no: 'F-1', label: 'Sacs de jute', due_date: '2026-12-31', quantity: '100', unit_price: '350' } });
  check('facture fournisseur : montant = quantité × prix', inv.status === 201 && Number(inv.body.amount) === 35000 && inv.body.direction === 'payable', inv.body);
  const key1 = key('d');
  const a1 = await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key1, kind: 'service', label: 'Transport pour un tiers', due_date: '2026-12-31', amount: '80000' } });
  const a2 = await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key1, kind: 'service', label: 'Transport pour un tiers', due_date: '2026-12-31', amount: '80000' } });
  check('prestation à encaisser ; rejeu idempotent', a1.status === 201 && a1.body.direction === 'receivable' && a2.body.id === a1.body.id, [a1.body, a2.body]);
  const sale = await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key('d'), kind: 'other_sale', label: 'Vente de sacs usagés', due_date: '2026-11-30', quantity: '50', unit_price: '200' } });
  check('vente d’autres produits', sale.status === 201 && Number(sale.body.amount) === 10000, sale.body);
  const emp = await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key('d'), kind: 'borrowing', partner_id: bank.body.id, label: 'Crédit de campagne', due_date: '2027-06-30', principal: '1000000', rate_pct: '8', term_months: '12', account_id: acc.id } });
  check('emprunt : intérêts calculés (1 080 000) et fonds crédités', emp.status === 201 && Number(emp.body.amount) === 1080000 && !!emp.body.funds_tx_id, emp.body);
  const bal = (await call('GET', '/financial-accounts', J(t0))).body.find((x) => x.id === acc.id);
  check('compte crédité du capital', Number(bal.balance) === 1000000, bal);
  check('emprunt sans durée refusé', (await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key('d'), kind: 'borrowing', label: 'X', due_date: '2027-01-01', principal: '1000' } })).status === 400);
  const tax = await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key('d'), kind: 'tax', tax_type: 'BIC', period: '2026', label: 'Acompte BIC 2026', due_date: '2026-12-15', amount: '150000' } });
  check('impôt enregistré', tax.status === 201 && tax.body.tax_type === 'BIC', tax.body);
  check('impôt sans nature refusé', (await call('POST', '/dues', { ...J(t0), body: { idempotency_key: key('d'), kind: 'tax', label: 'X', due_date: '2026-12-15', amount: '10' } })).status === 400);
  check('lecteur ne peut pas créer une échéance', (await call('POST', '/dues', { ...J(lec.t), body: { idempotency_key: key('d'), kind: 'tax', tax_type: 'TVA', label: 'X', due_date: '2026-12-15', amount: '10' } })).status === 403);

  console.log('Règlements');
  const pk = key('p');
  const p1 = await call('POST', `/dues/${inv.body.id}/payments`, { ...J(t0), body: { idempotency_key: pk, amount: '20000', account_id: acc.id } });
  check('règlement partiel', p1.status === 201 && Number(p1.body.remaining) === 15000, p1.body);
  const p1b = await call('POST', `/dues/${inv.body.id}/payments`, { ...J(t0), body: { idempotency_key: pk, amount: '20000', account_id: acc.id } });
  check('rejeu idempotent, une seule sortie', p1b.body.replay === true && p1b.body.id === p1.body.id);
  check('dépassement refusé', (await call('POST', `/dues/${inv.body.id}/payments`, { ...J(t0), body: { idempotency_key: key('p'), amount: '15000.01', account_id: acc.id } })).status === 400);
  check('solde du reste', (await call('POST', `/dues/${inv.body.id}/payments`, { ...J(t0), body: { idempotency_key: key('p'), amount: '15000', account_id: acc.id } })).status === 201);
  const enc = await call('POST', `/dues/${a1.body.id}/payments`, { ...J(t0), body: { idempotency_key: key('p'), amount: '80000', account_id: acc.id } });
  check('encaissement de la prestation', enc.status === 201 && Number(enc.body.remaining) === 0, enc.body);
  const bal2 = (await call('GET', '/financial-accounts', J(t0))).body.find((x) => x.id === acc.id);
  check('solde = 1 000 000 − 35 000 + 80 000', Number(bal2.balance) === 1045000, bal2);
  check('annulation refusée après règlement', (await call('DELETE', `/dues/${inv.body.id}`, J(t0))).status === 409);
  check('annulation d’une échéance sans règlement', (await call('DELETE', `/dues/${tax.body.id}`, J(t0))).status === 200);
  check('emprunt financé non annulable', (await call('DELETE', `/dues/${emp.body.id}`, J(t0))).status === 409);
  check('suppression d’un tiers utilisé refusée', (await call('DELETE', `/partners/${sup.body.id}`, J(t0))).status === 409);

  console.log('États');
  const l = (await call('GET', '/dues?kind=supplier_invoice&state=all', J(t0))).body;
  check('liste fournisseurs : réglée en totalité', l.rows.length === 1 && Number(l.rows[0].remaining) === 0 && Number(l.totals.paid) === 35000, l);
  check('filtre « à régler » vide', (await call('GET', '/dues?kind=supplier_invoice&state=open', J(t0))).body.rows.length === 0);
  const bic = (await call('GET', '/dues/bic-estimate?year=' + new Date().getFullYear() + '&rate=25', J(t0))).body;
  check('BIC : produits 90 000, charges 35 000 + 80 000 d’intérêts', Number(bic.produits) === 90000 && Number(bic.charges) === 115000 && Number(bic.bic_estime) === 0, bic);

  console.log('Produit déclaré du convoi');
  const prod = (await call('POST', '/products', { ...J(t0), body: { name: 'Cacao', buy_price_per_kg: '1200', sell_price_per_kg: '1300' } })).body;
  const prod2 = (await call('POST', '/products', { ...J(t0), body: { name: 'Café', buy_price_per_kg: '900' } })).body;
  const colr = (await call('POST', '/collectors', { ...J(t0), body: { user_id: col.id } })).body;
  const wh = (await call('POST', '/warehouses', { ...J(t0), body: { code: 'MC', name: 'Magasin' } })).body;
  check('délégué lit les produits', (await call('GET', '/products', J(col.t))).body.length === 2);
  const cv = await call('POST', '/convoys', { ...J(col.t), body: { idempotency_key: key('cv'), convoy_no: 'DU-1', driver_name: 'Traoré', truck_no: 'AB 1 CI', declared_kg: '980', declared_bags: 10, product_id: prod.id } });
  check('convoi déclaré avec produit', cv.status === 201 && cv.body.product_id === prod.id, cv.body);
  check('produit inconnu refusé', (await call('POST', '/convoys', { ...J(col.t), body: { idempotency_key: key('cv'), convoy_no: 'DU-X', driver_name: 'Traoré', truck_no: 'AB 1 CI', product_id: crypto.randomUUID() } })).status === 400);
  const exp = (await call('GET', `/convoys/expected?collector_id=${colr.id}`, J(mag.t))).body;
  check('le magasinier voit le produit annoncé', exp[0]?.product_id === prod.id && exp[0]?.product === 'Cacao', exp);
  const r = await call('POST', '/convoys/receive', { ...J(mag.t), body: { idempotency_key: key('rc'), collector_id: colr.id, convoy_no: 'DU-1', warehouse_id: wh.id, bags: 10, gross_kg: '1000', bags_unloaded: 10, product_id: prod2.id } });
  check('le magasinier peut changer le produit (Café)', r.status === 201 && r.body.product_id === prod2.id, r.body);
  const cv2 = await call('POST', '/convoys', { ...J(col.t), body: { idempotency_key: key('cv'), convoy_no: 'DU-2', driver_name: 'Traoré', truck_no: 'AB 1 CI', declared_kg: '980', product_id: prod.id } });
  const r2 = await call('POST', '/convoys/receive', { ...J(mag.t), body: { idempotency_key: key('rc'), collector_id: colr.id, convoy_no: 'DU-2', warehouse_id: wh.id, bags: 10, gross_kg: '1000', bags_unloaded: 10 } });
  check('sans choix, le produit annoncé est retenu', r2.status === 201 && r2.body.product_id === prod.id, r2.body);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})();
