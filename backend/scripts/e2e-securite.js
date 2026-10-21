// Sécurité : connexion (énumération, verrouillage, force brute), mots de passe, jetons, isolation entre coopératives,
// injections, tailles de requêtes, en-têtes, documentation d'API. À lancer sur une API démarrée en NODE_ENV=production,
// SANS LOGIN_THROTTLE_LIMIT (limite par défaut : 10 connexions par minute et par adresse). Variable : API (défaut http://localhost:3113/v1).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3113/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (org) h['x-organization-id'] = org;
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
const pw = 'MotDePasseSolide2026!';
const login = async (email, password) => call('POST', '/auth/login', { body: { email, password } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let admRes = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  if (admRes.status === 429) { await sleep(61000); admRes = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD); }
  const adm = admRes.body.access_token;
  const mkOrg = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    const r = await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
    return { org, mail, r };
  };
  const A = await mkOrg('SA'), B = await mkOrg('SB');
  const tA = (await login(A.mail, pw)).body.access_token, tB = (await login(B.mail, pw)).body.access_token;

  console.log('Politique de mot de passe');
  for (const [label, p] of [['trop court', 'Ab1!xyz'], ['mot courant', 'Password2026!'], ['répétitif', 'aaaaaaaaaaaa'], ['deux sortes seulement', 'motsimplesansrien'], ['suite prévisible', 'Abcd1234567!'], ['contient l\'e-mail', `${A.mail.split('@')[0]}X9!`]]) {
    const r = await call('POST', `/organizations/${A.org.id}/admins`, { token: adm, body: { email: `x${crypto.randomBytes(3).toString('hex')}@t.test`, full_name: 'X', password: p.length < 12 ? p + 'zz' : p } });
    check(`refusé : ${label}`, r.status === 400, r);
  }
  const good = await call('POST', `/organizations/${A.org.id}/admins`, { token: adm, body: { email: `ok${run}@t.test`, full_name: 'Ok', password: 'Phrase de passe très longue 2026' } });
  check('phrase de passe longue acceptée', good.status === 201, good);
  const ch = await call('POST', '/auth/change-password', { token: tA, body: { current_password: pw, new_password: 'azerty12345' } });
  check('changement vers un mot de passe faible refusé', ch.status === 400, ch);

  console.log('Connexion : pas de fuite d\'information');
  const unknown = await login(`inconnu.${run}@t.test`, 'nimportequoi-1A!');
  const wrong = await login(A.mail, 'mauvais-mot-de-passe-1A!');
  check('compte inconnu et mauvais mot de passe : même réponse', unknown.status === 401 && wrong.status === 401 && JSON.stringify(unknown.body) === JSON.stringify(wrong.body), [unknown.body, wrong.body]);
  const t0 = Date.now(); await login(`inconnu2.${run}@t.test`, 'x-Aa1-longpassword'); const dUnknown = Date.now() - t0;
  const t1 = Date.now(); await login(A.mail, 'x-Aa1-longpassword-faux'); const dWrong = Date.now() - t1;
  check('durée comparable (pas de devinette d\'adresse par le temps)', Math.abs(dUnknown - dWrong) < Math.max(150, dWrong), { dUnknown, dWrong });
  check('adresse e-mail démesurée refusée', (await login('a'.repeat(300) + '@t.test', 'x')).status === 400);
  check('mot de passe démesuré refusé', (await login(A.mail, 'x'.repeat(5000))).status === 400);
  check('libellé d\'appareil démesuré refusé', (await call('POST', '/auth/login', { body: { email: A.mail, password: pw, device_label: 'x'.repeat(500) } })).status === 400);

  console.log('Verrouillage du compte et limite de débit');
  await sleep(61000); // la fenêtre de la limite de débit (1 minute) repart de zéro
  // Cible dédiée : 5 échecs verrouillent le compte, la réponse reste identique.
  const victim = `ok${run}@t.test`;
  let last;
  for (let i = 0; i < 5; i++) last = await login(victim, 'Faux-mot-de-passe-1A!' + i);
  const lockedGood = await login(victim, 'Phrase de passe très longue 2026');
  check('compte verrouillé : même message que « identifiants invalides »', lockedGood.status === 401 && JSON.stringify(lockedGood.body) === JSON.stringify(wrong.body), lockedGood);
  let got429 = false;
  for (let i = 0; i < 15 && !got429; i++) got429 = (await login(`spam${i}.${run}@t.test`, 'x-Aa1-longpassword')).status === 429;
  check('force brute : limite de 10 connexions par minute (429)', got429);
  check('la limite ne bloque pas les routes ordinaires', (await call('GET', '/me', { token: tA })).status !== 429);

  console.log('Jetons');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = JSON.parse(Buffer.from(tA.split('.')[1], 'base64url').toString());
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
  check('jeton « alg: none » refusé', (await call('GET', '/me', { token: none })).status === 401);
  const tampered = tA.split('.'); tampered[1] = b64({ ...payload, sub: '00000000-0000-0000-0000-000000000000' });
  check('jeton falsifié refusé', (await call('GET', '/me', { token: tampered.join('.') })).status === 401);
  check('jeton aléatoire refusé', (await call('GET', '/me', { token: 'abc.def.ghi' })).status === 401);
  check('sans jeton : refusé', (await call('GET', '/producers', { org: A.org.id })).status === 401);
  const sess = await call('POST', '/auth/refresh', { body: { refresh_token: 'inexistant' } });
  check('renouvellement avec un jeton inventé refusé', sess.status === 401);

  console.log('Isolation entre coopératives et injections');
  const pA = (await call('POST', '/producers', { token: tA, org: A.org.id, body: { last_name: 'Secret', first_names: 'A', village: 'V', section: 'S1' } })).body.producer;
  check('producteur créé', !!pA?.id, pA);
  check('autre coopérative : en-tête d\'organisation étrangère refusé (403)', (await call('GET', '/producers', { token: tB, org: A.org.id })).status === 403);
  const listB = (await call('GET', '/producers', { token: tB, org: B.org.id })).body;
  check('la coopérative B ne voit pas le producteur de A', !JSON.stringify(listB).includes(pA.id));
  check('accès direct par identifiant (B → producteur de A) : introuvable', [403, 404].includes((await call('GET', `/producers/${pA.id}`, { token: tB, org: B.org.id })).status));
  for (const inj of ["' OR 1=1 --", "'; DROP TABLE producers; --", '" OR ""="', '%00', '${7*7}', '../../etc/passwd']) {
    const r = await call('GET', `/producers?q=${encodeURIComponent(inj)}&section=${encodeURIComponent(inj)}`, { token: tA, org: A.org.id });
    check(`injection dans la recherche sans erreur serveur : ${inj.slice(0, 18)}`, r.status < 500, r.status);
  }
  const still = (await call('GET', '/producers', { token: tA, org: A.org.id })).body;
  check('la table existe toujours après les injections', JSON.stringify(still).includes(pA.id));
  check('identifiant non UUID refusé (400)', (await call('GET', `/producers/1%27%20OR%20%271`, { token: tA, org: A.org.id })).status === 400);
  const xss = await call('POST', '/producers', { token: tA, org: A.org.id, body: { last_name: '<script>alert(1)</script>', first_names: 'X', village: 'V', section: 'S1' } });
  check('texte HTML stocké tel quel (l\'interface l\'échappe) ou refusé, jamais d\'erreur serveur', xss.status < 500, xss.status);
  check('champ inconnu refusé (affectation de masse)', (await call('POST', '/producers', { token: tA, org: A.org.id, body: { last_name: 'Z', first_names: 'Z', village: 'V', section: 'S1', organization_id: B.org.id, status: 'active' } })).status === 400);

  console.log('Tailles, en-têtes, documentation');
  const big = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(3 * 1024 * 1024) });
  const rb = await call('POST', '/auth/login', { raw: big, headers: { 'content-type': 'application/json' } }).catch((e) => ({ status: 'erreur', e }));
  check('corps de 3 Mo sur une route anonyme refusé (413)', rb.status === 413, rb.status);
  const h = (await call('GET', '/me', { token: tA })).headers;
  check('réponses non mises en cache (no-store)', /no-store/.test(h.get('cache-control') ?? ''), h.get('cache-control'));
  check('en-têtes de sécurité (nosniff, HSTS ou CSP)', h.get('x-content-type-options') === 'nosniff' && !!(h.get('strict-transport-security') || h.get('content-security-policy')), [...h.keys()]);
  check('pas d\'en-tête X-Powered-By', !h.get('x-powered-by'));
  check('documentation d\'API absente en production', (await call('GET', '/docs')).status === 404);
  check('métriques fermées sans jeton', [404, 401].includes((await call('GET', '/metrics')).status));
  const err = await call('GET', '/producers/not-a-uuid', { token: tA, org: A.org.id });
  check('erreurs sans trace interne', !/at .*\.(ts|js):\d+|node_modules/.test(JSON.stringify(err.body)));
  const pre = await fetch(API + '/producers', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  check('CORS : origine inconnue non autorisée', !pre.headers.get('access-control-allow-origin'));

  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
