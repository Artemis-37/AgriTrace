// Le prix au kilo n'est fixé que par l'administrateur de la coopérative (traite, puis actualisation) ; la caisse le reprend sans pouvoir le saisir.
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
  const org = (await call('POST', '/organizations', { token: plat, body: { code: 'PX' + run, name: 'PX' + run } })).body;
  const mail = `px.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: plat, body: { email: mail, full_name: 'Admin', password: pw } });
  const A = { token: await login(mail), org: org.id };
  const std = async (code) => (await call('POST', '/roles/standard', { ...A, body: { code } })).body;
  const mk = async (code) => { const r = await std(code); const email = `${code}.${run}@t.test`; const u = (await call('POST', '/users', { ...A, body: { email, full_name: code, password: pw, role_id: r.id } })).body; return { id: u.id, J: { token: await login(email), org: org.id } }; };
  const cai = await mk('caissier'), mag = await mk('magasinier'), adg = await mk('adg'), dir = await mk('direction'), col = await mk('collecteur');
  const vc = (await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao' } })).body;
  const camp = (await call('POST', '/campaigns', { ...A, body: { value_chain_id: vc.id, code: 'C26', name: 'Traite 2026-2027', starts_on: '2025-10-01', ends_on: '2027-12-31' } })).body;
  const wh = (await call('POST', '/warehouses', { ...A, body: { code: 'M1', name: 'Magasin' } })).body;
  const k = (await call('POST', '/collectors', { ...A, body: { user_id: col.id } })).body;
  await call('POST', '/cash-registers', { ...A, body: { name: 'Caisse' } });

  for (const [who, u] of [['caissier', cai], ['ADG', adg], ['direction', dir], ['magasinier', mag]]) {
    check(`${who} ne peut pas créer un produit ni fixer un prix`, (await call('POST', '/products', { ...u.J, body: { name: 'X' + who, buy_price_per_kg: '999' } })).status === 403);
  }
  check('le caissier ne peut pas ouvrir une campagne', (await call('POST', '/campaigns', { ...cai.J, body: { value_chain_id: vc.id, code: 'ZZ', name: 'ZZ', starts_on: '2027-01-01', ends_on: '2027-12-31' } })).status === 403);
  check('ni créer un barème de prix', (await call('POST', '/price-schedules', { ...adg.J, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).status === 403);

  const prod = (await call('POST', '/products', { ...A, body: { name: 'Cacao', buy_price_per_kg: '1000', sell_price_per_kg: '1500', campaign_id: camp.id } })).body;
  check('l\'administrateur crée le produit avec le prix de la traite', prod.id && Number(prod.buy_price_per_kg) === 1000, prod);
  check('tous les rôles voient le prix', Number((await call('GET', '/products', cai.J)).body[0].buy_price_per_kg) === 1000);
  const recv = async (no) => (await call('POST', '/convoys/receive', { ...mag.J, body: { idempotency_key: 'rv-' + run + no, collector_id: k.id, convoy_no: no, warehouse_id: wh.id, campaign_id: camp.id, product_id: prod.id, gross_kg: '1000', bags: 10, bags_unloaded: 0, driver_name: 'Chauffeur', truck_no: 'AB 1 CI' } })).body;
  const r1 = await recv('PX-1');
  const q = (await call('GET', '/convoys/cashier-queue', cai.J)).body;
  check('la file de la caisse porte le prix officiel', Number(q.find((x) => x.id === r1.id)?.official_price) === 1000, q);
  check('le caissier ne peut pas saisir un autre prix', (await call('POST', `/convoy-receptions/${r1.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-a-' + run, unit_price: '1200' } })).status === 403);
  const s1 = await call('POST', `/convoy-receptions/${r1.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-b-' + run } });
  check('règlement au prix de la traite (1 000 × 1 000 kg)', s1.status < 300 && Number(s1.body.amount) === 1000000 && Number(s1.body.unit_price) === 1000, s1.body);
  // Actualisation par l'administrateur : nouveau prix pour la traite, repris aussitôt
  const up = await call('POST', `/products/${prod.id}/prices`, { ...A, body: { campaign_id: camp.id, buy_price_per_kg: '1100' } });
  check('actualisation du prix par l\'administrateur', up.status < 300 && Number(up.body.buy_price_per_kg) === 1100, up.body);
  check('le caissier ne peut pas actualiser', (await call('POST', `/products/${prod.id}/prices`, { ...cai.J, body: { buy_price_per_kg: '5' } })).status === 403);
  const r2 = await recv('PX-2');
  const s2 = await call('POST', `/convoy-receptions/${r2.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-c-' + run } });
  check('le nouveau prix est repris (1 100 × 1 000 kg)', s2.status < 300 && Number(s2.body.amount) === 1100000, s2.body);
  const hist = (await call('GET', `/products/${prod.id}/prices`, A)).body;
  check('historique : prix de départ et actualisation', hist.length === 2 && Number(hist[0].buy_price_per_kg) === 1100 && hist[0].campaign_name === 'Traite 2026-2027', hist);
  // Transport et retenue : préenregistrés dans le profil du délégué par l'administrateur
  check('le caissier ne peut pas fixer les tarifs du délégué', (await call('PUT', `/collectors/${k.id}/rates`, { ...cai.J, body: { transport_per_kg: '1' } })).status === 403);
  const rt = await call('PUT', `/collectors/${k.id}/rates`, { ...A, body: { transport_per_kg: '20', retention_per_kg: '10' } });
  check('l\'administrateur fixe transport 20 et retenue 10', rt.status < 300 && Number(rt.body.transport_per_kg) === 20 && Number(rt.body.retention_per_kg) === 10, rt.body);
  const r4 = await recv('PX-4');
  const q4 = (await call('GET', '/convoys/cashier-queue', cai.J)).body.find((x) => x.id === r4.id);
  check('la file de la caisse porte les tarifs du délégué', Number(q4?.transport_unit) === 20 && Number(q4?.retention_per_kg) === 10, q4);
  check('le caissier ne peut pas saisir un autre transport', (await call('POST', `/convoy-receptions/${r4.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-f-' + run, transport_unit: '0' } })).status === 403);
  check('ni une autre retenue', (await call('POST', `/convoy-receptions/${r4.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-g-' + run, retention_per_kg: '0' } })).status === 403);
  const s4 = await call('POST', `/convoy-receptions/${r4.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-h-' + run } });
  check('règlement : 1 100 000 + transport 20 000 − retenue 10 000 = 1 110 000', s4.status < 300 && Number(s4.body.amount) === 1110000 && Number(s4.body.retention_amount) === 10000, s4.body);
  // Produit sans prix : la caisse est bloquée
  const noP = (await call('POST', '/products', { ...A, body: { name: 'Café' } })).body;
  const r3 = (await call('POST', '/convoys/receive', { ...mag.J, body: { idempotency_key: 'rv3' + run, collector_id: k.id, convoy_no: 'PX-3', warehouse_id: wh.id, campaign_id: camp.id, product_id: noP.id, gross_kg: '500', bags: 5, bags_unloaded: 0, driver_name: 'Chauffeur', truck_no: 'AB 1 CI' } })).body;
  const s3 = await call('POST', `/convoy-receptions/${r3.id}/settle`, { ...cai.J, body: { idempotency_key: 'idem-d-' + run } });
  check('produit sans prix fixé : règlement refusé (409)', s3.status === 409, s3.body);
  const adm3 = await call('POST', `/convoy-receptions/${r3.id}/settle`, { ...A, body: { idempotency_key: 'idem-e-' + run, unit_price: '600' } });
  check('l\'administrateur peut régler en indiquant le prix (300 000 + transport 10 000 − retenue 5 000)', adm3.status < 300 && Number(adm3.body.amount) === 305000, adm3.body);
  // Ventes : le prix de vente au kilo est aussi celui de l'administrateur
  const ach = await mk('responsable_logistique');
  const buyer = (await call('POST', '/buyers', { ...A, body: { code: 'AC1', name: 'Négoce (fictif)', country: 'FR', currency: 'XOF', payment_terms_days: 30 } })).body;
  const order = (p) => call('POST', '/sales-orders', { ...ach.J, body: { idempotency_key: 'ord-' + p + '-' + run, buyer_id: buyer.id, value_chain_id: vc.id, campaign_id: camp.id, lines: [{ product_id: prod.id, quantity_kg: '1000', unit_price: p }] } });
  const o1 = await order('1500'); check('commande au prix de vente officiel (1 500)', o1.status < 300, o1.body);
  check('l\'acheteur ne peut pas modifier le prix de vente', (await order('1000')).status === 403);
  console.log(`\n${ok} vérifications réussies, ${ko} échecs`); process.exit(ko ? 1 : 0);
})();
