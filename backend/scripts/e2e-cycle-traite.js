// Test de bout en bout : cycle de vie d'une traite (ouverture/clôture automatiques, alerte avant la fin, copie des prix, bilan).
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
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'CT' + run, name: 'CT' + run } })).body;
  const mail = `ct.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t = await login(mail, pw); const J = { token: t, org: org.id };
  const chain = (await call('GET', '/value-chains', J)).body[0] ?? (await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao' } })).body;
  const prod = (await call('POST', '/products', { ...J, body: { name: 'Cacao ' + run } })).body;
  console.log('Cycle de vie des traites');
  // Traite échue (fin hier) avec un prix
  const old = (await call('POST', '/campaigns', { ...J, body: { value_chain_id: chain.id, code: 'OLD' + run, name: 'Ancienne ' + run, starts_on: iso(-180), ends_on: iso(-1), status: 'open', traite: 'grande' } })).body;
  check('traite échue créée', !!old.id, old);
  await call('POST', `/campaigns/${old.id}/products/${prod.id}`, J);
  await call('POST', `/products/${prod.id}/prices`, { ...J, body: { campaign_id: old.id, buy_price_per_kg: '1200', sell_price_per_kg: '1500' } });
  // Traite planifiée dont le début est arrivé
  const plan = (await call('POST', '/campaigns', { ...J, body: { value_chain_id: chain.id, code: 'PLN' + run, name: 'Planifiée ' + run, starts_on: iso(0), ends_on: iso(10), status: 'planned', traite: 'petite', copy_from_campaign_id: old.id } })).body;
  check('copie des prix à la création', plan.prices_copied === 1, plan);
  const scan = await call('POST', '/notifications/scan', J);
  check('scan réussi', scan.status < 300, scan);
  const list = (await call('GET', '/campaigns', J)).body;
  const o = list.find((k) => k.id === old.id), p = list.find((k) => k.id === plan.id);
  check('traite échue clôturée automatiquement', o.status === 'closed' && !!o.closed_at, o);
  check('traite planifiée ouverte automatiquement', p.status === 'open', p);
  check('prix repris dans la nouvelle traite', p.products.length === 1 && Number(p.products[0].buy_price_per_kg) === 1200 && Number(p.products[0].sell_price_per_kg) === 1500, p.products);
  const sum = await call('GET', `/campaigns/${old.id}/summary`, J);
  check('bilan figé à la clôture', sum.status === 200 && sum.body.campaign.code === 'OLD' + run && sum.body.final_prices[0].buy === 1200, sum.body);
  const sum2 = await call('GET', `/campaigns/${plan.id}/summary`, J);
  check('bilan provisoire d\'une traite en cours', sum2.status === 200 && sum2.body.totals.kg === 0, sum2.body);
  const notes = (await call('GET', '/notifications', J)).body;
  const arr = Array.isArray(notes) ? notes : notes.items ?? notes.data ?? [];
  const kinds = arr.map((n) => n.kind);
  check('notification de clôture', kinds.includes('campaign_closed'), kinds);
  check('notification d\'ouverture', kinds.includes('campaign_opened'), kinds);
  check('alerte avant la fin (fin dans 10 jours)', kinds.includes('campaign_ending'), kinds);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
