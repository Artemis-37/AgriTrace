// Test de bout en bout : le code producteur n'est attribué que selon le format défini par la coopérative.
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
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'CP' + run, name: 'CP' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `cp.${run}@t.test`, full_name: 'Chef', password: pw } });
  const J = { token: await login(`cp.${run}@t.test`, pw), org: org.id };
  const mk = (n, code) => call('POST', '/producers', { ...J, body: { last_name: n, first_names: 'Test', ...(code ? { internal_code: code } : {}) } });

  console.log('Sans format défini');
  const f0 = (await call('GET', '/producers/code-format', J)).body;
  check('format non défini par défaut', f0.enabled === false && f0.next === '', f0);
  const a = (await mk('A')).body.producer;
  check('aucun code attribué automatiquement', a.internal_code === '', a);
  const b = await mk('B');
  check('plusieurs producteurs sans code acceptés', b.status === 201 && b.body.producer.internal_code === '', b.body);
  const c = await mk('C', 'MON-001');
  check('code saisi à la main accepté', c.status === 201 && c.body.producer.internal_code === 'MON-001', c.body);
  check('code déjà utilisé refusé (409)', (await mk('D', 'MON-001')).status === 409);
  const put0 = await call('PUT', `/producers/${a.id}`, { ...J, body: { internal_code: 'MON-002' } });
  check('code ajouté plus tard à un producteur sans code', put0.status === 200 && put0.body.internal_code === 'MON-002', put0.body);
  check('code déjà attribué non modifiable', (await call('PUT', `/producers/${a.id}`, { ...J, body: { internal_code: 'AUTRE-1' } })).status === 400);
  check('code vide ne remplace pas un code existant', (await call('PUT', `/producers/${a.id}`, { ...J, body: { internal_code: '', village: 'Hiré' } })).body?.internal_code === 'MON-002');

  console.log('Format défini par la coopérative');
  const bad = await call('PUT', '/producers/code-format', { ...J, body: { enabled: true, prefix: 'SO C!', digits: 4, start: 1 } });
  check('préfixe invalide refusé', bad.status === 400, bad.body);
  const set = await call('PUT', '/producers/code-format', { ...J, body: { enabled: true, prefix: 'SOC-', digits: 4, start: 100 } });
  check('format enregistré, prochain code annoncé', set.status === 200 && set.body.next === 'SOC-0100', set.body);
  const d = (await mk('E')).body.producer;
  check('code attribué selon le format', d.internal_code === 'SOC-0100', d);
  const e = (await mk('F')).body.producer;
  check('numéro suivant', e.internal_code === 'SOC-0101', e);
  const g = (await mk('G', 'SOC-0500')).body.producer;
  const h = (await mk('H')).body.producer;
  check('le suivant tient compte du plus grand numéro saisi', h.internal_code === 'SOC-0501', h);

  console.log('Format désactivé');
  await call('PUT', '/producers/code-format', { ...J, body: { enabled: false } });
  const i = (await mk('I')).body.producer;
  check('de nouveau aucun code automatique', i.internal_code === '', i);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
