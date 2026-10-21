// Coachs, collecteurs et agents de terrain : connexion par l'application mobile uniquement (le portail s'annonce par « X-Client: web »).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, web } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (web) headers['x-client'] = 'web';
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
const pw = 'MotDePasseSolide2026!';
const login = async (email, web) => (await call('POST', '/auth/login', { body: { email, password: pw }, web }));

(async () => {
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const mk = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
    return { org, mail, t0: (await login(mail)).body.access_token };
  };
  const A = await mk('MA'), B = await mk('MB');
  const J = (o, t) => ({ token: t, org: o.org.id });
  const user = async (o, role, tag) => {
    const email = `${tag}.${run}@t.test`;
    const u = (await call('POST', '/users', { ...J(o, o.t0), body: { email, full_name: tag, password: pw, role_id: role.id } })).body;
    return { email, id: u.id };
  };
  const std = async (o, code) => (await call('POST', '/roles/standard', { ...J(o, o.t0), body: { code } })).body;
  const coachR = await std(A, 'coach'), colR = await std(A, 'collecteur'), agR = await std(A, 'agent_terrain'), magR = await std(A, 'magasinier');
  check('les modèles coach, collecteur, agent de terrain sont réservés au mobile', coachR.mobile_only === true && colR.mobile_only === true && agR.mobile_only === true && magR.mobile_only === false, [coachR, magR]);
  const coach = await user(A, coachR, 'coach'), col = await user(A, colR, 'collecteur'), ag = await user(A, agR, 'agent'), mag = await user(A, magR, 'magasinier');

  console.log('Connexion');
  for (const [n, u] of [['coach', coach], ['collecteur', col], ['agent de terrain', ag]]) {
    const w = await login(u.email, true);
    check(`${n} : portail web refusé`, w.status === 403 && w.body.code === 'MOBILE_ONLY', w);
    const m = await login(u.email, false);
    check(`${n} : application mobile acceptée`, m.status === 200 && !!m.body.access_token, m);
  }
  check('magasinier : portail web accepté', (await login(mag.email, true)).status === 200);
  check('administrateur : portail web accepté', (await login(A.mail, true)).status === 200);

  console.log('Requêtes déjà connectées');
  const tc = (await login(coach.email, false)).body.access_token;
  check('mobile : requêtes acceptées', (await call('GET', '/me', { ...J(A, tc) })).status === 200);
  check('jeton obtenu hors portail mais utilisé depuis le portail : refusé', (await call('GET', '/me', { ...J(A, tc), web: true })).body.code === 'MOBILE_ONLY');
  const tm = (await login(mag.email, false)).body.access_token;
  check('magasinier depuis le portail : requêtes acceptées', (await call('GET', '/me', { ...J(A, tm), web: true })).status === 200);

  console.log('Collecteur avec un rôle personnalisé');
  const custom = (await call('POST', '/roles', { ...J(A, A.t0), body: { code: 'livreur', name: 'Livreur', permissions: ['convoys:create', 'convoys:read'] } })).body;
  const cu = await user(A, custom, 'livreur');
  await call('POST', '/collectors', { ...J(A, A.t0), body: { user_id: cu.id } });
  const tcu = (await login(cu.email, false)).body.access_token;
  check('inscrit comme collecteur : refusé depuis le portail même sans rôle réservé', (await call('GET', '/me', { ...J(A, tcu), web: true })).body.code === 'MOBILE_ONLY');
  const flag = (await call('POST', '/roles', { ...J(A, A.t0), body: { code: 'releveur', name: 'Releveur', permissions: ['producers:read'], mobile_only: true } })).body;
  check('un rôle personnalisé peut être réservé au mobile', flag.mobile_only === true, flag);
  const fu = await user(A, flag, 'releveur');
  check('… et son portail est fermé', (await login(fu.email, true)).body.code === 'MOBILE_ONLY');

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
