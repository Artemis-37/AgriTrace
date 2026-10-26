// Questionnaires (tâches) : création, import, affectation (tous / certains), réponses du coach, résultats.
const API = process.env.API || 'http://localhost:3000/v1';
let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n, d ?? ''); } };
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (org) headers['X-Organization-Id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : form });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
(async () => {
  const run = Math.random().toString(16).slice(2, 8).toUpperCase(); const pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const orgR = await call('POST', '/organizations', { token: adm, body: { code: 'QST' + run, name: 'QST' + run } }); const org = orgR.body; if (!org.id) { console.log(orgR); process.exit(1); }
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `q.${run.toLowerCase()}@t.test`, full_name: 'Chef', password: pw } });
  const t = await login(`q.${run.toLowerCase()}@t.test`, pw); const A = { token: t, org: org.id };
  const prods = [];
  const vc = (await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao' } })).body;
  for (let i = 0; i < 3; i++) prods.push((await call('POST', '/producers', { ...A, body: { last_name: 'PROD' + i, first_names: 'Test', village: 'Hiré', section: 'S1', region: 'Gôh', value_chain_ids: [vc.id] } })).body.producer);
  check('3 producteurs créés', prods.every((p) => p?.id));

  console.log('Création');
  const bad = await call('POST', '/questionnaires', { ...A, body: { title: 'Suivi', questions: [{ label: 'Choix ?', type: 'choix', options: 'un' }] } });
  check('choix avec une seule option : refusé', bad.status === 400, bad.body);
  const q = await call('POST', '/questionnaires', { ...A, body: { title: 'Suivi des plantations', description: 'Visite', questions: [
    { label: 'Nombre de parcelles', type: 'nombre', required: true }, { label: 'Engrais utilisé', type: 'oui/non', required: true },
    { label: 'Difficulté principale', type: 'choix', options: 'Maladies; Prix; Autre' }, { label: 'Équipements', type: 'choix multiple', options: ['Sécateur', 'Bâche'] }, { label: 'Observations', type: 'texte' }] } });
  check('questionnaire créé (5 questions)', q.status === 201 && q.body.questions.length === 5 && q.body.questions[1].type === 'yesno', q.body);

  console.log('Importation Excel');
  const tpl = await fetch(API + '/questionnaires/template', { headers: { Authorization: 'Bearer ' + t, 'X-Organization-Id': org.id } });
  const buf = Buffer.from(await tpl.arrayBuffer());
  check('modèle téléchargeable (xlsx)', tpl.status === 200 && buf.length > 2000 && buf.slice(0, 2).toString() === 'PK');
  const f = new FormData(); f.append('file', new Blob([buf]), 'enquete-menage.xlsx');
  const imp = await call('POST', '/questionnaires/import', { ...A, form: f });
  check('import du modèle : 6 questions, titre tiré du nom du fichier', imp.status === 201 && imp.body.questions.length === 6 && /enquete menage/i.test(imp.body.title), imp.body);
  const csv = new FormData(); csv.append('file', new Blob(['Question;Type;Choix;Obligatoire\nÂge du producteur;Nombre;;oui\nSexe;Choix;Homme|Femme;non\n']), 'q.csv'); csv.append('title', 'Import CSV');
  const impc = await call('POST', '/questionnaires/import', { ...A, form: csv });
  check('import CSV', impc.status === 201 && impc.body.questions.length === 2 && impc.body.questions[0].required === true, impc.body);

  console.log('Affectation');
  const sel = await call('POST', '/producer-assignments', { ...A, body: { kind: 'distribution', scope: 'selected', producer_ids: [prods[0].id, prods[1].id], questionnaire_id: q.body.id } });
  check('affecté à 2 producteurs choisis (nature forcée en tâche)', sel.status === 201 && sel.body.targets === 2 && sel.body.kind === 'tache' && sel.body.questionnaire_id === q.body.id, sel.body);
  const all = await call('POST', '/producer-assignments', { ...A, body: { kind: 'tache', scope: 'all', questionnaire_id: impc.body.id } });
  check('affecté à tous les producteurs actifs', all.status === 201 && all.body.targets === 3, all.body);
  const prof = (await call('GET', `/producer-assignments?producer_id=${prods[0].id}`, A)).body;
  check('apparaît dans le profil du producteur (liste des tâches)', prof.length === 2 && prof.every((x) => x.kind === 'tache' && x.questionnaire_id), prof);
  const mine = (await call('GET', '/producer-assignments?mine=1', A)).body;
  check('copie hors connexion avec les questions', mine.length === 5 && mine.filter((x) => x.questions).length === 5);

  console.log('Réponses du coach');
  const tg = prof.find((x) => x.questionnaire_id === q.body.id).target_id;
  const detail = await call('GET', `/questionnaires/targets/${tg}`, A);
  check('lecture du questionnaire à renseigner', detail.status === 200 && detail.body.questions.length === 5 && detail.body.internal_code === prods[0].internal_code, detail.body);
  check('réponse obligatoire manquante : refusée', (await call('POST', `/questionnaires/targets/${tg}/answers`, { ...A, body: { answers: { q1: 3 } } })).status === 400);
  check('choix invalide : refusé', (await call('POST', `/questionnaires/targets/${tg}/answers`, { ...A, body: { answers: { q1: 3, q2: 'oui', q3: 'Inconnu' } } })).status === 400);
  check('nombre invalide : refusé', (await call('POST', `/questionnaires/targets/${tg}/answers`, { ...A, body: { answers: { q1: 'abc', q2: 'oui' } } })).status === 400);
  const good = await call('POST', `/questionnaires/targets/${tg}/answers`, { ...A, body: { answers: { q1: '3,5', q2: 'Oui', q3: 'Prix', q4: ['Bâche'], q5: 'RAS' } } });
  check('réponses enregistrées', good.status === 201 && good.body.status === 'done', good.body);
  check('seconde saisie refusée', (await call('POST', `/questionnaires/targets/${tg}/answers`, { ...A, body: { answers: { q1: 1, q2: 'non' } } })).status === 400);
  const after = (await call('GET', `/producer-assignments?producer_id=${prods[0].id}`, A)).body.find((x) => x.target_id === tg);
  check('la tâche passe à « fait » dans le profil', after.status === 'done' && after.done_at);
  const manual = (await call('GET', `/producer-assignments?producer_id=${prods[1].id}`, A)).body.find((x) => x.questionnaire_id === q.body.id);
  check('« marquer fait » à la main refusé pour un questionnaire', (await call('POST', `/producer-assignments/targets/${manual.target_id}/done`, A)).status === 400);

  console.log('Envoi hors connexion (synchronisation)');
  const tg2 = (await call('GET', `/producer-assignments?producer_id=${prods[2].id}`, A)).body.find((x) => x.questionnaire_id === impc.body.id).target_id;
  const batch = await call('POST', '/sync/batch', { ...A, body: { operations: [{ idempotency_key: 'qa-' + run + '-1', type: 'questionnaire.answer', payload: { id: tg2, answers: { q1: 41, q2: 'Femme' } } }] } });
  check('réponses envoyées par la synchronisation', batch.status === 201 && batch.body.results?.[0]?.status === 'accepted', batch.body);
  const prof2 = (await call('GET', `/producer-assignments?producer_id=${prods[2].id}`, A)).body.find((x) => x.target_id === tg2);
  check('le profil montre les réponses (questions + réponses)', prof2.status === 'done' && prof2.answers?.q1 === 41 && prof2.questions.length === 2, prof2);

  console.log('Résultats');
  const res = await call('GET', `/questionnaires/assignments/${sel.body.id}/results`, A);
  const r0 = res.body.rows?.find((r) => r.internal_code === prods[0].internal_code);
  check('résultats : réponses du producteur 1, producteur 2 à faire', r0?.answers?.q1 === 3.5 && res.body.rows.find((r) => r.internal_code === prods[1].internal_code)?.status === 'pending', res.body);
  const csvOut = await fetch(API + `/questionnaires/assignments/${sel.body.id}/results?format=csv`, { headers: { Authorization: 'Bearer ' + t, 'X-Organization-Id': org.id } });
  const txt = await csvOut.text();
  check('export CSV', csvOut.status === 200 && txt.includes('Nombre de parcelles') && txt.includes('3.5'), txt.slice(0, 200));

  console.log('Modèles types');
  // ── Questionnaires types pré-chargés (coaching, CLMRS, enquête de base, travail des enfants…)
  const lst = (await call('GET', '/questionnaires', { token: t, org: org.id })).body;
  const types = lst.filter((x) => x.template_code);
  check('18 questionnaires types pré-chargés (dont les 6 étapes du coaching)', types.length === 18 && ['coaching-1-diagnostic', 'coaching-2-pde', 'coaching-3-bpa', 'coaching-4-cep', 'coaching-5-suivi', 'coaching-6-evaluation', 'rdue', 'clmrs', 'enquete-base', 'travail-enfants', 'ii-ra', 'ii-ft', 'ii-ft-usa', 'ii-fusion'].every((c) => types.some((x) => x.template_code === c)), types.map((x) => x.template_code));
  const clm = types.find((x) => x.template_code === 'clmrs');
  const ed = await call('POST', `/questionnaires/${clm.id}/update`, { token: t, org: org.id, body: { title: 'CLMRS — version coopérative', description: 'Adapté', questions: [{ label: 'Nombre d\'enfants scolarisés', type: 'nombre', required: true }, { label: 'Observations', type: 'texte' }] } });
  check('l\'ADG modifie un questionnaire type non envoyé', ed.status === 201 && ed.body.title.includes('version coopérative'), ed.body);
  const dup = await call('POST', `/questionnaires/${types.find((x) => x.template_code === 'coaching-1-diagnostic').id}/duplicate`, { token: t, org: org.id });
  check('duplication', dup.status === 201 && /copie/.test(dup.body.title) && dup.body.template_code == null, dup.body);
  check('les modèles ne sont pas rechargés en double', (await call('GET', '/questionnaires', { token: t, org: org.id })).body.filter((x) => x.template_code).length === 18);
  const prog = await call('POST', '/producer-assignments/coaching-program', { ...A, body: { scope: 'selected', producer_ids: [prods[0].id], start_date: '2026-11-02', interval_days: 30 } });
  check('programme de coaching : 6 tâches espacées de 30 jours', prog.status === 201 && prog.body.assignments.length === 6 && String(prog.body.assignments[5].due_date).startsWith('2027-04-01'), prog.body);
  const etapesCoach = (await call('GET', `/producer-assignments?producer_id=${prods[0].id}`, A)).body;
  check('les 6 étapes figurent au profil du producteur', ['Étape 1', 'Étape 2', 'Étape 3', 'Étape 4', 'Étape 5', 'Étape 6'].every((e) => etapesCoach.some((x) => x.title.includes(e))), etapesCoach.map((x) => x.title));
  const back = await call('POST', '/questionnaires/defaults', { token: t, org: org.id });
  check('recharger les modèles types : rien à ajouter', back.status === 201 && back.body.added === 0, back.body);
  console.log('Inspection interne : tâche du producteur, logos, export PDF');
  const fiches = (await call('GET', '/questionnaires', A)).body;
  const ii = fiches.find((x) => x.template_code === 'ii-ra');
  const aI = await call('POST', '/producer-assignments', { ...A, body: { kind: 'tache', scope: 'selected', producer_ids: [prods[0].id], questionnaire_id: ii.id } });
  check('la fiche RA devient une tâche « inspection » du producteur', aI.status === 201 && aI.body.kind === 'inspection', aI.body);
  const mineI = (await call('GET', `/producer-assignments?producer_id=${prods[0].id}`, A)).body.find((x) => x.kind === 'inspection');
  check('visible dans les tâches du producteur (téléphone)', !!mineI && Array.isArray(mineI.questions) && mineI.questions.length === 82, mineI?.questions?.length);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const lf = new FormData(); lf.append('file', new Blob([png], { type: 'image/png' }), 'ra.png');
  check('logo de la certification enregistré', (await call('PUT', '/certification-logos/rainforest_alliance', { ...A, form: lf })).status === 200);
  check('format refusé (texte)', (await call('PUT', '/certification-logos/fairtrade', { ...A, form: (() => { const x = new FormData(); x.append('file', new Blob(['abc']), 'x.png'); return x; })() })).status === 400);
  check('liste des logos', (await call('GET', '/certification-logos', A)).body.find((x) => x.scheme === 'rainforest_alliance')?.has_logo === true);
  const ans = {}; for (const qq of mineI.questions) ans[qq.id] = qq.type === 'choice' ? (qq.options[0]) : qq.type === 'date' ? '2026-10-26' : qq.type === 'number' ? 2 : qq.type === 'yesno' ? 'oui' : 'RAS';
  ans[mineI.questions.find((x) => x.label.startsWith('1.2.1')).id] = 'Non conforme';
  const sv = await call('POST', `/questionnaires/targets/${mineI.target_id}/answers`, { ...A, body: { answers: ans } });
  check('fiche renseignée', sv.status === 201, sv.body);
  const ex = await fetch(API + `/questionnaires/targets/${mineI.target_id}/export?certification=rainforest_alliance`, { headers: { Authorization: 'Bearer ' + t, 'X-Organization-Id': org.id } });
  const pdf = Buffer.from(await ex.arrayBuffer());
  check('export PDF avec le logo de la certification', ex.status === 200 && pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 5000 && /image\/png|\/Image/.test(pdf.toString('latin1')), [ex.status, pdf.length]);
  check('certification inconnue : refusée', (await fetch(API + `/questionnaires/targets/${mineI.target_id}/export?certification=xx`, { headers: { Authorization: 'Bearer ' + t, 'X-Organization-Id': org.id } })).status === 400);
  require('fs').writeFileSync(process.env.PDF_OUT || '/tmp/inspection-test.pdf', pdf);
  console.log('Droits et isolation');
  const org2 = (await call('POST', '/organizations', { token: adm, body: { code: 'QSB' + run, name: 'QSB' + run } })).body;
  await call('POST', `/organizations/${org2.id}/admins`, { token: adm, body: { email: `qb.${run.toLowerCase()}@t.test`, full_name: 'Autre', password: pw } });
  const t2 = await login(`qb.${run.toLowerCase()}@t.test`, pw);
  check('une autre coopérative ne voit pas les questionnaires', !(await call('GET', '/questionnaires', { token: t2, org: org2.id })).body.some((x) => x.template_code == null) && (await call('GET', `/questionnaires/targets/${tg}`, { token: t2, org: org2.id })).status === 404);
  check('sans connexion : 401', (await call('GET', '/questionnaires')).status === 401);
  check('archivage', (await call('POST', `/questionnaires/${q.body.id}/archive`, A)).body.archived === true);
  check('questionnaire archivé non affectable', (await call('POST', '/producer-assignments', { ...A, body: { kind: 'tache', scope: 'all', questionnaire_id: q.body.id } })).status === 404);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
