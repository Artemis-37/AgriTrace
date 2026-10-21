// Recherche et filtre des producteurs par section (coach inclus).
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
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
const pw = 'MotDePasseSolide2026!';
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: pw } })).body.access_token;

(async () => {
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const mk = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
    return { org, t0: await login(mail) };
  };
  const A = await mk('PS'), B = await mk('PT');
  const J = (o, t) => ({ token: t ?? o.t0, org: o.org.id });
  const prod = (o, last, first, village, section) => call('POST', '/producers', { ...J(o), body: { last_name: last, first_names: first, village, section } });
  for (const [l, f, v, s] of [['KONE', 'Awa', 'Hiré', 'S1'], ['YAO', 'Kouadio', 'Hiré', 'S1'], ['TRAORE', 'Moussa', 'Zoukougbeu', 'S2'], ['DIALLO', 'Fatou', 'Tiassalé', 'S3'], ['KONAN', 'Awa', 'Tiassalé', 'S3'], ['SANS', 'Section', 'Nulle', undefined]]) await prod(A, l, f, v, s);
  await prod(B, 'AUTRE', 'Coop', 'X', 'S9');
  const r = await call('POST', '/roles/standard', { ...J(A), body: { code: 'coach' } });
  const email = `coach.${run}@t.test`;
  await call('POST', '/users', { ...J(A), body: { email, full_name: 'Coach', password: pw, role_id: r.body.id } });
  const tc = await login(email);

  const sec = await call('GET', '/producers/sections', J(A, tc));
  check('le coach obtient les sections avec leur effectif', sec.status === 200 && JSON.stringify(sec.body.map((s) => [s.section, s.producers])) === JSON.stringify([['S1', 2], ['S2', 1], ['S3', 2]]), sec.body);
  check('les producteurs sans section sont ignorés dans la liste des sections', !sec.body.some((s) => !s.section));
  check('sections d\'une autre coopérative absentes', !sec.body.some((s) => s.section === 'S9'));
  const s3 = await call('GET', '/producers?section=S3', J(A, tc));
  check('filtre par section : 2 producteurs de S3', s3.body.length === 2 && s3.body.every((p) => p.section === 'S3'), s3.body.length);
  const both = await call('GET', '/producers?section=S3&q=awa', J(A, tc));
  check('recherche + section combinées', both.body.length === 1 && both.body[0].last_name === 'KONAN', both.body);
  check('recherche seule : tous les « Awa »', (await call('GET', '/producers?q=awa', J(A, tc))).body.length === 2);
  check('section inconnue : liste vide', (await call('GET', '/producers?section=Z', J(A, tc))).body.length === 0);
  const rr = await call('POST', '/roles', { ...J(A), body: { code: 'rien', name: 'Sans droit', permissions: ['messages:use'] } });
  const e = `rien.${run}@t.test`;
  const uu = await call('POST', '/users', { ...J(A), body: { email: e, full_name: 'Sans droit', password: pw, role_id: rr.body.id } });
  const tr = await login(e);
  const ns = await call('GET', '/producers/sections', { token: tr, org: A.org.id });
  check('sans droit de lecture : refusé', ns.status === 403, [rr.status, uu.status, ns.status, ns.body]);

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
