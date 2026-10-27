// Tâches (questionnaires) proposées par un exportateur : exportateur → ADG (un clic) → coachs ; réponses des coachs → ADG (un clic) → exportateur.
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
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
    return { org, t0: await login(mail, pw) };
  };
  const A = await mkOrg('XA'), B = await mkOrg('XB');
  const J = (o, t) => ({ token: t, org: o.id });
  const person = async (o, code, tag) => {
    const r = (await call('POST', '/roles/standard', { ...J(o.org, o.t0), body: { code } })).body;
    const email = `${tag}.${run}@t.test`;
    await call('POST', '/users', { ...J(o.org, o.t0), body: { email, full_name: tag, password: pw, role_id: r.id } });
    return await login(email, pw);
  };
  await call('POST', '/producers', { ...J(A.org, A.t0), body: { last_name: 'Prod', first_names: 'Test', village: 'V', section: 'S1' } });
  const exp1 = await person(A, 'exportateur', 'exp1');
  const coach = await person(A, 'coach', 'coach'), adg = await person(A, 'adg', 'adg');
  const expB = await person(B, 'exportateur', 'expb'), adgB = await person(B, 'adg', 'adgb');

  const task = { title: 'Enquête de suivi des plantations', description: 'Proposée par l\'exportateur', questions: [
    { label: 'Combien de parcelles de cacao exploitez-vous ?', type: 'number', required: true }, { label: 'Utilisez-vous des engrais ?', type: 'yesno', required: true } ] };
  console.log('Proposition');
  check('coach : ne peut pas proposer', (await call('POST', '/task-submissions', { ...J(A.org, coach), body: task })).status === 403);
  check('sans question refusé', (await call('POST', '/task-submissions', { ...J(A.org, exp1), body: { ...task, questions: [] } })).status === 400);
  const s = await call('POST', '/task-submissions', { ...J(A.org, exp1), body: task });
  check('tâche proposée', s.status === 201 && s.body.status === 'submitted', s);
  const sid = s.body.id;
  check("l'exportateur voit sa tâche", (await call('GET', '/task-submissions', J(A.org, exp1))).body.some((x) => x.id === sid));
  check("l'ADG voit la tâche", (await call('GET', '/task-submissions', J(A.org, adg))).body.some((x) => x.id === sid && x.submitted_by_name === 'exp1'));
  check('le coach ne voit pas les propositions', (await call('GET', '/task-submissions', J(A.org, coach))).status === 403);
  check('autre coopérative : transmission impossible (404)', (await call('POST', `/task-submissions/${sid}/forward`, { ...J(B.org, adgB), body: { kind: 'tache', scope: 'all' } })).status === 404);
  check("l'ADG est notifié", JSON.stringify((await call('GET', '/notifications', J(A.org, adg))).body).includes('task_submitted'));

  console.log('Transmission aux coachs (un clic)');
  check("l'exportateur ne transmet pas", (await call('POST', `/task-submissions/${sid}/forward`, { ...J(A.org, exp1), body: { kind: 'tache', scope: 'all' } })).status === 403);
  const f = await call('POST', `/task-submissions/${sid}/forward`, { ...J(A.org, adg), body: { kind: 'formation', scope: 'all', due_date: today } });
  check('transmise à tous les producteurs', f.status === 201 && f.body.targets === 1 && !!f.body.assignment_id, f);
  check('déjà traitée : 409', (await call('POST', `/task-submissions/${sid}/forward`, { ...J(A.org, adg), body: { kind: 'tache', scope: 'all' } })).status === 409);

  console.log('Réponses du coach');
  const mine = (await call('GET', '/producer-assignments?mine=1&compact=1', J(A.org, coach))).body;
  const tgt = (mine.assignments ?? []).find((a) => a.id === f.body.assignment_id);
  check('le coach reçoit la tâche sur le profil du producteur', !!tgt && tgt.kind === 'tache', mine);
  const ans = await call('POST', `/questionnaires/targets/${tgt?.target_id}/answers`, { ...J(A.org, coach), body: { answers: { q1: 2, q2: 'oui' } } });
  check('réponses enregistrées', ans.status === 201 && ans.body.status === 'done', ans);

  console.log('Réponses transmises à l\'exportateur (un clic)');
  const r0 = await call('GET', `/task-submissions/${sid}/results`, J(A.org, exp1));
  check("avant transmission : l'exportateur ne voit pas les réponses", r0.status === 403, r0);
  const r1 = await call('GET', `/task-submissions/${sid}/results`, J(A.org, adg));
  check("l'ADG voit les réponses", r1.status === 200 && r1.body.rows[0]?.answers?.q1 === 2, r1.body);
  check("l'exportateur ne transmet pas les réponses", (await call('POST', `/task-submissions/${sid}/forward-results`, { ...J(A.org, exp1) })).status === 403);
  check("l'ADG transmet les réponses", (await call('POST', `/task-submissions/${sid}/forward-results`, { ...J(A.org, adg) })).status === 201);
  const r2 = await call('GET', `/task-submissions/${sid}/results`, J(A.org, exp1));
  check("après transmission : l'exportateur voit les réponses", r2.status === 200 && r2.body.rows[0]?.answers?.q2 === 'oui', r2);
  check('autre exportateur : tâche introuvable', (await call('GET', `/task-submissions/${sid}/results`, J(B.org, expB))).status === 404);

  console.log('Refus');
  const s2 = (await call('POST', '/task-submissions', { ...J(A.org, exp1), body: { ...task, title: 'Autre enquête' } })).body;
  check("l'ADG décline", (await call('POST', `/task-submissions/${s2.id}/decline`, { ...J(A.org, adg), body: { reason: 'Hors programme' } })).status === 201);
  check("l'exportateur voit le motif", (await call('GET', '/task-submissions', J(A.org, exp1))).body.some((x) => x.id === s2.id && x.status === 'declined' && x.decline_reason === 'Hors programme'));
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
