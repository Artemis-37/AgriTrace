// Association des postes : code à usage unique, jeton propre, révocation immédiate, règle « association obligatoire .
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, dev } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (dev) headers['x-device-token'] = arguments[2].dev;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'PO' + run, name: 'PO' + run } })).body;
  const mail = `po.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw); const J = (t, dev) => ({ token: t, org: org.id, dev });

  const cd = await call('POST', '/workstations/pairing-codes', { ...J(t0), body: { name: 'Caisse 01', function_label: 'Caisse' } });
  check('code d\'association : 8 caractères, valable 15 min', cd.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(cd.body.code), cd.body);
  check('code inconnu refusé', (await call('POST', '/workstations/pair', { body: { code: 'ZZZZ-ZZZZ' } })).status === 403);
  const p = await call('POST', '/workstations/pair', { body: { code: cd.body.code.toLowerCase() } });
  check('le poste échange le code contre son jeton (sans être connecté)', p.status === 201 && p.body.device_token?.length > 30 && p.body.name === 'Caisse 01', p.body);
  check('code à usage unique', (await call('POST', '/workstations/pair', { body: { code: cd.body.code } })).status === 403);

  const list = await call('GET', '/workstations', J(t0, p.body.device_token));
  check('liste : poste actif, règle non imposée, ce poste reconnu', list.status === 200 && list.body.workstations.length === 1 && list.body.required === false && list.body.current_is_paired === true, list.body);
  check('sans association, la règle ne peut pas être imposée (pas d\'auto-verrouillage)', (await call('PUT', '/workstations/policy', { ...J(t0), body: { required: true } })).status === 400);

  const on = await call('PUT', '/workstations/policy', { ...J(t0, p.body.device_token), body: { required: true } });
  check('association obligatoire activée depuis un poste associé', on.status === 200 && on.body.required === true, on.body);
  const nok = await call('GET', '/me', J(t0));
  check('appareil inconnu : refusé même avec un bon mot de passe', nok.status === 403 && nok.body.code === 'workstation_required', nok.body);
  check('mauvais jeton : refusé', (await call('GET', '/me', J(t0, 'x'.repeat(43)))).status === 403);
  check('poste associé : accepté', (await call('GET', '/me', J(t0, p.body.device_token))).status === 200);

  const cd2 = await call('POST', '/workstations/pairing-codes', { ...J(t0, p.body.device_token), body: { name: 'Magasin' } });
  const p2 = await call('POST', '/workstations/pair', { body: { code: cd2.body.code } });
  check('deuxième poste associé', p2.status === 201);
  const ws = (await call('GET', '/workstations', J(t0, p.body.device_token))).body.workstations;
  const caisse = ws.find((w) => w.name === 'Caisse 01');
  check('révocation du poste « Caisse 01 »', (await call('POST', `/workstations/${caisse.id}/revoke`, { ...J(t0, p2.body.device_token), body: { reason: 'Poste volé' } })).status === 201);
  const rev = await call('GET', '/me', J(t0, p.body.device_token));
  check('poste révoqué : refusé immédiatement', rev.status === 403 && rev.body.code === 'workstation_required', rev.body);
  check('l\'autre poste fonctionne toujours', (await call('GET', '/me', J(t0, p2.body.device_token))).status === 200);

  const off = await call('PUT', '/workstations/policy', { ...J(t0, p2.body.device_token), body: { required: false } });
  check('règle désactivable', off.status === 200 && (await call('GET', '/me', J(t0))).status === 200);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
