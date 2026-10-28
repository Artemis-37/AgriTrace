// Test de bout en bout : inspection interne — non-conformités automatiques, approbation à 100 % (toutes les fiches), reprise notifiée, croquis PDF.
const API = process.env.API || 'http://localhost:3000/v1';
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
async function call(method, path, { token, org, body } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (org) headers['x-organization-id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: res.status, body: json, buf };
}
const login = async (e, p) => (await call('POST', '/auth/login', { body: { email: e, password: p } })).body.access_token;
(async () => {
  const run = Math.random().toString(16).slice(2, 8).toUpperCase(), pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'IN' + run, name: 'IN' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `in.${run}@t.test`, full_name: 'Chef', password: pw } });
  const J = { token: await login(`in.${run}@t.test`, pw), org: org.id };
  await call('POST', '/questionnaires/defaults', J);
  const qs = (await call('GET', '/questionnaires', J)).body;
  const q = (await call('GET', `/questionnaires/${qs.find((x) => x.template_code === 'ii-ra').id}`, J)).body;
  const questions = q.questions;
  const mkProd = async (n) => (await call('POST', '/producers', { ...J, body: { last_name: n, first_names: 'T' } })).body.producer;
  const p1 = await mkProd('A' + run), p2 = await mkProd('B' + run);
  // parcelle avec polygone pour le croquis
  const vc = (await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao', default_unit: 'kg' } })).body;
  const pr = await call('POST', '/parcels', { ...J, body: { idempotency_key: 'idem-' + run + '-1', value_chain_id: vc.id, producer_id: p1.id, declared_area_ha: '2', geometry: { type: 'Polygon', coordinates: [[[-5.30, 6.80], [-5.299, 6.80], [-5.299, 6.801], [-5.30, 6.801], [-5.30, 6.80]]] } } });
  console.log('  parcelle', pr.status);
  const asg = await call('POST', '/producer-assignments', { ...J, body: { kind: 'inspection', scope: 'selected', producer_ids: [p1.id, p2.id], questionnaire_id: q.id, title: 'II ' + run } });
  check('affectation créée', asg.status === 201, asg.body);
  const targets = (await call('GET', '/producer-assignments?mine=1&compact=1', J)).body.assignments.filter((a) => a.id === asg.body.id);
  const t1 = targets.find((t) => t.producer_id === p1.id).target_id, t2 = targets.find((t) => t.producer_id === p2.id).target_id;
  const base = {};
  for (const x of questions) {
    if (x.type === 'choice' && x.options.includes('Conforme')) base[x.id] = 'Conforme';
    else if (x.type === 'date') base[x.id] = '2026-10-01';
    else if (x.type === 'yesno') base[x.id] = 'oui';
    else if (x.type === 'number') base[x.id] = 1;
    else if (x.type === 'choice') base[x.id] = x.options[0];
    else if (x.required) base[x.id] = 'x';
  }
  const ev = questions.filter((x) => x.type === 'choice' && x.options.includes('Conforme'));
  const dec = questions.find((x) => /^Recommandation de l.inspecteur/.test(x.label)), nc = questions.find((x) => /^Non-conformités relevées/.test(x.label));
  // 1 non-conformité sur ~N : score élevé → approuvé
  const a1 = { ...base, [ev[2].id]: 'Non conforme', [dec.id]: 'Exclu', ['obs.' + ev[2].id]: 'Le producteur ne retrouve pas son exemplaire du contrat', ['mes.' + ev[2].id]: 'Expliquer le contenu du contrat au producteur — sous 1 mois', ['obs.' + ev[0].id]: 'Le producteur connaît les lois applicables et s\'y conforme' };
  const pre = (await call('GET', '/producer-assignments?mine=1&compact=1', J)).body;
  const qq = Object.values(pre.questionnaires).find((x) => x.some((y) => y.observations));
  check('listes d\'observations fournies avec les exigences (C / NC / N/A)', !!qq && qq.filter((y) => y.observations).length === 65 && qq.every((y) => !y.observations || (y.observations.C.length && y.observations.NC.length && y.observations.NA.length)), qq && qq.filter((y) => y.observations).length);
  const r1 = await call('POST', `/questionnaires/targets/${t1}/answers`, { ...J, body: { answers: a1 } });
  check('1 non-conformité (< 100 %) : à reprendre', r1.body?.status === 'to_redo' && r1.body.score < 100, r1.body);
  const saved = (await call('GET', `/questionnaires/targets/${t1}`, J)).body;
  check('décision non approuvée (choix de l\'inspecteur conservé)', saved.answers[dec.id] !== 'Approuvé', saved.answers[dec.id]);
  check('non-conformités renseignées avec le numéro de l\'exigence', /^\d+\.\d+\.\d+/.test(saved.answers[nc.id]), saved.answers[nc.id]);
  check('observation enregistrée et reprise comme constat', saved.answers['obs.' + ev[2].id] === 'Le producteur ne retrouve pas son exemplaire du contrat' && /exemplaire du contrat/.test(saved.answers[nc.id]), saved.answers[nc.id]);
  const cor = questions.find((x) => /^Mesures correctives/.test(x.label));
  check('mesures correctives composées d\'après les non-conformités (mesure choisie reprise)', /Expliquer le contenu du contrat/.test(saved.answers[cor.id]), saved.answers[cor.id]);
  const pdf = await call('GET', `/questionnaires/targets/${t1}/export`, J);
  check('export PDF d\'une fiche en reprise (avec non-conformités et croquis)', pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF' && pdf.buf.length > 3000, pdf.status);
  require('fs').writeFileSync('/tmp/inspection-test.pdf', pdf.buf);
  const wd = await call('GET', `/questionnaires/targets/${t1}/export?format=docx`, J);
  check('export Word (.docx valide)', wd.status === 200 && wd.buf.slice(0, 2).toString() === 'PK' && wd.buf.length > 5000, wd.status);
  require('fs').writeFileSync('/tmp/inspection-test.docx', wd.buf);
  const r1b = await call('POST', `/questionnaires/targets/${t1}/answers`, { ...J, body: { answers: { ...base } } });
  check('reprise corrigée : 100 % terminé et approuvé', r1b.body?.status === 'done' && r1b.body.score === 100, r1b.body);
  const sv2 = (await call('GET', `/questionnaires/targets/${t1}`, J)).body;
  check('décision « Approuvé »', sv2.answers[dec.id] === 'Approuvé', sv2.answers[dec.id]);
  // beaucoup de non-conformités → reprise
  const a2 = { ...base }; ev.slice(0, Math.ceil(ev.length / 2)).forEach((x) => { a2[x.id] = 'Non conforme'; });
  const r2 = await call('POST', `/questionnaires/targets/${t2}/answers`, { ...J, body: { answers: a2 } });
  check('score < 100 % : à reprendre', r2.body?.status === 'to_redo' && r2.body.score < 100, r2.body);
  const list = (await call('GET', '/producer-assignments?mine=1&compact=1', J)).body.assignments.find((a) => a.target_id === t2);
  check('élément resté à faire, marqué à reprendre, réponses conservées', list.status === 'pending' && list.needs_redo === true && !!list.answers && /100/.test(list.redo_reason), list);
  const notes = (await call('GET', '/notifications', J)).body;
  check('coach notifié', JSON.stringify(notes).includes('Inspection à reprendre'), notes);
  const a3 = { ...base };
  const r3 = await call('POST', `/questionnaires/targets/${t2}/answers`, { ...J, body: { answers: a3 } });
  check('reprise acceptée et approuvée', r3.body?.status === 'done' && r3.body.score === 100, r3.body);
  const l3 = (await call('GET', '/producer-assignments?mine=1&compact=1', J)).body.assignments.find((a) => a.target_id === t2);
  check('indicateur de reprise retiré', l3.status === 'done' && l3.needs_redo === false, l3);
  // Autres fiches : Fairtrade
  const ftq = (await call('GET', `/questionnaires/${qs.find((x) => x.template_code === 'ii-ft').id}`, J)).body;
  const asg2 = await call('POST', '/producer-assignments', { ...J, body: { kind: 'inspection', scope: 'selected', producer_ids: [p1.id], questionnaire_id: ftq.id } });
  const tf = (await call('GET', '/producer-assignments?mine=1&compact=1', J)).body.assignments.find((a) => a.id === asg2.body.id).target_id;
  const tg = (await call('GET', `/questionnaires/targets/${tf}`, J)).body;
  const withObs = tg.questions.filter((x) => x.observations);
  check('fiche Fairtrade : listes d\'observations fournies', withObs.length >= 12 && withObs.every((x) => x.observations.C.length && x.observations.NC.length && x.observations.NA.length), withObs.length);
  const fa = {};
  for (const x of tg.questions) { if (x.type === 'date') fa[x.id] = '2026-10-01'; else if (x.type === 'yesno') fa[x.id] = 'oui'; else if (x.type === 'choice') fa[x.id] = x.options[0]; else if (x.type === 'multi') fa[x.id] = [x.options[0]]; else if (x.required) fa[x.id] = 'x'; }
  const nq = withObs.find((x) => x.type === 'yesno'); fa[nq.id] = 'non'; fa['obs.' + nq.id] = nq.observations.NC[0];
  check('fiche Fairtrade : mesures proposées pour les points non conformes', withObs.filter((x) => x.measures?.length >= 2).length >= 12, withObs.filter((x) => x.measures?.length).length);
  const rf = await call('POST', `/questionnaires/targets/${tf}/answers`, { ...J, body: { answers: fa } });
  check('fiche Fairtrade avec un « non » : à reprendre, score < 100 %', rf.body?.status === 'to_redo' && rf.body.score < 100, rf.body);
  const sf = (await call('GET', `/questionnaires/targets/${tf}`, J)).body;
  check('fiche Fairtrade : observation enregistrée', sf.answers['obs.' + nq.id] === nq.observations.NC[0], sf.answers['obs.' + nq.id]);
  const fcor = tg.questions.find((x) => /^Actions correctives demandées/.test(x.label));
  check('fiche Fairtrade : actions correctives composées', sf.answers[fcor.id].includes(nq.measures[0]), sf.answers[fcor.id]);
  const fnc = tg.questions.find((x) => /^Non-conformités relevées/.test(x.label));
  if (fnc) check('fiche Fairtrade : non-conformités renseignées', /\S/.test(sf.answers[fnc.id]) && !/Aucune/.test(sf.answers[fnc.id]), sf.answers[fnc.id]);
  const lf = (await call('GET', '/producer-assignments?mine=1&compact=1', J)).body.assignments.find((a) => a.target_id === tf);
  check('fiche Fairtrade : marquée à reprendre', lf.needs_redo === true && lf.status === 'pending', lf);
  const notes2 = JSON.stringify((await call('GET', '/notifications', J)).body);
  check('coach notifié pour la fiche Fairtrade', notes2.includes('Inspection à reprendre'), 1);
  const pf = await call('GET', `/questionnaires/targets/${tf}/export`, J);
  check('fiche Fairtrade : export PDF', pf.status === 200 && pf.buf.slice(0, 4).toString() === '%PDF', pf.status);
  fa[nq.id] = 'oui'; delete fa['obs.' + nq.id];
  const rf2 = await call('POST', `/questionnaires/targets/${tf}/answers`, { ...J, body: { answers: fa } });
  check('fiche Fairtrade reprise corrigée : 100 % terminé', rf2.body?.status === 'done' && rf2.body.score === 100, rf2.body);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
