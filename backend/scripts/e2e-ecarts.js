// Test de bout en bout : versions de géométrie, relevés bancaires, rapports programmés, notifications poussées (faux serveur FCM).
// Le bloc « poussée » exige que l'API ait été lancée avec FCM_SERVICE_ACCOUNT_JSON=<compte de service factice dont token_uri = http://localhost:4599/token>,
// FCM_ENDPOINT=http://localhost:4599 et PUSH_INTERVAL_SEC=1 ; sinon il est ignoré.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const http = require('http');
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const pw = 'MotDePasseSolide2026!';
const d = 0.0009;
const square = (lon, lat, size = d) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function upload(path, { token, org, file, fields }) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields || {})) f.append(k, v);
  f.append('file', new Blob([file.content]), file.name);
  const res = await fetch(API + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-organization-id': org }, body: f });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

(async () => {
  // Faux serveur FCM : enregistre les messages ; un jeton « UNREG… » est déclaré périmé.
  const sent = [];
  const fcm = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', (x) => (b += x)); rq.on('end', () => {
      if (rq.url === '/token') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 })); }
      const m = JSON.parse(b || '{}').message;
      if (rq.headers.authorization !== 'Bearer tok') { rs.statusCode = 401; return rs.end('{}'); }
      if (m?.token?.startsWith('UNREG')) { rs.statusCode = 404; return rs.end('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}'); }
      sent.push(m); rs.setHeader('content-type', 'application/json'); rs.end('{"name":"ok"}');
    });
  }).listen(4599);

  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'EC' + run, name: 'EC' + run } })).body;
  const mail = `ec.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });
  const roles = (await call('GET', '/roles', J(t0))).body;
  const mkRole = async (code, permissions) => roles.find?.((r) => r.code === code) ?? (await call('POST', '/roles', { ...J(t0), body: { code, name: code, permissions } })).body;
  const rRep = await mkRole('lecteur_rapports', ['reports:read', 'finance:read', 'sync:use']);
  const lect = await (async () => { const email = `lect.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: 'Lecteur', password: pw, role_id: rRep.id } })).body; return { id: u.id, t: await login(email, pw) }; })();

  console.log('Versions de géométrie');
  const vc = (await call('POST', '/value-chains', { ...J(t0), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const pr = (await call('POST', '/producers', { ...J(t0), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const P = await call('POST', '/parcels', { ...J(t0), body: { idempotency_key: key('parcel'), producer_id: pr.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: square(-6, 6.8) } });
  const v1 = await call('GET', `/parcels/${P.body.id}/geometry-versions`, J(t0));
  check('version 1 à la création', v1.status === 200 && v1.body.length === 1 && v1.body[0].version === 1 && Number(v1.body[0].area_ha) > 0.9, v1.body);
  const up = await call('POST', `/parcels/${P.body.id}/update`, { ...J(t0), body: { geometry: square(-6, 6.8, 0.0012), reason: 'Relevé plus précis' } });
  check('modification de la géométrie', up.status === 201 || up.status === 200, up.body);
  const v2 = await call('GET', `/parcels/${P.body.id}/geometry-versions?with_geometry=1`, J(t0));
  check('version 2 avec auteur, motif et tracé', v2.body.length === 2 && v2.body[1].version === 2 && v2.body[1].actor_name === 'Chef' && v2.body[1].reason === 'Relevé plus précis' && !!v2.body[1].geometry, v2.body);
  check('la version 1 garde l\'ancienne surface', Number(v2.body[0].area_ha) < Number(v2.body[1].area_ha), v2.body.map((x) => x.area_ha));
  await call('POST', `/parcels/${P.body.id}/update`, { ...J(t0), body: { declared_area_ha: '2' } });
  check('changement sans géométrie : pas de nouvelle version', (await call('GET', `/parcels/${P.body.id}/geometry-versions`, J(t0))).body.length === 2);
  check('parcelle inconnue : 404', (await call('GET', `/parcels/${crypto.randomUUID()}/geometry-versions`, J(t0))).status === 404);

  console.log('Relevé bancaire');
  const reg = (await call('POST', '/cash-registers', { ...J(t0), body: { name: 'Banque principale' } })).body;
  const rCS = (await call('POST', '/roles/standard', { ...J(t0), body: { code: 'caissier' } })).body;
  await call('POST', '/users', { ...J(t0), body: { email: `cs.${run}@t.test`, full_name: 'Caissier', password: pw, role_id: rCS.id } });
  const tcs = await login(`cs.${run}@t.test`, pw);
  const sess = (await call('POST', `/cash-registers/${reg.id}/sessions`, { ...J(tcs), body: { opening_amount: '0' } })).body;
  const tx = async (direction, amount, reason) => (await call('POST', '/financial-transactions', { ...J(t0), body: { idempotency_key: key('tx'), account_id: reg.account_id, cash_session_id: sess.id, direction, amount, reason } })).body;
  const t1 = await tx('in', '500000', 'Versement client A'), t2 = await tx('in', '120000', 'Versement client B'), t3 = await tx('out', '75000', 'Achat fournitures');
  const t4 = await tx('in', '30000', 'Doublon possible 1'), t5 = await tx('in', '30000', 'Doublon possible 2'), t6 = await tx('in', '999000', 'Opération absente du relevé');
  check('opérations de caisse préparées', !!(t1.id && t2.id && t3.id && t4.id && t5.id && t6.id), [t1, t6]);
  const today = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  const csv = `Date;Libellé;Débit;Crédit;Réf\n${today};VIR CLIENT A;;500 000,00;R1\n${today};VIR CLIENT B;;120 000;R2\n${today};ACHAT FOURNITURES;75 000,00;;R3\n${today};REMISE X;;30 000,00;R4\n${today};FRAIS BANCAIRES;1 500,00;;R5\n${today};Total;;;\n`;
  const mapping = JSON.stringify({ date: 'Date', label: 'Libellé', debit: 'Débit', credit: 'Crédit', reference: 'Réf' });
  const bad = await upload('/bank-statements/import', { ...J(t0), file: { name: 'rel.csv', content: csv }, fields: { account_id: reg.account_id, mapping: JSON.stringify({ date: 'Inconnue', label: 'Libellé', amount: 'Crédit' }) } });
  check('colonne inconnue refusée', bad.status === 400 && /introuvable/.test(JSON.stringify(bad.body)), bad.body);
  const dry = await upload('/bank-statements/import', { ...J(t0), file: { name: 'rel.csv', content: csv }, fields: { account_id: reg.account_id, mapping, dry_run: '1' } });
  check('simulation : 5 lignes, 3 pointées automatiquement, rien enregistré', dry.status === 201 && dry.body.lines === 5 && dry.body.auto_matched === 3 && dry.body.statement_id === null, dry.body);
  check('lecture des montants « 500 000,00 »', dry.body.preview?.some((l) => l.amount === 500000) && dry.body.preview?.some((l) => l.amount === -75000), dry.body.preview);
  { const lr = await upload('/bank-statements/import', { ...J(lect.t), file: { name: 'rel.csv', content: csv }, fields: { account_id: reg.account_id, mapping } }); check('lecteur sans droit : refusé', lr.status === 403, lr); }
  const imp = await upload('/bank-statements/import', { ...J(t0), file: { name: 'rel.csv', content: csv }, fields: { account_id: reg.account_id, mapping } });
  check('import : 3 pointées, la remise ambiguë (2 candidats) et les frais restent à traiter', imp.status === 201 && imp.body.auto_matched === 3 && imp.body.ambiguous === 1 && imp.body.unmatched === 2, imp.body);
  check('même fichier : refusé (déjà importé)', (await upload('/bank-statements/import', { ...J(t0), file: { name: 'rel.csv', content: csv }, fields: { account_id: reg.account_id, mapping } })).status === 409);
  const det = await call('GET', `/bank-statements/${imp.body.statement_id}`, J(t0)); if (!det.body.lines) console.log(det);
  const lRemise = det.body.lines.find((l) => l.label === 'REMISE X'), lFrais = det.body.lines.find((l) => l.label === 'FRAIS BANCAIRES');
  check('détail : lignes et opérations du compte sans ligne de relevé', det.body.lines.length === 5 && det.body.unmatched_book_transactions.some((x) => x.id === t6.id), det.body.summary);
  const cand = await call('GET', `/bank-statement-lines/${lRemise.id}/candidates`, J(t0));
  check('candidats de la remise : les deux opérations de 30 000', cand.body.length === 2, cand.body);
  check('pointage d\'une opération de montant différent refusé', (await call('POST', `/bank-statement-lines/${lRemise.id}/match`, { ...J(t0), body: { tx_id: t6.id } })).status === 400);
  check('pointage manuel de la remise', (await call('POST', `/bank-statement-lines/${lRemise.id}/match`, { ...J(t0), body: { tx_id: t5.id } })).status === 201);
  check('opération déjà pointée : refusée', (await call('POST', `/bank-statement-lines/${lFrais.id}/match`, { ...J(t0), body: { tx_id: t5.id } })).status === 400);
  check('frais bancaires ignorés avec une note', (await call('POST', `/bank-statement-lines/${lFrais.id}/ignore`, { ...J(t0), body: { note: 'Frais de tenue de compte' } })).status === 201);
  check('annulation d\'un pointage', (await call('POST', `/bank-statement-lines/${lRemise.id}/unmatch`, J(t0))).status === 201);
  const list = await call('GET', '/bank-statements', J(t0));
  check('liste des relevés avec compteurs', list.body.length === 1 && list.body[0].matched === 3 && list.body[0].unmatched === 1 && list.body[0].ignored === 1, list.body);

  console.log('Rapports programmés');
  check('lecteur sans droit de programmation : refusé', (await call('GET', '/report-schedules', J(lect.t))).status === 403);
  check('jour de semaine requis pour un rapport hebdomadaire', (await call('POST', '/report-schedules', { ...J(t0), body: { report: 'finance', frequency: 'weekly', recipients: [lect.id] } })).status === 400);
  check('destinataire sans droit sur le rapport refusé (stock)', (await call('POST', '/report-schedules', { ...J(t0), body: { report: 'stock', frequency: 'daily', recipients: [lect.id] } })).status === 400);
  const sch = await call('POST', '/report-schedules', { ...J(t0), body: { report: 'finance', frequency: 'daily', hour: 0, recipients: [lect.id], send_email: false } });
  check('programmation quotidienne créée', sch.status === 201 && sch.body.report === 'finance', sch.body);
  const run1 = await call('POST', `/report-schedules/${sch.body.id}/run`, J(t0));
  check('génération immédiate', run1.status === 201 && run1.body.recipients === 1 && /xlsx$/.test(run1.body.filename), run1.body);
  const dl = await fetch(API + `/report-runs/${run1.body.id}/download`, { headers: { authorization: `Bearer ${lect.t}`, 'x-organization-id': org.id } });
  const buf = Buffer.from(await dl.arrayBuffer());
  check('le destinataire télécharge un vrai fichier Excel', dl.status === 200 && buf.subarray(0, 2).toString() === 'PK' && buf.length > 2000, { status: dl.status, len: buf.length });
  check('le destinataire est notifié', JSON.stringify((await call('GET', '/notifications', J(lect.t))).body).includes('report_ready'));
  check('liste des rapports : le destinataire voit le sien', (await call('GET', '/report-runs', J(lect.t))).body.length === 1);
  const other = await (async () => { const email = `autre.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: 'Autre', password: pw, role_id: rRep.id } })).body; return login(email, pw); })();
  check('un autre lecteur ne télécharge pas ce rapport', (await fetch(API + `/report-runs/${run1.body.id}/download`, { headers: { authorization: `Bearer ${other}`, 'x-organization-id': org.id } })).status === 404);
  check('suppression de la programmation', (await call('DELETE', `/report-schedules/${sch.body.id}`, J(t0))).status === 200);

  console.log('Notifications poussées');
  const pt = await call('POST', '/me/push-token', { token: lect.t.slice(-30) + 'GOODTOKEN0001', body: undefined });
  check('jeton sans session refusé', pt.status === 401);
  const good = 'GOODTOKEN-' + run + '-aaaaaaaaaaaaaaaa', stale = 'UNREG-' + run + '-aaaaaaaaaaaaaaaaaaa';
  const r1 = await call('POST', '/me/push-token', { token: lect.t, body: { token: good, device_label: 'Tecno' } });
  const r2 = await call('POST', '/me/push-token', { token: lect.t, body: { token: stale } });
  check('jetons enregistrés', r1.status === 201 && r2.status === 201, r1.body);
  if (!r1.body.push_enabled) { console.log('  (poussée non activée sur le serveur : bloc ignoré)'); fcm.close(); console.log(`\n${ok} réussis, ${ko} échoués`); process.exit(ko ? 1 : 0); }
  const sch2 = await call('POST', '/report-schedules', { ...J(t0), body: { report: 'finance', frequency: 'daily', hour: 0, recipients: [lect.id] } });
  await call('POST', `/report-schedules/${sch2.body.id}/run`, J(t0));
  for (let i = 0; i < 12 && !sent.length; i++) await wait(500);
  const m = sent.find((x) => x.token === good);
  check('le message arrive sur l\'appareil valide, avec titre et données', !!m && /Rapport/.test(m.notification.title) && m.data.kind === 'report_ready' && m.data.org_id === org.id, sent);
  await wait(1500);
  const revoked = require('child_process').execSync(`psql "postgres://pgtest@/agritrace?host=/tmp&port=5439" -Atqc "SELECT count(*) FROM push_tokens WHERE token = '${stale}' AND revoked_at IS NOT NULL"`).toString().trim();
  check('jeton périmé révoqué par le serveur', revoked === '1', revoked);
  const again = sent.filter((x) => x.token === good).length;
  await wait(2500);
  check('pas de renvoi de la même notification', sent.filter((x) => x.token === good).length === again, sent.length);
  check('retrait du jeton', (await call('DELETE', '/me/push-token', { token: lect.t, body: { token: good } })).status === 204);

  fcm.close();
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})();
