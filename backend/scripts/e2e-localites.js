// Test de bout en bout : liste des localités (région > quartier > lieu) servant aux listes en cascade de la fiche producteur.
const API = process.env.API || 'http://localhost:3000/v1';
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
async function call(method, path, { token, org, body } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (org) headers['x-organization-id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}
const login = async (e, p) => (await call('POST', '/auth/login', { body: { email: e, password: p } })).body.access_token;
(async () => {
  const run = Math.random().toString(16).slice(2, 8).toUpperCase(), pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'LC' + run, name: 'LC' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `lc.${run}@t.test`, full_name: 'Chef', password: pw } });
  const J = { token: await login(`lc.${run}@t.test`, pw), org: org.id };
  check('aucune localité au départ', (await call('GET', '/producers/localities', J)).body.length === 0);
  const mk = (n, region, department, sub_prefecture) => call('POST', '/producers', { ...J, body: { last_name: n, first_names: 'Test', region, department, sub_prefecture } });
  check('producteur 1', (await mk('A', 'Sud-Ouest', 'San Pedro', 'Grobonou Dan')).status === 201);
  check('producteur 2', (await mk('B', 'Sud-Ouest', 'San Pedro', 'Grobonou Dan')).status === 201);
  check('producteur 3', (await mk('C', 'Sud', 'Tiassale', 'Kouassi kro')).status === 201);
  const l = (await call('GET', '/producers/localities', J)).body;
  check('2 localités distinctes regroupées', l.length === 2, l);
  check('compte des producteurs', l.find((x) => x.sub_prefecture === 'Grobonou Dan')?.producers === 2, l);
  check('hiérarchie conservée', l.find((x) => x.region === 'Sud')?.department === 'Tiassale', l);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
