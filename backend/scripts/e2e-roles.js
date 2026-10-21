// Rôles types : un magasinier ne voit ni conformité, ni cartographie, ni caisse/comptabilité, ni équipe, ni missions.
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
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'RL' + run, name: 'RL' + run } })).body;
  const mail = `rl.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw); const J = (t) => ({ token: t, org: org.id });

  const tpl = await call('GET', '/roles/templates', J(t0));
  check('rôles types proposés (magasinier, caissier, collecteur)', tpl.status === 200 && ['magasinier', 'caissier', 'collecteur'].every((c) => tpl.body.some((t) => t.code === c && t.created === false)), tpl.body);
  const mk = async (code) => (await call('POST', '/roles/standard', { ...J(t0), body: { code } })).body;
  const rMag = await mk('magasinier'); const rCai = await mk('caissier'); const rCol = await mk('collecteur');
  check('rôles créés', !!(rMag.id && rCai.id && rCol.id));
  check('création idempotente', (await mk('magasinier')).id === rMag.id);
  check('rôle type inconnu refusé', (await call('POST', '/roles/standard', { ...J(t0), body: { code: 'pirate' } })).status === 400);
  const rAdg = await mk('adg'); const rCoach = await mk('coach');
  check('rôles ADG et coach créés', !!(rAdg.id && rCoach.id));
  check('rôle marqué « créé »', (await call('GET', '/roles/templates', J(t0))).body.every((t) => t.created));

  const mkUser = async (tag, r) => { const email = `${tag}.${run}@t.test`; await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } }); return login(email, pw); };
  const mag = await mkUser('magasinier', rMag), cai = await mkUser('caissier', rCai), col = await mkUser('collecteur', rCol);

  const adgMe = (await call('GET', '/me', J(await mkUser('adg', rAdg)))).body, coachMe = (await call('GET', '/me', J(await mkUser('coach', rCoach)))).body;
  const adgP = adgMe.permissions ?? [];
  check('ADG : certification, qualité, contrôle des parcelles et décision sur les demandes des coachs', ['certificates:manage', 'quality:manage', 'parcels:verify', 'tasks:assign', 'tasks:decide_requests'].every((p) => adgP.includes(p)), adgP);
  check('ADG : ni caisse, ni comptabilité, ni stock', !['cash:operate', 'accounting:post', 'convoys:settle', 'stock:move', 'finance:read'].some((p) => adgP.includes(p)), adgP);
  check('ADG : compte du personnel (pas un coach) ; coach : compte coach', adgMe.account_kind === 'staff' && coachMe.account_kind === 'coach', [adgMe.account_kind, coachMe.account_kind]);
  const me = await call('GET', '/me', J(mag));
  const perms = me.body.permissions ?? [];
  const bad = perms.filter((p) => /^(geo|parcels|inspections|quality|finance|accounting|cash|tasks|users|roles|prefinancing|loans|convoys:settle|invoices|buyers|logistics|replication)/.test(p));
  check('le magasinier n\'a aucune permission de conformité, cartographie, caisse, comptabilité, équipe ou missions', perms.length > 0 && bad.length === 0, bad);
  for (const [path, label] of [['/financial-accounts', 'caisse'], ['/users', 'équipe'], ['/tasks/dashboard', 'missions'], ['/inspections', 'conformité'], ['/convoys/cashier-queue', 'file de la caisse'], ['/parcels', 'parcelles'], ['/alerts', 'anomalies cartographiques']]) {
    const r = await call('GET', path, J(mag));
    check(`magasinier : ${label} refusé (403)`, r.status === 403, { path, status: r.status });
  }
  check('magasinier : convois visibles', (await call('GET', '/convoys', J(mag))).status === 200);
  check('magasinier : stocks visibles', (await call('GET', '/stocks', J(mag))).status === 200);
  check('magasinier ne peut pas créer de rôle ni d\'utilisateur', (await call('POST', '/roles/standard', { ...J(mag), body: { code: 'caissier' } })).status === 403);

  check('caissier : file de la caisse accessible', (await call('GET', '/convoys/cashier-queue', J(cai))).status === 200);
  check('caissier : pas de stocks ni d\'équipe', (await call('GET', '/stocks', J(cai))).status === 403 && (await call('GET', '/users', J(cai))).status === 403);
  check('collecteur : ni caisse ni comptabilité ni équipe', (await call('GET', '/financial-accounts', J(col))).status === 403 && (await call('GET', '/users', J(col))).status === 403 && (await call('GET', '/convoys/cashier-queue', J(col))).status === 403);
  check('battement d\'un poste enregistré', (await call('POST', '/connection/heartbeat', { ...J(mag), body: { station: 'st-mag', name: 'Magasin' } })).status === 201);
  await call('POST', '/connection/heartbeat', { ...J(cai), body: { station: 'st-cai', name: 'Comptabilité' } });
  const cn = await call('GET', '/connection', J(col));
  check('tout utilisateur voit les postes connectés (sans donnée métier)', cn.status === 200 && cn.body.stations.length === 2 && cn.body.stations.some((x) => x.name === 'Magasin'), cn.body);
  check('poste sans identifiant refusé', (await call('POST', '/connection/heartbeat', { ...J(mag), body: {} })).status === 400);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
