// Un utilisateur peut cumuler plusieurs rôles : droits additionnés, ajout/retrait, garde-fous.
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
(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'RM' + run, name: 'RM' + run } })).body;
  const mail = `rm.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw); const J = (t) => ({ token: t, org: org.id });
  const mk = async (code) => (await call('POST', '/roles/standard', { ...J(t0), body: { code } })).body;
  const rMag = await mk('magasinier'), rCai = await mk('caissier');
  const email = `multi.${run}@t.test`;
  const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: 'Multi', password: pw, role_id: rMag.id } })).body;
  const tu = await login(email, pw);
  const perms = async () => new Set((await call('GET', '/me', J(tu))).body.permissions ?? []);
  const p1 = await perms();
  check('magasinier seul : pas de caisse', !p1.has('cash:operate'));
  const add = await call('POST', `/users/${u.id}/roles`, { ...J(t0), body: { role_id: rCai.id, reason: 'Remplace le caissier' } });
  check('ajout du rôle caissier', add.status === 201 || add.status === 200, add);
  check('doublon refusé', (await call('POST', `/users/${u.id}/roles`, { ...J(t0), body: { role_id: rCai.id, reason: 'Encore' } })).status === 409);
  const p2 = await perms();
  check('droits additionnés (stock + caisse)', p2.has('cash:operate') && [...p1].every((p) => p2.has(p)));
  const list = (await call('GET', '/users', J(t0))).body.filter((x) => x.id === u.id);
  check('liste : une seule ligne, deux rôles', list.length === 1 && list[0].role_ids.length === 2, list);
  check('retrait sans motif refusé', (await call('DELETE', `/users/${u.id}/roles/${rMag.id}`, J(t0))).status === 400);
  check('retrait du rôle magasinier', (await call('DELETE', `/users/${u.id}/roles/${rMag.id}?reason=Plus%20au%20magasin`, J(t0))).status === 200);
  check('dernier rôle non retirable', (await call('DELETE', `/users/${u.id}/roles/${rCai.id}?reason=Test%20garde`, J(t0))).status === 409);
  const p3 = await perms();
  check('droits du magasinier retirés, caisse conservée', p3.has('cash:operate') && !p3.has('stock:adjust'));
  const me = (await call('GET', '/me', J(t0))).body;
  check('on ne modifie pas ses propres rôles', (await call('POST', `/users/${me.user.id}/roles`, { ...J(t0), body: { role_id: rCai.id, reason: 'Soi-même' } })).status === 409);
  const hist = (await call('GET', `/users/${u.id}/access-history`, J(t0))).body;
  check('historique : ajout et retrait tracés', hist.some((e) => e.action === 'role_add') && hist.some((e) => e.action === 'role_remove'));
  console.log(`\n${ok} vérifications réussies, ${ko} échecs`); process.exit(ko ? 1 : 0);
})();
