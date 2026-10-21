// Numéro de connaissement généré : <code CCC>-<année>-<3 lettres du collecteur>-<n°>. Code CCC fictif.
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
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const year = new Date().getUTCFullYear();

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'NC' + run, name: 'NC' + run } })).body;
  const mail = `nc.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });
  const rr = await call('POST', '/roles', { ...J(t0), body: { code: 'collecteur', name: 'Collecteur', permissions: ['convoys:create', 'convoys:read', 'sync:use'] } }); if (rr.status >= 400) console.log(rr); const rCol = rr.body;
  const mk = async (name) => {
    const email = `${name.replace(/\W/g, '').toLowerCase()}.${run}@t.test`;
    const ur = await call('POST', '/users', { ...J(t0), body: { email, full_name: name, password: pw, role_id: rCol.id } }); if (ur.status >= 400) console.log('users', ur); const u = ur.body;
    const k = (await call('POST', '/collectors', { ...J(t0), body: { user_id: u.id } })).body;
    return { t: await login(email, pw), id: k.id };
  };
  const oum = await mk('Oumarou Traoré'), oum2 = await mk('Oumar Diallo'), elo = await mk('Éloïse Koné'), al = await mk('Al Bamba');
  const cv = (c, extra = {}) => call('POST', '/convoys', { ...J(c.t), body: { idempotency_key: key('cv'), driver_name: 'Chauffeur', truck_no: 'ab 1 ci', ...extra } });

  console.log('Sans code CCC : saisie manuelle comme avant');
  check('aperçu : numéro non automatique', (await call('GET', '/convoys/next-number', J(oum.t))).body.auto === false);
  check('numéro manquant refusé', (await cv(oum)).status === 400);
  const man = await cv(oum, { convoy_no: 'MANUEL-1' });
  check('numéro saisi accepté', man.status === 201 && man.body.convoy_no === 'MANUEL-1', man.body);

  console.log('Code CCC de la coopérative');
  check('code invalide refusé', (await call('PUT', '/organization/profile', { ...J(t0), body: { ccc_code: 'a b!' } })).status === 400);
  const p = await call('PUT', '/organization/profile', { ...J(t0), body: { ccc_code: 'sc000000' } });
  check('code enregistré en majuscules', p.status === 200 && p.body.ccc_code === 'SC000000', p.body);
  check('un autre champ du profil ne l\'efface pas', (await call('PUT', '/organization/profile', { ...J(t0), body: { phone: '0102' } })).body.ccc_code === 'SC000000');

  console.log('Numéros générés');
  const pv = await call('GET', '/convoys/next-number', J(oum.t));
  check('aperçu : 1er convoi d\'Oumarou', pv.body.auto === true && pv.body.convoy_no === `SC000000-${year}-OUM-1`, pv.body);
  check('aperçu avec 2 convois en attente sur l\'appareil', (await call('GET', '/convoys/next-number?pending=2', J(oum.t))).body.convoy_no === `SC000000-${year}-OUM-3`);
  const a1 = await cv(oum, { convoy_no: 'IGNORE-MOI' });
  check('1er convoi : numéro généré, valeur envoyée ignorée', a1.status === 201 && a1.body.convoy_no === `SC000000-${year}-OUM-1`, a1.body);
  const k = key('same'); const r1 = await cv(oum, { idempotency_key: k }), r2 = await cv(oum, { idempotency_key: k });
  check('2e convoi : -2', r1.body.convoy_no === `SC000000-${year}-OUM-2`, r1.body);
  check('renvoi de la même requête : même numéro, pas de saut', r2.body.convoy_no === r1.body.convoy_no && r2.body.id === r1.body.id);
  check('3e convoi : -3 (aucun trou)', (await cv(oum)).body.convoy_no === `SC000000-${year}-OUM-3`);
  const o2 = await cv(oum2);
  check('autre collecteur au même préfixe : numéro distinct (-4)', o2.body.convoy_no === `SC000000-${year}-OUM-4`, o2.body);
  check('accents retirés (Éloïse → ELO)', (await cv(elo)).body.convoy_no === `SC000000-${year}-ELO-1`);
  check('nom court complété par X (Al → ALX)', (await cv(al)).body.convoy_no === `SC000000-${year}-ALX-1`);
  check('un convoi saisi avant le code reste inchangé', (await call('GET', '/convoys', J(oum.t))).body.some((v) => v.convoy_no === 'MANUEL-1'));
  check('retirer le code : retour à la saisie', (await call('PUT', '/organization/profile', { ...J(t0), body: { ccc_code: '' } })).body.ccc_code === null && (await cv(oum)).status === 400);

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
