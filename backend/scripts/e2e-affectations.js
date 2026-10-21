// Affectations : l'ADG indique la nature (formation / distribution / tâche) et la cible (tous / certains producteurs) ; l'élément s'ajoute aux profils.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (org) headers['x-organization-id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
    return { org, t0: await login(mail, pw) };
  };
  const A = await mkOrg('AA'), B = await mkOrg('AB');
  const J = (o, t) => ({ token: t, org: o.id });
  const person = async (o, code, tag) => {
    const r = (await call('POST', '/roles/standard', { ...J(o.org, o.t0), body: { code } })).body;
    const email = `${tag}.${run}@t.test`;
    await call('POST', '/users', { ...J(o.org, o.t0), body: { email, full_name: tag, password: pw, role_id: r.id } });
    return await login(email, pw);
  };
  const exp = await person(A, 'exportateur', 'exp'), coach = await person(A, 'coach', 'coach'), adg = await person(A, 'adg', 'adg'), adgB = await person(B, 'adg', 'adgb');
  const mk = async (o, i) => (await call('POST', '/producers', { ...J(o.org, o.t0), body: { last_name: 'Prod' + i, first_names: 'Test', village: 'V' + i, section: 'S1' } })).body.producer;
  const P = []; for (let i = 0; i < 4; i++) P.push(await mk(A, i));
  const PB = await mk(B, 9);
  check('producteurs créés', P.every((p) => p.id) && PB.id, P);
  const mod = { theme: 'Gestion des récoltes et des produits', title: 'Carnet de récolte', summary: 's', crops: ['cacao'], level: 'base', duration_min: 30, content: { objectifs: ['Noter les récoltes'], sections: [{ titre: 'Carnet', points: ['Noter la date', 'Noter le poids'] }] } };
  const sub = async () => (await call('POST', '/training-submissions', { ...J(A.org, exp), body: mod })).body.id;

  console.log('Transmission avec nature et cible');
  const s1 = await sub();
  const fw = (body, id = s1, who = adg) => call('POST', `/training-submissions/${id}/forward`, { ...J(A.org, who), body });
  check('sans corps : refusé (400)', (await fw({})).status === 400);
  check('nature inconnue refusée (400)', (await fw({ kind: 'autre', scope: 'all' })).status === 400);
  check('« certains » sans producteur (400)', (await fw({ kind: 'formation', scope: 'selected', producer_ids: [] })).status === 400);
  check('producteur d\'une autre coopérative refusé (400)', (await fw({ kind: 'formation', scope: 'selected', producer_ids: [PB.id] })).status === 400);
  check('la proposition reste en attente après refus', (await call('GET', '/training-submissions', J(A.org, adg))).body.find((x) => x.id === s1).status === 'submitted');
  check('le coach ne peut pas transmettre (403)', (await fw({ kind: 'formation', scope: 'all' }, s1, coach)).status === 403);
  const f = await fw({ kind: 'formation', scope: 'selected', producer_ids: [P[0].id, P[1].id], due_date: '2027-03-31', instructions: 'Avant la récolte principale' });
  check('transmis à 2 producteurs', f.status === 201 && f.body.targets === 2, f);
  const prof = async (p, t = coach) => (await call('GET', `/producer-assignments?producer_id=${p.id}`, J(A.org, t))).body;
  const a0 = await prof(P[0]), a2 = await prof(P[2]);
  check('s\'ajoute au profil du producteur ciblé', a0.length === 1 && a0[0].kind === 'formation' && a0[0].status === 'pending' && a0[0].title === 'Carnet de récolte', a0);
  check('absent du profil d\'un producteur non ciblé', a2.length === 0, a2);
  check('échéance et consigne conservées', String(a0[0].due_date).startsWith('2027-03-31') && a0[0].instructions.includes('récolte'));

  console.log('Tous les producteurs');
  const s2 = await sub();
  const f2 = await fw({ kind: 'distribution', scope: 'all' }, s2);
  check('distribution à tous les producteurs actifs', f2.status === 201 && f2.body.targets === 4, f2);
  check('chaque profil reçoit l\'élément', (await Promise.all(P.map((p) => prof(p)))).every((l) => l.some((x) => x.kind === 'distribution')));
  check('producteur d\'une autre coopérative non concerné', (await call('GET', `/producer-assignments?producer_id=${PB.id}`, J(B.org, adgB))).body.length === 0);

  console.log('Modèle de la bibliothèque (implémentation directe)');
  const lib = (await call('GET', '/training-modules', J(A.org, adg))).body;
  const m = lib[0];
  check('bibliothèque non vide', !!m);
  const direct = await call('POST', '/producer-assignments', { ...J(A.org, adg), body: { kind: 'formation', scope: 'selected', producer_ids: [P[3].id], module_id: m.id } });
  check('affectation d\'un module existant', direct.status === 201 && direct.body.title === m.title, direct);
  check('module de formation sans module refusé (400)', (await call('POST', '/producer-assignments', { ...J(A.org, adg), body: { kind: 'formation', scope: 'all' } })).status === 400);
  const tache = await call('POST', '/producer-assignments', { ...J(A.org, adg), body: { kind: 'tache', scope: 'selected', producer_ids: [P[2].id], title: 'Vérifier le séchage', due_date: '2027-01-15' } });
  check('tâche libre sur un producteur', tache.status === 201 && tache.body.kind === 'tache', tache);
  check('coach : ne peut pas affecter (403)', (await call('POST', '/producer-assignments', { ...J(A.org, coach), body: { kind: 'tache', scope: 'all', title: 'xx yy' } })).status === 403);
  check('exportateur : ne peut pas affecter (403)', (await call('POST', '/producer-assignments', { ...J(A.org, exp), body: { kind: 'tache', scope: 'all', title: 'xx yy' } })).status === 403);
  check('exportateur : pas d\'accès aux profils (403)', (await call('GET', `/producer-assignments?producer_id=${P[0].id}`, J(A.org, exp))).status === 403);

  console.log('Avancement');
  const t0 = a0[0].target_id;
  check('le coach marque « fait »', (await call('POST', `/producer-assignments/targets/${t0}/done`, J(A.org, coach))).status === 201);
  check('déjà fait : 404', (await call('POST', `/producer-assignments/targets/${t0}/done`, J(A.org, coach))).status === 404);
  check('autre coopérative : 404', (await call('POST', `/producer-assignments/targets/${t0}/done`, J(B.org, adgB))).status === 404);
  const after = await prof(P[0]);
  check('statut « fait » dans le profil', after.find((x) => x.target_id === t0).status === 'done' && after[after.length - 1].status === 'done', after);
  const list = (await call('GET', '/producer-assignments', J(A.org, adg))).body;
  check('liste avec avancement', list.some((x) => x.id === f.body.assignment_id && x.targets === 2 && x.done === 1), list);
  check('autre coopérative : liste vide', (await call('GET', '/producer-assignments', J(B.org, adgB))).body.length === 0);
  const aud = JSON.stringify((await call('GET', '/audit-logs?limit=200', J(A.org, A.t0))).body);
  check('actions tracées (audit)', ['producer_assignment.create', 'producer_assignment.done'].every((a) => aud.includes(a)));
  const n = JSON.stringify((await call('GET', '/notifications', J(A.org, coach))).body);
  check('les coachs sont notifiés', n.includes('producer_assignment'));
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
