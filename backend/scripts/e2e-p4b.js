// Test de bout en bout P4b : règles qualité, inspections, actions correctives, documents, certificats, alertes.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, form, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(API + path, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pdf = (txt) => Buffer.from(`%PDF-1.4\n% ${txt}\n%%EOF\n`);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(40)]);
const upload = (tok, org, buf, fields, name = 'piece.pdf', type = 'application/pdf') => {
  const f = new FormData();
  f.append('file', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return call('POST', '/documents', { token: tok, org: org.id, form: f });
};

(async () => {
  const pw = 'MotDePasseSolide2026!';
  console.log('Mise en place');
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (code) => (await call('POST', '/organizations', { token: adm, body: { code, name: code } })).body;
  const A = await mkOrg('RA' + run), B = await mkOrg('RB' + run);
  for (const [org, mail] of [[A, `a1.${run}@t.test`], [B, `b1.${run}@t.test`]])
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
  const t1 = await login(`a1.${run}@t.test`, pw), tb = await login(`b1.${run}@t.test`, pw);
  const J = (t, o) => ({ token: t, org: o.id });
  const vc = (await call('POST', '/value-chains', { ...J(t1, A), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const prod = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const prod2 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'TRAORE', first_names: 'Moussa', village: 'Zoukougbeu', section: 'S2', value_chain_ids: [vc.id] } })).body.producer;
  const wh = (await call('POST', '/warehouses', { ...J(t1, A), body: { code: 'MAG1', name: 'Magasin 1' } })).body;
  check('mise en place terminée', !!(vc.id && prod.id && wh.id));

  console.log('Règles qualité configurables');
  const rHum = await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'HUMIDITE', label: 'Humidité (%)', kind: 'numeric', max_value: '8', unit: '%', blocking: true, value_chain_id: vc.id, market: 'UE' } });
  const rGrain = await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'GRAINS_MOISIS', label: 'Grains moisis (%)', kind: 'numeric', max_value: '4', value_chain_id: vc.id } });
  const rEnf = await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'PAS_TRAVAIL_ENFANTS', label: 'Absence de travail d\'enfants constatée', kind: 'boolean', expected_bool: true, blocking: true } });
  check('3 règles créées (numérique bloquante, numérique, booléenne)', [rHum, rGrain, rEnf].every((r) => r.status === 201), [rHum.body, rGrain.body, rEnf.body]);
  check('règle numérique sans seuil → 400', (await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'X1', label: 'Sans seuil', kind: 'numeric' } })).status === 400);
  check('min > max → 400', (await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'X2', label: 'Inversée', kind: 'numeric', min_value: '9', max_value: '1' } })).status === 400);
  check('code en double → 409', (await call('POST', '/quality-rules', { ...J(t1, A), body: { code: 'HUMIDITE', label: 'Autre', kind: 'numeric', max_value: '1' } })).status === 409);
  check('filtre par marché : la règle « UE » apparaît pour UE, pas pour un autre marché', (await call('GET', '/quality-rules?market=UE', J(t1, A))).body.length === 3 && (await call('GET', '/quality-rules?market=US', J(t1, A))).body.length === 2);
  check('règles invisibles pour une autre coopérative', (await call('GET', '/quality-rules', J(tb, B))).body.length === 0);

  console.log('Inspections');
  const ik = key('insp');
  const I = await call('POST', '/inspections', { ...J(t1, A), body: { idempotency_key: ik, subject_type: 'producer', subject_id: prod.id, kind: 'quality', scheduled_for: addDays(-3) } });
  check('inspection planifiée', I.status === 201 && I.body.status === 'planned', I.body);
  check('renvoi : même inspection', (await call('POST', '/inspections', { ...J(t1, A), body: { idempotency_key: ik, subject_type: 'producer', subject_id: prod.id, kind: 'quality' } })).body.replayed === true);
  check('objet d\'une autre coopérative → 400', (await call('POST', '/inspections', { ...J(tb, B), body: { idempotency_key: key('insp'), subject_type: 'producer', subject_id: prod.id, kind: 'quality' } })).status === 400);
  const id = I.body.id;
  check('résultats avant démarrage → 400', (await call('POST', `/inspections/${id}/results`, { ...J(t1, A), body: { results: [{ rule_id: rHum.body.id, value_num: '7' }] } })).status === 400);
  check('clôture avant démarrage → 400', (await call('POST', `/inspections/${id}/complete`, { ...J(t1, A), body: { summary: 'Test' } })).status === 400);
  const al0 = (await call('GET', '/alerts', J(t1, A))).body;
  check('alerte : inspection planifiée en retard', al0.inspections_overdue.some((x) => x.id === id), al0.counts);
  check('démarrage', (await call('POST', `/inspections/${id}/start`, J(t1, A))).body.status === 'in_progress');
  check('clôture sans résultat → 422', (await call('POST', `/inspections/${id}/complete`, { ...J(t1, A), body: { summary: 'Rien' } })).status === 422);
  const res = await call('POST', `/inspections/${id}/results`, { ...J(t1, A), body: { results: [
    { rule_id: rHum.body.id, value_num: '9.5', note: 'Mesuré au testeur' }, { rule_id: rGrain.body.id, value_num: '2' }, { rule_id: rEnf.body.id, value_bool: true }] } });
  check('résultats évalués par le serveur : 1 anomalie (humidité 9,5 > 8)', res.status === 201 && res.body.anomalies.length === 1 && res.body.anomalies[0].rule_code === 'HUMIDITE', res.body);
  check('règle déjà renseignée → 409', (await call('POST', `/inspections/${id}/results`, { ...J(t1, A), body: { results: [{ rule_id: rHum.body.id, value_num: '5' }] } })).status === 409);
  const done = await call('POST', `/inspections/${id}/complete`, { ...J(t1, A), body: { summary: 'Humidité hors norme, lot à resécher' } });
  check('issue calculée : non conforme (règle bloquante en échec)', done.body.status === 'completed' && done.body.outcome === 'non_compliant', done.body);
  check('résultats après clôture → 400', (await call('POST', `/inspections/${id}/results`, { ...J(t1, A), body: { results: [{ rule_id: rGrain.body.id, value_num: '1' }] } })).status === 400);

  console.log('Actions correctives');
  const act = await call('POST', `/inspections/${id}/actions`, { ...J(t1, A), body: { description: 'Resécher le lot et remesurer', due_date: addDays(-1) } });
  check('action corrective créée', act.status === 201 && act.body.status === 'open', act.body);
  const al1 = (await call('GET', '/alerts', J(t1, A))).body;
  check('alerte : action corrective en retard', al1.corrective_actions_overdue.some((x) => x.id === act.body.id));
  check('clôture de l\'action', (await call('POST', `/corrective-actions/${act.body.id}/close`, { ...J(t1, A), body: { status: 'done', note: 'Humidité remesurée à 7 %' } })).body.status === 'done');
  check('double clôture → 400', (await call('POST', `/corrective-actions/${act.body.id}/close`, { ...J(t1, A), body: { status: 'done', note: 'Encore' } })).status === 400);
  const det = (await call('GET', `/inspections/${id}`, J(t1, A))).body;
  check('détail : résultats avec seuils appliqués, anomalie, action', det.results.length === 3 && det.anomalies.length === 1 && Number(det.results.find((r) => r.rule_code === 'HUMIDITE').applied_max) === 8 && det.corrective_actions.length === 1, det);
  await call('POST', '/quality-rules/' + rHum.body.id + '/deactivate', J(t1, A));
  check('désactiver la règle ne modifie pas l\'historique', Number((await call('GET', `/inspections/${id}`, J(t1, A))).body.results.find((r) => r.rule_code === 'HUMIDITE').applied_max) === 8);
  const hist = (await call('GET', `/inspections?subject_type=producer&subject_id=${prod.id}`, J(t1, A))).body;
  check('historique des inspections du producteur', hist.length === 1 && hist[0].outcome === 'non_compliant');
  const al2 = (await call('GET', '/alerts?renewal_months=12', J(t1, A))).body;
  check('inspections à renouveler : producteur 2 (jamais inspecté) oui, producteur 1 (inspecté) non',
    al2.producers_to_inspect.some((p) => p.id === prod2.id) && !al2.producers_to_inspect.some((p) => p.id === prod.id), al2.counts);
  const I2 = (await call('POST', '/inspections', { ...J(t1, A), body: { idempotency_key: key('insp'), subject_type: 'warehouse', subject_id: wh.id, kind: 'compliance' } })).body;
  check('annulation d\'une inspection planifiée', (await call('POST', `/inspections/${I2.id}/cancel`, J(t1, A))).body.status === 'cancelled');

  console.log('Documents');
  const d1 = await upload(t1, A, pdf('analyse humidité v1'), { subject_type: 'inspection', subject_id: id, kind: 'rapport_analyse' }, 'rapport.pdf');
  check('PDF déposé (version 1, empreinte SHA-256)', d1.status === 201 && d1.body.version === 1 && /^[0-9a-f]{64}$/.test(d1.body.sha256) && d1.body.mime === 'application/pdf', d1.body);
  check('la clé de stockage n\'est pas exposée', d1.body.storage_key === undefined);
  const exe = await upload(t1, A, Buffer.from('MZ\x90\x00 programme'), { subject_type: 'inspection', subject_id: id, kind: 'rapport' }, 'virus.pdf');
  check('contenu non PDF/image déguisé en .pdf → 400', exe.status === 400, exe.body);
  check('image PNG acceptée', (await upload(t1, A, png, { subject_type: 'producer', subject_id: prod.id, kind: 'photo' }, 'photo.png', 'image/png')).status === 201);
  const big = await upload(t1, A, Buffer.concat([pdf('gros'), Buffer.alloc(11 * 1024 * 1024)]), { subject_type: 'inspection', subject_id: id, kind: 'rapport' });
  check('fichier de plus de 10 Mo refusé', big.status === 413 || big.status === 400, big.status);
  check('objet rattaché inconnu → 400', (await upload(t1, A, pdf('x'), { subject_type: 'lot', subject_id: crypto.randomUUID(), kind: 'bon' })).status === 400);
  const d1v2 = await upload(t1, A, pdf('analyse humidité v2 corrigée'), { subject_type: 'inspection', subject_id: id, kind: 'rapport_analyse', replaces_id: d1.body.id }, 'rapport-v2.pdf');
  check('nouvelle version : version 2', d1v2.status === 201 && d1v2.body.version === 2, d1v2.body);
  check('remplacer deux fois la même version → 409', (await upload(t1, A, pdf('autre'), { subject_type: 'inspection', subject_id: id, kind: 'rapport_analyse', replaces_id: d1.body.id })).status === 409);
  const dl = (await call('GET', `/documents?subject_type=inspection&subject_id=${id}`, J(t1, A))).body;
  check('liste : v1 historique, v2 courante', dl.length === 2 && dl.find((d) => d.version === 2).is_latest === true && dl.find((d) => d.version === 1).is_latest === false, dl);
  const got = await call('GET', `/documents/${d1v2.body.id}/download`, { ...J(t1, A), raw: true });
  const gotBuf = Buffer.from(await got.arrayBuffer());
  check('téléchargement : contenu identique, en-têtes de sécurité', got.status === 200 && gotBuf.equals(pdf('analyse humidité v2 corrigée')) && got.headers.get('x-content-type-options') === 'nosniff' && /attachment/.test(got.headers.get('content-disposition')) && /no-store/.test(got.headers.get('cache-control')));
  check('document d\'une autre coopérative introuvable', (await call('GET', `/documents/${d1.body.id}/download`, { ...J(tb, B), raw: true })).status === 404);
  const sens = await upload(t1, A, pdf('contrat confidentiel'), { subject_type: 'producer', subject_id: prod.id, kind: 'contrat', sensitive: 'true' }, 'contrat.pdf');
  check('document sensible déposé', sens.status === 201 && sens.body.sensitive === true);
  // utilisateur avec lecture mais sans accès sensible
  const role = (await call('POST', '/roles', { ...J(t1, A), body: { code: 'lecteur_docs', name: 'Lecteur', permissions: ['documents:read'] } })).body;
  await call('POST', '/users', { ...J(t1, A), body: { email: `l1.${run}@t.test`, full_name: 'Lecteur', password: pw, role_id: role.id } });
  const tl = await login(`l1.${run}@t.test`, pw);
  check('lecteur : document ordinaire OK', (await call('GET', `/documents/${d1v2.body.id}/download`, { ...J(tl, A), raw: true })).status === 200);
  check('lecteur : document sensible → 403', (await call('GET', `/documents/${sens.body.id}/download`, { ...J(tl, A), raw: true })).status === 403);
  check('lecteur : dépôt interdit → 403', (await upload(tl, A, pdf('x'), { subject_type: 'producer', subject_id: prod.id, kind: 'photo' })).status === 403);
  await call('GET', `/documents/${sens.body.id}/download`, { ...J(t1, A), raw: true });
  const dls = (await call('GET', `/documents/${sens.body.id}/downloads`, J(t1, A))).body;
  check('journal des téléchargements : accès refusé non journalisé, accès autorisé journalisé', dls.length === 1, dls);

  console.log('Certificats et alertes');
  const c1 = await call('POST', '/certificates', { ...J(t1, A), body: { holder_type: 'organization', scheme: 'Rainforest Alliance', number: 'RA-' + run, issuer: 'Organisme X', issued_on: addDays(-300), expires_on: addDays(20), document_id: d1.body.id } });
  const c2 = await call('POST', '/certificates', { ...J(t1, A), body: { holder_type: 'producer', holder_id: prod.id, scheme: 'Fairtrade', number: 'FT-' + run, issuer: 'FLO', issued_on: addDays(-400), expires_on: addDays(-5) } });
  const c3 = await call('POST', '/certificates', { ...J(t1, A), body: { holder_type: 'warehouse', holder_id: wh.id, scheme: 'BPF', number: 'B-' + run, issuer: 'Autorité', issued_on: addDays(-10), expires_on: addDays(300) } });
  check('3 certificats enregistrés', [c1, c2, c3].every((c) => c.status === 201), [c1.body, c2.body, c3.body]);
  const dupc = await call('POST', '/certificates', { ...J(t1, A), body: { holder_type: 'organization', scheme: 'Rainforest Alliance', number: 'RA-' + run, issuer: 'Organisme Y', issued_on: addDays(-1), expires_on: addDays(10) } });
  check('doublon (schéma + numéro) → 409', dupc.status === 409, dupc);
  check('expiration avant émission → 400', (await call('POST', '/certificates', { ...J(t1, A), body: { holder_type: 'organization', scheme: 'S', number: 'N', issuer: 'X', issued_on: addDays(10), expires_on: addDays(1) } })).status === 400);
  check('titulaire inconnu → 400', (await call('POST', '/certificates', { ...J(t1, A), body: { holder_type: 'producer', holder_id: crypto.randomUUID(), scheme: 'S', number: 'N2', issuer: 'X', issued_on: addDays(-10), expires_on: addDays(10) } })).status === 400);
  const cl = (await call('GET', '/certificates', J(t1, A))).body;
  const v = Object.fromEntries(cl.map((c) => [c.scheme, c.validity]));
  check('validité calculée : expirant / expiré / valide, avec mention de non-substitution', v['Rainforest Alliance'] === 'expiring' && v.Fairtrade === 'expired' && v.BPF === 'valid' && /organisme officiel/.test(cl[0].notice), v);
  const al3 = (await call('GET', '/alerts', J(t1, A))).body;
  check('alertes : 1 certificat expirant, 1 expiré', al3.certificates_expiring.length === 1 && al3.certificates_expired.length === 1, al3.counts);
  check('révocation', (await call('POST', `/certificates/${c3.body.id}/revoke`, { ...J(t1, A), body: { reason: 'Retrait par l\'autorité' } })).body.revoked === true);
  check('double révocation → 400', (await call('POST', `/certificates/${c3.body.id}/revoke`, { ...J(t1, A), body: { reason: 'Encore' } })).status === 400);
  check('les certificats de A sont invisibles pour B', (await call('GET', '/certificates', J(tb, B))).body.length === 0 && (await call('GET', '/alerts', J(tb, B))).body.counts.certificates_expiring === 0);
  check('accès aux alertes de A avec le jeton de B → 403', (await call('GET', '/alerts', J(tb, A))).status === 403);
  const aud = await call('GET', '/audit-logs?limit=500', J(t1, A));
  check('journal d\'audit : inspections, documents sensibles, certificats', ['inspection.complete', 'document.download_sensitive', 'certificate.revoke'].every((a) => JSON.stringify(aud.body).includes(a)), aud.status);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
