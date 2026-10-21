// Test de bout en bout : changement et réinitialisation de mot de passe, profil de la coopérative, rôles types.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'CP' + run, name: 'Coopérative Test ' + run } })).body;
  const mail = `cp.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });

  console.log('Rôles types');
  const tpl = (await call('GET', '/roles/templates', J(t0))).body;
  check('au moins 17 rôles types proposés', tpl.length >= 17, tpl.length);
  let created = 0;
  for (const t of tpl) { const r = await call('POST', '/roles/standard', { ...J(t0), body: { code: t.code } }); if (r.status === 201 || r.status === 200) created++; else console.log('   ', t.code, r.status, JSON.stringify(r.body).slice(0, 120)); }
  check('tous les rôles types se créent', created === tpl.length, { created, total: tpl.length });
  const roles = (await call('GET', '/roles', J(t0))).body;
  const dir = roles.find((r) => r.code === 'direction'), mag = roles.find((r) => r.code === 'magasinier');

  console.log('Mot de passe');
  const mk = async (email, role) => (await call('POST', '/users', { ...J(t0), body: { email, full_name: email, password: pw, role_id: role.id } })).body;
  const u = await mk(`u.${run}@t.test`, mag), u2 = await mk(`v.${run}@t.test`, dir);
  const tu = await login(u.email, pw);
  const tu2 = await login(u.email, pw);
  check('mauvais mot de passe actuel refusé', (await call('POST', '/auth/change-password', { token: tu, body: { current_password: 'faux-mot-de-passe', new_password: 'NouveauMotDePasse2026!' } })).status === 401);
  check('mot de passe trop court refusé', (await call('POST', '/auth/change-password', { token: tu, body: { current_password: pw, new_password: 'court' } })).status === 400);
  check('nouveau identique à l\'ancien refusé', (await call('POST', '/auth/change-password', { token: tu, body: { current_password: pw, new_password: pw } })).status === 400);
  const ch = await call('POST', '/auth/change-password', { token: tu, body: { current_password: pw, new_password: 'NouveauMotDePasse2026!' } });
  check('changement accepté', ch.status === 204, ch);
  check('les autres sessions sont fermées', (await call('GET', '/me', J(tu2))).status === 401);
  check('la session courante reste ouverte', (await call('GET', '/me', J(tu))).status === 200);
  check('connexion avec l\'ancien mot de passe refusée', !(await login(u.email, pw)));
  const tn = await login(u.email, 'NouveauMotDePasse2026!');
  check('connexion avec le nouveau mot de passe', !!tn);

  console.log('Réinitialisation par l\'administrateur');
  check('un magasinier ne peut pas réinitialiser', (await call('POST', `/users/${u2.id}/reset-password`, { ...J(tn) })).status === 403);
  const rs = await call('POST', `/users/${u.id}/reset-password`, { ...J(t0) });
  check('mot de passe temporaire fourni', rs.status === 201 && rs.body.temporary_password?.length >= 12 && rs.body.must_change_password, rs.body);
  check('ancienne session fermée', (await call('GET', '/me', J(tn))).status === 401);
  const tt = await login(u.email, rs.body.temporary_password);
  check('connexion avec le mot de passe temporaire', !!tt);
  check('/me indique le changement obligatoire', (await call('GET', '/me', J(tt))).body.must_change_password === true);
  const blocked = await call('GET', '/convoys', J(tt));
  check('toute autre requête est bloquée', blocked.status === 403 && JSON.stringify(blocked.body).includes('PASSWORD_CHANGE_REQUIRED'), blocked);
  check('changement obligatoire accepté', (await call('POST', '/auth/change-password', { token: tt, body: { current_password: rs.body.temporary_password, new_password: 'EncoreUnAutre2026!' } })).status === 204);
  check('accès rétabli', (await call('GET', '/convoys', J(tt))).status === 200);
  check('réinitialiser son propre compte refusé', (await call('POST', '/users/' + (await call('GET', '/me', J(t0))).body.user.id + '/reset-password', { ...J(t0) })).status === 400);

  console.log('Profil de la coopérative');
  const p0 = await call('GET', '/organization/profile', J(tt));
  check('profil lisible par un membre', p0.status === 200 && p0.body.currency === 'XOF' && p0.body.name.startsWith('Coopérative Test'), p0.body);
  check('un magasinier ne peut pas modifier le profil', (await call('PUT', '/organization/profile', { ...J(await login(u.email, 'EncoreUnAutre2026!')), body: { phone: '0102' } })).status === 403);
  const p1 = await call('PUT', '/organization/profile', { ...J(t0), body: { commercial_name: 'Coop Démo', address: 'Daloa', phone: '+225 01 02 03 04', email: 'contact@demo.test', currency: 'XOF', default_language: 'fr' } });
  check('profil enregistré', p1.status === 200 && p1.body.commercial_name === 'Coop Démo' && p1.body.address === 'Daloa', p1.body);
  check('devise invalide refusée', (await call('PUT', '/organization/profile', { ...J(t0), body: { currency: 'xof' } })).status === 400);

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})();
