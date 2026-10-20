// Test de bout en bout : missions et tâches de terrain (CDC §11, §33.6).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pw = 'MotDePasseSolide2026!';
const sq = (lon, lat, s = 0.0009) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
const pdf = (txt) => Buffer.from(`%PDF-1.4\n% ${txt}\n%%EOF\n`);

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mk = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
    return { org, t: await login(mail, pw) };
  };
  const A = await mk('TA'), B = await mk('TB');
  const J = (X, tok) => ({ token: tok ?? X.t, org: X.org.id });
  const vc = (await call('POST', '/value-chains', { ...J(A), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const prods = [];
  for (let i = 0; i < 3; i++) prods.push((await call('POST', '/producers', { ...J(A), body: { last_name: 'T' + i, first_names: 'P', village: 'Hiré', value_chain_ids: [vc.id] } })).body.producer);
  const [p1, p2, p3] = prods;
  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(A), body: { code, name: code, permissions } })).body;
  const user = async (tag, r) => {
    const email = `${tag}.${run}@t.test`;
    const u = (await call('POST', '/users', { ...J(A), body: { email, full_name: tag, password: pw, role_id: r.id } })).body;
    return { id: u.id, t: await login(email, pw), email };
  };
  const rCoach = await role('coach', ['tasks:read', 'tasks:execute', 'tasks:request', 'sync:use', 'documents:upload', 'documents:read', 'parcels:read']);
  const rChef = await role('chef_mission', ['tasks:read', 'tasks:read_all', 'tasks:create', 'tasks:assign', 'tasks:update', 'tasks:review', 'tasks:close', 'tasks:decide_requests', 'geo:anomalies']);
  const rLect = await role('lecteur', ['tasks:read']);
  const coach = await user('coach1', rCoach), coach2 = await user('coach2', rCoach), chef = await user('chef', rChef), lect = await user('lect', rLect);
  check('mise en place', !!(coach.id && coach2.id && chef.id && lect.t && p1.id));

  console.log('Création : seuls les rôles autorisés');
  const body = (o = {}) => ({ idempotency_key: key('t'), title: 'Cartographier la parcelle de T0', category: 'mapping', priority: 'high', due_date: day(5), producer_id: p1.id, campaign_id: undefined,
    expected_result: 'Polygone et photos', validation_criteria: 'Polygone fermé, précision < 10 m', instructions: 'Faire le tour de la parcelle', ...o });
  check('coach ne peut pas créer une mission officielle', (await call('POST', '/tasks', { ...J(A, coach.t), body: body() })).status === 403);
  const b1 = body({ assignee_id: coach.id, publish: true });
  const t1 = await call('POST', '/tasks', { ...J(A, chef.t), body: b1 });
  check('chef de mission crée et ouvre une mission', t1.status === 201 && t1.body.status === 'open' && /^M\d{5}$/.test(t1.body.code), t1.body);
  const t1b = await call('POST', '/tasks', { ...J(A, chef.t), body: b1 });
  check('renvoi de la même clé : pas de doublon', t1b.body.id === t1.body.id);
  check('ouvrir sans responsable → 400', (await call('POST', '/tasks', { ...J(A, chef.t), body: body({ publish: true }) })).status === 400);
  check('responsable d\'une autre coopérative refusé', (await call('POST', '/tasks', { ...J(A, chef.t), body: body({ assignee_id: '00000000-0000-4000-8000-000000000001' }) })).status === 400);
  const draft = (await call('POST', '/tasks', { ...J(A, chef.t), body: body({ title: 'Brouillon' }) })).body;
  check('brouillon créé', draft.status === 'draft');

  console.log('Visibilité');
  const lc = (await call('GET', '/tasks', J(A, coach.t))).body;
  check('le coach ne voit que ses missions, jamais les brouillons', lc.length === 1 && lc[0].id === t1.body.id, lc.map((x) => x.title));
  check('un autre coach n\'y a pas accès (404)', (await call('GET', `/tasks/${t1.body.id}`, J(A, coach2.t))).status === 404);
  check('le chef voit tout', (await call('GET', '/tasks', J(A, chef.t))).body.length === 2);
  check('une autre coopérative ne voit rien', (await call('GET', `/tasks/${t1.body.id}`, J(B))).status === 404);

  console.log('Instructions officielles');
  const upd = await call('POST', `/tasks/${t1.body.id}/update`, { ...J(A, coach.t), body: { instructions: 'autre', reason: 'je change' } });
  check('coach ne peut pas modifier les instructions → 403', upd.status === 403);
  const upd2 = await call('POST', `/tasks/${t1.body.id}/update`, { ...J(A, chef.t), body: { instructions: 'Faire le tour, 1 point GPS par angle', reason: 'Précision demandée' } });
  check('chef modifie les instructions avec motif ; version incrémentée', upd2.status === 201 && upd2.body.version === 2, upd2.body);
  check('motif obligatoire', (await call('POST', `/tasks/${t1.body.id}/update`, { ...J(A, chef.t), body: { instructions: 'x y z' } })).status === 400);

  console.log('Exécution');
  const e0 = { idempotency_key: key('e'), kind: 'observation', content: 'Parcelle accessible' };
  check('saisie impossible avant démarrage → 409', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: e0 })).status === 409);
  check('autre coach ne peut pas démarrer', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach2.t), body: { to: 'in_progress' } })).status === 404);
  check('lecteur sans permission d\'exécution refusé', [403, 404].includes((await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, lect.t), body: { to: 'in_progress' } })).status));
  check('saut de statut interdit (open → validated)', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'validated' } })).status === 409);
  const st = await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'in_progress' } });
  check('coach démarre la mission', st.status === 201 && st.body.status === 'in_progress' && st.body.started_at);
  check('observation enregistrée', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: e0 })).status === 201);
  const e0b = await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: e0 });
  check('même saisie renvoyée : pas de doublon', e0b.status === 201);
  check('GPS : coordonnées obligatoires', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'gps' } })).status === 400);
  check('GPS hors limites refusé', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'gps', latitude: 95, longitude: 0 } })).status === 400);
  check('point GPS enregistré', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'gps', latitude: 6.81, longitude: -6.1, accuracy_m: 4.5 } })).status === 201);
  const f = new FormData(); f.append('file', new Blob([pdf('croquis')], { type: 'application/pdf' }), 'croquis.pdf'); f.append('subject_type', 'task'); f.append('subject_id', t1.body.id); f.append('kind', 'croquis');
  const doc = await call('POST', '/documents', { ...J(A, coach.t), form: f });
  check('pièce jointe téléversée sur la mission', doc.status === 201, doc.body);
  check('document attaché comme saisie', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'document', document_id: doc.body.id } })).status === 201);
  check('document d\'un autre objet refusé', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'photo', document_id: '00000000-0000-4000-8000-000000000002' } })).status === 400);
  const sub0 = await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'submitted' } });
  check('soumission sans résultat refusée', sub0.status === 422, sub0.body);
  check('résultat enregistré', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'result', content: 'Polygone relevé : 4 points' } })).status === 201);
  check('coach ne peut pas valider sa propre mission', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'validated' } })).status === 409);
  const sub = await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'submitted' } });
  check('mission soumise pour vérification', sub.status === 201 && sub.body.status === 'submitted' && sub.body.submitted_at);
  check('saisie refusée après soumission', (await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'observation', content: 'x' } })).status === 409);
  check('instructions figées après soumission', (await call('POST', `/tasks/${t1.body.id}/update`, { ...J(A, chef.t), body: { instructions: 'xyz abc', reason: 'tardif' } })).status === 409);

  console.log('Vérification et clôture');
  check('renvoi à corriger : motif obligatoire', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'to_correct' } })).status === 400);
  const tc = await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'to_correct', note: 'Il manque une photo' } });
  check('mission renvoyée à corriger', tc.status === 201 && tc.body.status === 'to_correct' && tc.body.review_note === 'Il manque une photo');
  check('coach reprend la mission', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'in_progress' } })).status === 201);
  await call('POST', `/tasks/${t1.body.id}/entries`, { ...J(A, coach.t), body: { idempotency_key: key('e'), kind: 'result', content: 'Photo ajoutée' } });
  await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'submitted' } });
  const va = await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'validated', note: 'Conforme' } });
  check('mission validée', va.status === 201 && va.body.status === 'validated');
  check('coach ne peut pas clôturer', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, coach.t), body: { to: 'closed' } })).status === 403);
  check('terminée', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'completed' } })).status === 201);
  check('clôturée', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'closed' } })).status === 201);
  check('plus aucun changement après clôture', (await call('POST', `/tasks/${t1.body.id}/transition`, { ...J(A, chef.t), body: { to: 'cancelled', note: 'trop tard' } })).status === 409);
  const full = (await call('GET', `/tasks/${t1.body.id}`, J(A, chef.t))).body;
  const path = full.history.map((h) => h.to_status).join('>');
  check('historique complet des statuts avec auteur', path === 'open>open>in_progress>submitted>to_correct>in_progress>submitted>validated>completed>closed' && full.history.every((h) => h.actor_name), path);
  check('détail : saisies, pièces, producteur', full.entries.length >= 5 && full.documents.length === 1 && full.producer.id === p1.id);
  const aud = JSON.stringify((await call('GET', '/audit-logs?limit=300', J(A))).body);
  check('changements de statut audités', aud.includes('task.status') && aud.includes('task.create') && aud.includes('task.update'));

  console.log('Mission de cartographie (CDC §11.4)');
  const m = async (producer, extra = {}) => (await call('POST', '/tasks', { ...J(A, chef.t), body: body({ producer_id: producer.id, assignee_id: coach.id, publish: true, ...extra }) })).body;
  const mA = await m(p2);
  check('producteur sans parcelle → création proposée', (await call('GET', `/tasks/${mA.id}`, J(A, coach.t))).body.mapping?.action === 'create_parcel');
  const par = (await call('POST', '/parcels', { ...J(A), body: { idempotency_key: key('p'), producer_id: p2.id, value_chain_id: vc.id, declared_area_ha: '2', latitude: 6.8, longitude: -6 } })).body;
  check('parcelle sans polygone → compléter', (await call('GET', `/tasks/${mA.id}`, J(A, coach.t))).body.mapping?.action === 'complete_polygon');
  await call('POST', `/parcels/${par.id}/update`, { ...J(A), body: { geometry: sq(-6, 6.8), reason: 'Relevé' } });
  const mm = (await call('GET', `/tasks/${mA.id}`, J(A, coach.t))).body.mapping;
  check('polygone existant → affichage, pas de recréation', mm.action === 'view_existing' && mm.parcels[0].has_polygon === true, mm);

  console.log('Demandes de coach');
  const rq = await call('POST', '/task-requests', { ...J(A, coach.t), body: { idempotency_key: key('r'), title: 'Visite de suivi T2', category: 'visit', producer_id: p3.id } });
  check('coach demande une mission', rq.status === 201 && rq.body.status === 'pending');
  check('la demande n\'est pas une tâche officielle', !(await call('GET', '/tasks', J(A, chef.t))).body.some((x) => x.title === 'Visite de suivi T2'));
  check('coach ne peut pas décider', (await call('POST', `/task-requests/${rq.body.id}/decide`, { ...J(A, coach.t), body: { decision: 'accept', note: 'ok ok' } })).status === 403);
  const dc = await call('POST', `/task-requests/${rq.body.id}/decide`, { ...J(A, chef.t), body: { decision: 'accept', note: 'Accepté', assignee_id: coach.id, due_date: day(7) } });
  check('chef accepte : mission officielle ouverte, liée à la demande', dc.status === 201 && dc.body.task.status === 'open' && dc.body.task.request_id === rq.body.id && dc.body.request.status === 'accepted', dc.body);
  check('demande déjà traitée → 409', (await call('POST', `/task-requests/${rq.body.id}/decide`, { ...J(A, chef.t), body: { decision: 'reject', note: 'again' } })).status === 409);
  const rq2 = await call('POST', '/task-requests', { ...J(A, coach.t), body: { idempotency_key: key('r'), title: 'Mission inutile' } });
  const rj = await call('POST', `/task-requests/${rq2.body.id}/decide`, { ...J(A, chef.t), body: { decision: 'reject', note: 'Hors périmètre' } });
  check('demande refusée sans création de tâche', rj.body.request.status === 'rejected' && rj.body.task === null);
  check('coach ne voit que ses demandes', (await call('GET', '/task-requests', J(A, coach.t))).body.length === 2 && (await call('GET', '/task-requests', J(A, coach2.t))).body.length === 0);

  console.log('Hors connexion : synchronisation sans doublon');
  const t3 = (await call('POST', '/tasks', { ...J(A, chef.t), body: body({ title: 'Mission hors ligne', assignee_id: coach.id, publish: true }) })).body;
  const feed = (await call('GET', '/sync/changes', J(A, coach.t))).body;
  check('missions du coach dans le flux de synchronisation (sans brouillon ni missions d\'autrui)', feed.changes.tasks.some((x) => x.id === t3.id) && !feed.changes.tasks.some((x) => x.id === draft.id), feed.changes.tasks?.length);
  const ops = [
    { idempotency_key: key('o'), type: 'task.start', payload: { id: t3.id } },
    { idempotency_key: key('o'), type: 'task.entry', payload: { task_id: t3.id, idempotency_key: key('oe'), kind: 'gps', latitude: 6.8, longitude: -6.1, accuracy_m: 5, recorded_at: new Date(Date.now() - 3600e3).toISOString() } },
    { idempotency_key: key('o'), type: 'task.entry', payload: { task_id: t3.id, idempotency_key: key('oe'), kind: 'result', content: 'Fait hors ligne' } },
    { idempotency_key: key('o'), type: 'task.submit', payload: { id: t3.id } },
  ];
  const r1 = await call('POST', '/sync/batch', { ...J(A, coach.t), body: { operations: ops } });
  check('lot hors ligne accepté', r1.body.results.every((x) => x.status === 'accepted'), r1.body.results);
  const r2 = await call('POST', '/sync/batch', { ...J(A, coach.t), body: { operations: ops } });
  check('renvoi du même lot : aucun doublon', r2.body.results.every((x) => x.status === 'accepted'));
  const t3d = (await call('GET', `/tasks/${t3.id}`, J(A, chef.t))).body;
  check('une seule exécution : 2 saisies, statut soumise, date de saisie d\'origine conservée', t3d.status === 'submitted' && t3d.entries.length === 2 && new Date(t3d.entries[0].recorded_at) < new Date(Date.now() - 3000e3), t3d.entries);
  const rs = await call('POST', '/sync/batch', { ...J(A, coach2.t), body: { operations: [{ idempotency_key: key('o'), type: 'task.start', payload: { id: t3.id } }] } });
  check('coach non autorisé : opération rejetée', rs.body.results[0].status === 'rejected', rs.body.results);
  const rlect = await call('POST', '/sync/batch', { ...J(A, lect.t), body: { operations: [{ idempotency_key: key('o'), type: 'task.start', payload: { id: t3.id } }] } });
  check('sans permission sync:use → 403', rlect.status === 403);

  console.log('Tableau de bord');
  await call('POST', '/tasks', { ...J(A, chef.t), body: body({ title: 'Urgente en retard', priority: 'urgent', due_date: day(-2), assignee_id: coach.id, publish: true }) });
  const db1 = (await call('GET', '/tasks/dashboard', J(A, coach.t))).body;
  check('tableau de bord : urgentes, en retard, terminées, producteurs à visiter', db1.counts.urgent >= 1 && db1.counts.overdue >= 1 && db1.counts.done >= 1 && db1.producers_to_visit.length >= 1, db1.counts);
  check('producteurs non cartographiés et parcelles sans polygone listés', db1.counts.unmapped_producers >= 2 && Array.isArray(db1.parcels_without_polygon) && 'parcels_pending_validation' in db1.counts);
  check('anomalies visibles seulement avec la permission', db1.anomalies.length === 0 && Array.isArray((await call('GET', '/tasks/dashboard?scope=all', J(A, chef.t))).body.anomalies));
  check('vue globale réservée à tasks:read_all', (await call('GET', '/tasks/dashboard?scope=all', J(A, coach.t))).status === 403);
  const od = (await call('GET', '/tasks?overdue=true', J(A, coach.t))).body;
  check('filtre « en retard »', od.length >= 1 && od.every((x) => x.overdue === true));
  const mine = await call('POST', `/tasks/${t3.id}/assign`, { ...J(A, chef.t), body: { assignee_id: coach2.id } });
  check('mission soumise non réattribuable', mine.status === 409);
  const c2 = (await call('POST', '/tasks', { ...J(A, chef.t), body: body({ title: 'À réattribuer', assignee_id: coach.id, publish: true }) })).body;
  const re = await call('POST', `/tasks/${c2.id}/assign`, { ...J(A, chef.t), body: { assignee_id: coach2.id } });
  check('réattribution historisée', re.status === 201 && re.body.assignee_id === coach2.id && (await call('GET', `/tasks/${c2.id}`, J(A, chef.t))).body.history.length >= 2);
  check('annulation : motif obligatoire', (await call('POST', `/tasks/${c2.id}/transition`, { ...J(A, chef.t), body: { to: 'cancelled' } })).status === 400);
  check('annulation motivée', (await call('POST', `/tasks/${c2.id}/transition`, { ...J(A, chef.t), body: { to: 'cancelled', note: 'Doublon' } })).body.status === 'cancelled');

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
