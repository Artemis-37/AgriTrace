// Test de bout en bout : photo de profil d'un producteur (envoi, remplacement, lecture, refus d'un format non autorisé).
const API = process.env.API || 'http://localhost:3000/v1';
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (org) headers['x-organization-id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: res.status, body: json, buf, type: res.headers.get('content-type') };
}
const login = async (e, p) => (await call('POST', '/auth/login', { body: { email: e, password: p } })).body.access_token;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fd = (buf, name) => { const f = new FormData(); f.append('file', new Blob([buf]), name); return f; };
(async () => {
  const run = Math.random().toString(16).slice(2, 8).toUpperCase(), pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'PH' + run, name: 'PH' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `ph.${run}@t.test`, full_name: 'Chef', password: pw } });
  const J = { token: await login(`ph.${run}@t.test`, pw), org: org.id };
  const prod = (await call('POST', '/producers', { ...J, body: { last_name: 'ABATTE', first_names: 'Casimir', village: 'Divo' } })).body.producer;
  check('producteur créé', !!prod.id, prod);
  console.log('Photo de profil');
  check('pas de photo au départ (404)', (await call('GET', `/producers/${prod.id}/photo`, J)).status === 404);
  check('format non autorisé refusé', (await call('POST', `/producers/${prod.id}/photo`, { ...J, form: fd(Buffer.from('%PDF-1.4 test'), 'a.pdf') })).status === 400);
  check('photo enregistrée', (await call('POST', `/producers/${prod.id}/photo`, { ...J, form: fd(png, 'p.png') })).status === 201);
  const g = await call('GET', `/producers/${prod.id}/photo`, J);
  check('photo relue identique', g.status === 200 && g.type === 'image/png' && g.buf.equals(png), g.status);
  check('remplacement accepté', (await call('POST', `/producers/${prod.id}/photo`, { ...J, form: fd(png, 'p2.png') })).status === 201);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
