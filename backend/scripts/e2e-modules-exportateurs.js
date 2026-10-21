// Modules proposés par un exportateur : exportateur → ADG (un clic) → coachs ; résultats des coachs → ADG (un clic) → exportateur.
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

  const mod = { theme: 'Gestion des récoltes et des produits', title: 'Traçabilité des fèves à la ferme', summary: 'Module proposé par l\'exportateur', crops: ['cacao'], certifications: ['EUDR'], level: 'base', duration_min: 60,
    content: { objectifs: ['Tenir un carnet de récolte'], sections: [{ titre: 'Le carnet', points: ['Noter la date', 'Noter le poids'] }], a_eviter: ['Mélanger les lots'], verifier: ['Que note-t-on ?'] } };

  console.log('Proposition');
  check('exportateur : pas d\'accès à la bibliothèque des coachs', (await call('GET', '/training-modules', J(A.org, exp1))).status === 403);
  check('coach : ne peut pas proposer', (await call('POST', '/training-submissions', { ...J(A.org, coach), body: mod })).status === 403);
  check('contenu vide refusé', (await call('POST', '/training-submissions', { ...J(A.org, exp1), body: { ...mod, content: { objectifs: [], sections: [] } } })).status === 400);
  const s = await call('POST', '/training-submissions', { ...J(A.org, exp1), body: mod });
  check('proposition créée', s.status === 201 && s.body.status === 'submitted', s);
  const sid = s.body.id;
  check('l\'exportateur voit sa proposition', (await call('GET', '/training-submissions', J(A.org, exp1))).body.some((x) => x.id === sid));
  const ladg = await call('GET', '/training-submissions', J(A.org, adg));
  check('l\'ADG voit la proposition (avec l\'exportateur)', ladg.body.some((x) => x.id === sid && x.submitted_by_name === 'exp1'), ladg.body);
  check('le coach ne voit pas les propositions', (await call('GET', '/training-submissions', J(A.org, coach))).status === 403);
  check('autre coopérative : proposition invisible', !(await call('GET', '/training-submissions', J(B.org, adgB))).body.some((x) => x.id === sid));
  check('autre coopérative : transmission impossible (404)', (await call('POST', `/training-submissions/${sid}/forward`, { ...J(B.org, adgB), body: { kind: 'formation', scope: 'all' } })).status === 404);
  const nA = await call('GET', '/notifications', J(A.org, adg));
  check('l\'ADG est notifié', JSON.stringify(nA.body).includes('training_submitted'), nA.body);

  console.log('Transmission aux coachs (un clic)');
  check('le coach ne peut pas transmettre', (await call('POST', `/training-submissions/${sid}/forward`, J(A.org, coach))).status === 403);
  check('l\'exportateur ne peut pas se transmettre lui-même', (await call('POST', `/training-submissions/${sid}/forward`, J(A.org, exp1))).status === 403);
  check('nature et cible obligatoires (400)', (await call('POST', `/training-submissions/${sid}/forward`, { ...J(A.org, adg), body: {} })).status === 400);
  const f = await call('POST', `/training-submissions/${sid}/forward`, { ...J(A.org, adg), body: { kind: 'formation', scope: 'all' } });
  check('l\'ADG transmet', f.status === 201 && f.body.module_id, f);
  check('double transmission refusée (409)', (await call('POST', `/training-submissions/${sid}/forward`, { ...J(A.org, adg), body: { kind: 'formation', scope: 'all' } })).status === 409);
  check('refus après transmission (409)', (await call('POST', `/training-submissions/${sid}/decline`, { ...J(A.org, adg), body: {} })).status === 409);
  const lib = await call('GET', '/training-modules', J(A.org, coach));
  const m = lib.body.find((x) => x.id === f.body.module_id);
  check('le coach voit le module, identique à la proposition', m && m.title === mod.title && JSON.stringify(m.content.sections) === JSON.stringify(mod.content.sections) && m.review_state === 'exporter', m);
  check('… avec le nom de l\'exportateur', m && m.proposed_by_name === 'exp1', m);
  check('l\'ADG ne peut pas modifier ce module (409)', (await call('PUT', `/training-modules/${m.id}`, { ...J(A.org, adg), body: { ...mod, title: 'Modifié par l\'ADG' } })).status === 409);
  check('l\'ADG ne peut pas le supprimer (409)', (await call('DELETE', `/training-modules/${m.id}`, J(A.org, adg))).status === 409);
  check('le coach est notifié', JSON.stringify((await call('GET', '/notifications', J(A.org, coach))).body).includes('training_module_assigned'));
  check('l\'exportateur est notifié', JSON.stringify((await call('GET', '/notifications', J(A.org, exp1))).body).includes('training_submission_forwarded'));

  console.log('Refus d\'une proposition');
  const s2 = (await call('POST', '/training-submissions', { ...J(A.org, exp1), body: { ...mod, title: 'Proposition refusée' } })).body;
  const d = await call('POST', `/training-submissions/${s2.id}/decline`, { ...J(A.org, adg), body: { reason: 'Hors programme' } });
  check('l\'ADG décline avec un motif', d.status === 201 && d.body.status === 'declined', d);
  check('le module refusé n\'apparaît pas chez les coachs', !(await call('GET', '/training-modules', J(A.org, coach))).body.some((x) => x.title === 'Proposition refusée'));
  check('transmission après refus (409)', (await call('POST', `/training-submissions/${s2.id}/forward`, { ...J(A.org, adg), body: { kind: 'formation', scope: 'all' } })).status === 409);

  console.log('Résultats des coachs');
  const std = lib.body.find((x) => !x.submission_id);
  const body = { module_id: m.id, session_date: today, village: 'Hiré', participants: 18, avg_score: 72.5, notes: 'Bonne participation' };
  check('résultat sur un module de la bibliothèque : refusé', (await call('POST', '/training-results', { ...J(A.org, coach), body: { ...body, module_id: std.id } })).status === 400);
  check('l\'ADG ne saisit pas de résultat (403)', (await call('POST', '/training-results', { ...J(A.org, adg), body })).status === 403);
  check('score hors limites refusé', (await call('POST', '/training-results', { ...J(A.org, coach), body: { ...body, avg_score: 140 } })).status === 400);
  check('date future refusée', (await call('POST', '/training-results', { ...J(A.org, coach), body: { ...body, session_date: '2099-01-01' } })).status === 400);
  const r = await call('POST', '/training-results', { ...J(A.org, coach), body });
  check('le coach saisit le résultat', r.status === 201 && r.body.status === 'submitted', r);
  const rid = r.body.id;
  check('l\'exportateur ne voit rien avant transmission', (await call('GET', '/training-results', J(A.org, exp1))).body.length === 0);
  const rl = await call('GET', '/training-results', J(A.org, adg));
  check('l\'ADG voit le résultat (coach, module, exportateur)', rl.body.some((x) => x.id === rid && x.coach_name === 'coach' && x.exporter_name === 'exp1'), rl.body);
  check('le coach voit les siens', (await call('GET', '/training-results', J(A.org, coach))).body.some((x) => x.id === rid));
  check('l\'ADG est notifié du résultat', JSON.stringify((await call('GET', '/notifications', J(A.org, adg))).body).includes('training_result_submitted'));
  check('le coach ne peut pas transmettre (403)', (await call('POST', `/training-results/${rid}/forward`, J(A.org, coach))).status === 403);
  const fr = await call('POST', `/training-results/${rid}/forward`, J(A.org, adg));
  check('l\'ADG transmet le résultat', fr.status === 201 && fr.body.status === 'forwarded', fr);
  check('double transmission refusée (409)', (await call('POST', `/training-results/${rid}/forward`, J(A.org, adg))).status === 409);
  const el = await call('GET', '/training-results', J(A.org, exp1));
  check('l\'exportateur voit le résultat, tel que saisi', el.body.length === 1 && el.body[0].participants === 18 && Number(el.body[0].avg_score) === 72.5 && el.body[0].notes === 'Bonne participation', el.body);
  check('l\'exportateur est notifié', JSON.stringify((await call('GET', '/notifications', J(A.org, exp1))).body).includes('training_result_forwarded'));
  check('un autre exportateur (autre coopérative) ne voit rien', (await call('GET', '/training-results', J(B.org, expB))).body.length === 0);
  const sl = await call('GET', '/training-submissions', J(A.org, adg));
  const row = sl.body.find((x) => x.id === sid);
  check('compteurs de résultats sur la proposition', row.results_count === 1 && row.results_forwarded === 1, row);

  if (process.env.DATABASE_URL) {
    console.log('Contenu figé par la base');
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    let e1 = '', e2 = '';
    try { await c.query(`UPDATE training_submissions SET title = 'X' WHERE id = $1`, [sid]); } catch (e) { e1 = e.message; }
    try { await c.query(`UPDATE training_results SET participants = 1 WHERE id = $1`, [rid]); } catch (e) { e2 = e.message; }
    check('proposition non modifiable', /ne peut pas être modifié/.test(e1), e1);
    check('résultat non modifiable', /ne peut pas être modifié/.test(e2), e2);
    await c.end();
  }
  const aud = JSON.stringify((await call('GET', '/audit-logs?limit=200', J(A.org, A.t0))).body);
  check('actions tracées (audit)', ['training_submission.create', 'training_submission.forward', 'training_result.create', 'training_result.forward'].every((a) => aud.includes(a)));

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
