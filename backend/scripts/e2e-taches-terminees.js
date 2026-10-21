// Missions validées par l'ADG : signalées « finished » (grisées côté client), retirées de la file du coach une fois le délai écoulé.
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
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL);
  const adm2 = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: adm2, body: { code: 'TT' + run, name: 'TT' + run } })).body;
  const mail = `tt.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm2, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail);
  const J = (t) => ({ token: t, org: org.id });
  const std = async (code) => (await call('POST', '/roles/standard', { ...J(t0), body: { code } })).body;
  const user = async (r, tag) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email) }; };
  const coach = await user(await std('coach'), 'coach'), adg = await user(await std('adg'), 'adg');
  const prod = (await call('POST', '/producers', { ...J(t0), body: { last_name: 'TEST', first_names: 'Prod', village: 'V', section: 'S1' } })).body.producer;
  const mk = async (title) => (await call('POST', '/tasks', { ...J(adg.t), body: { idempotency_key: key('t'), title, category: 'visit', priority: 'normal', due_date: day(5), producer_id: prod.id, assignee_id: coach.id, publish: true, expected_result: 'Rapport', validation_criteria: 'Complet', instructions: 'Visiter' } })).body;
  const tr = (t, id, to) => call('POST', `/tasks/${id}/transition`, { ...J(t), body: { to } });
  const done = async (id) => {
    await tr(coach.t, id, 'in_progress');
    await call('POST', `/tasks/${id}/entries`, { ...J(coach.t), body: { idempotency_key: key('e'), kind: 'result', content: 'Fait' } });
    await tr(coach.t, id, 'submitted');
    return tr(adg.t, id, 'validated');
  };
  const a = await mk('Mission A (sera validée)'), b = await mk('Mission B (reste ouverte)');
  check('mise en place', !!(a.id && b.id));

  console.log('Réglage du délai');
  check('délai par défaut : 7 jours', (await call('GET', '/tasks/settings', J(coach.t))).body.done_visible_days === 7);
  check('le coach ne peut pas changer le délai', (await call('PUT', '/tasks/settings', { ...J(coach.t), body: { done_visible_days: 1 } })).status === 403);
  check('valeur hors limites refusée', (await call('PUT', '/tasks/settings', { ...J(adg.t), body: { done_visible_days: 400 } })).status === 400);

  console.log('Mission validée : grisée');
  const v = await done(a.id);
  check('validation par l\'ADG', v.status === 201 && v.body.status === 'validated', v.body);
  const l1 = (await call('GET', '/tasks', J(coach.t))).body;
  const la = l1.find((t) => t.id === a.id), lb = l1.find((t) => t.id === b.id);
  check('la mission validée reste dans la file, marquée finished', la && la.finished === true && !!la.visible_until, la);
  check('la mission ouverte n\'est pas finished', lb && lb.finished === false && lb.visible_until === null);
  check('les missions terminées passent après les autres', l1.findIndex((t) => t.id === a.id) > l1.findIndex((t) => t.id === b.id));
  check('plus aucune action possible sur la mission validée', (await tr(coach.t, a.id, 'in_progress')).status === 409);

  console.log('Délai dépassé : disparaît de la file');
  check('ADG règle 0 jour', (await call('PUT', '/tasks/settings', { ...J(adg.t), body: { done_visible_days: 0 } })).body.done_visible_days === 0);
  const l2 = (await call('GET', '/tasks', J(coach.t))).body;
  check('la mission validée a disparu de la file du coach', !l2.some((t) => t.id === a.id) && l2.some((t) => t.id === b.id));
  check('elle n\'apparaît pas non plus dans la liste d\'un producteur', !(await call('GET', `/tasks?producer_id=${prod.id}`, J(coach.t))).body.some((t) => t.id === a.id));
  check('le coach ne peut pas la réafficher', !(await call('GET', '/tasks?include_done=true', J(coach.t))).body.some((t) => t.id === a.id) && !(await call('GET', '/tasks?status=validated', J(coach.t))).body.some((t) => t.id === a.id));
  check('l\'ADG la retrouve par le filtre d\'archives', (await call('GET', '/tasks?include_done=true', J(adg.t))).body.some((t) => t.id === a.id) && (await call('GET', '/tasks?status=validated', J(adg.t))).body.some((t) => t.id === a.id));
  check('l\'ADG ne la voit plus dans sa file par défaut', !(await call('GET', '/tasks', J(adg.t))).body.some((t) => t.id === a.id));
  check('l\'historique reste consultable par son identifiant', (await call('GET', `/tasks/${a.id}`, J(adg.t))).status === 200);
  check('7 jours : elle revient dans la file', (await call('PUT', '/tasks/settings', { ...J(adg.t), body: { done_visible_days: 7 } })).status === 200 && (await call('GET', '/tasks', J(coach.t))).body.some((t) => t.id === a.id));

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
