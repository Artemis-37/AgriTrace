/* Connexion à la caisse : seul le caissier se connecte / se déconnecte, sans fonds ni comptage. */
const API = process.env.API; let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 200) : ''); } };
async function call(m, p, { token, org, body } = {}) { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; }
(async () => {
  const run = Math.random().toString(36).slice(2, 7).toUpperCase(); const pw = 'Test-Caisse-2026!';
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'CC' + run, name: 'CC' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `cc.${run}@t.test`, full_name: 'Chef', password: pw } });
  const A = { token: (await call('POST', '/auth/login', { body: { email: `cc.${run}@t.test`, password: pw } })).body.access_token, org: org.id };
  const role = (await call('POST', '/roles/standard', { ...A, body: { code: 'caissier' } })).body;
  await call('POST', '/users', { ...A, body: { email: `cais.${run}@t.test`, full_name: 'Caissier', password: pw, role_id: role.id } });
  const C = { token: (await call('POST', '/auth/login', { body: { email: `cais.${run}@t.test`, password: pw } })).body.access_token, org: org.id };
  const reg = (await call('POST', '/cash-registers', { ...A, body: { name: 'Principale' } })).body;
  check('l\'administrateur ne se connecte pas à la caisse', (await call('POST', `/cash-registers/${reg.id}/sessions`, { ...A, body: {} })).status === 403);
  const s = await call('POST', `/cash-registers/${reg.id}/sessions`, { ...C, body: {} });
  check('le caissier se connecte sans fonds de caisse', s.status === 201 && s.body.id, s.body);
  const l = (await call('GET', '/cash-registers', C)).body.find((x) => x.id === reg.id);
  check('la caisse indique le caissier connecté', l.open_session_id === s.body.id && !!l.open_session_by, l);
  check('une seconde connexion sur la même caisse est refusée', (await call('POST', `/cash-registers/${reg.id}/sessions`, { ...C, body: {} })).status >= 400);
  check('l\'administrateur ne déconnecte pas le caissier', (await call('POST', `/cash-sessions/${s.body.id}/close`, { ...A, body: {} })).status === 403);
  const c = await call('POST', `/cash-sessions/${s.body.id}/close`, { ...C, body: {} });
  check('le caissier se déconnecte : aucun comptage, aucun écart', c.status < 300 && c.body.variance == null, c.body);
  const l2 = (await call('GET', '/cash-registers', C)).body.find((x) => x.id === reg.id);
  check('la caisse n\'a plus de session ouverte', !l2.open_session_id, l2);
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
