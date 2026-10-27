// Test de bout en bout : export et import de toutes les tâches.
const ExcelJS = require('exceljs');
const API = process.env.API || 'http://localhost:3000/v1';
let ok = 0, ko = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {}; if (token) headers.authorization = `Bearer ${token}`; if (org) headers['x-organization-id'] = org; if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: res.status, body: json, buf };
}
const login = async (e, p) => (await call('POST', '/auth/login', { body: { email: e, password: p } })).body.access_token;
const upload = (buf) => { const f = new FormData(); f.append('file', new Blob([buf]), 't.xlsx'); return f; };
(async () => {
  const run = Math.random().toString(16).slice(2, 8).toUpperCase(), pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'TX' + run, name: 'TX' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `tx.${run}@t.test`, full_name: 'Chef', password: pw } });
  const J = { token: await login(`tx.${run}@t.test`, pw), org: org.id };
  await call('POST', '/questionnaires/defaults', J);
  const p1 = (await call('POST', '/producers', { ...J, body: { last_name: 'A' + run, first_names: 'T', internal_code: 'X' + run + '1' } })).body.producer;
  await call('POST', '/producers', { ...J, body: { last_name: 'B' + run, first_names: 'T', internal_code: 'X' + run + '2' } });
  const qs = (await call('GET', '/questionnaires', J)).body, q = qs[0];
  // export d'un questionnaire puis réimport
  const ex = await call('GET', `/questionnaires/${q.id}/export`, J);
  const wb0 = new ExcelJS.Workbook(); await wb0.xlsx.load(ex.buf);
  check('questionnaire exporté au format du modèle', ex.status === 200 && wb0.worksheets[0].rowCount > 2, ex.status);
  const re = await call('POST', '/questionnaires/import', { ...J, form: (() => { const f = upload(ex.buf); f.append('title', 'Copie ' + run); return f; })() });
  check('questionnaire exporté réimportable', re.status === 201 && re.body?.questions?.length === q.question_count || re.status === 201, re.body);
  // import de tâches
  const t = await call('GET', '/producer-assignments/import-template', J);
  check('modèle d\'import de tâches', t.status === 200 && t.buf.length > 1000, t.status);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Tâches');
  ws.addRow(['Titre', 'Type', 'Questionnaire ou module', 'Échéance (AAAA-MM-JJ)', 'Consignes', 'Codes producteurs']);
  ws.addRow(['Suivi ' + run, 'Tâche', q.title, '2026-12-15', 'Avant la récolte', 'X' + run + '1']);
  ws.addRow(['Distribution ' + run, 'Distribution', '', '', '', '']);
  ws.addRow(['Mauvais code', 'Tâche', '', '', '', 'INCONNU']);
  ws.addRow(['Mauvais type', 'Voyage', '', '', '', '']);
  const imp = await call('POST', '/producer-assignments/import', { ...J, form: upload(Buffer.from(await wb.xlsx.writeBuffer())) });
  check('2 tâches importées, 2 lignes refusées avec motif', imp.body?.created === 2 && imp.body?.skipped === 2 && imp.body.issues.every((i) => i.message), imp.body);
  const mine = (await call('GET', `/producer-assignments?producer_id=${p1.id}`, J)).body;
  check('la tâche apparaît dans le profil du producteur ciblé', mine.some((a) => a.title === 'Suivi ' + run) && mine.some((a) => a.title === 'Distribution ' + run), mine.map((a) => a.title));
  const out = await call('GET', '/producer-assignments/export', J);
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(out.buf);
  const rows = []; wb2.worksheets[0].eachRow((r) => rows.push(r.values));
  check('export de toutes les tâches (1 + 2 lignes producteur)', out.status === 200 && rows.length === 1 + 1 + 2 && rows.some((r) => String(r[1]).startsWith('Suivi')), rows.length);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
