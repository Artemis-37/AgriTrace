// Test de bout en bout : le modèle d'import des producteurs (nouvelles colonnes Quartier, Lieu, naissance, pièce d'identité).
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
const upload = (buf) => { const f = new FormData(); f.append('file', new Blob([buf]), 'p.xlsx'); return f; };
(async () => {
  const run = Math.random().toString(16).slice(2, 8).toUpperCase(), pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'IM' + run, name: 'IM' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `im.${run}@t.test`, full_name: 'Chef', password: pw } });
  const J = { token: await login(`im.${run}@t.test`, pw), org: org.id };
  const t = await call('GET', '/producers/imports/template', J);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.buf);
  const ws = wb.getWorksheet('Producteurs');
  const head = ws.getRow(1).values.slice(1);
  check('modèle : colonnes Département et Sous-préfecture', head.includes('Département') && head.includes('Sous-préfecture') && !head.includes('Village'), head);
  check("modèle : naissance et pièce d'identité", head.includes('Date de naissance') && head.includes("Type de pièce d'identité") && head.includes("Numéro de la pièce d'identité"), head);
  check('modèle : feuille Instructions', !!wb.getWorksheet('Instructions'));
  ws.getRow(2).getCell(head.indexOf('Nom') + 1).value = 'TRAORE';
  ws.getRow(2).getCell(head.indexOf('Téléphone') + 1).value = '0707070707';
  ws.getRow(2).getCell(head.indexOf('Filières') + 1).value = null; // la coopérative de test n'a pas de filière CACAO
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await call('POST', '/producers/imports?confirm=true', { ...J, form: upload(buf) });
  check('import du modèle rempli accepté', r.body?.created === 1 && r.body?.skipped === 0, r.body?.issues);
  const list = (await call('GET', '/producers', J)).body;
  const p = (Array.isArray(list) ? list : list.items ?? [])[0];
  check('ville et sous-préfecture enregistrées', p?.department === 'Daloa' && p?.village === 'Zoukougbeu', p);
  const one = (await call('GET', `/producers/${p.id}`, J)).body; const q = one.producer ?? one;
  check('naissance et pièce enregistrées', String(q.birth_date).startsWith('1985-03-14') && q.id_doc_type === 'CNI ivoirienne' && q.id_doc_number === 'C0012345678', q);
  const w2 = new ExcelJS.Workbook(); const s2 = w2.addWorksheet('P');
  s2.addRow(['Nom', 'Prénoms', 'Département', 'Village']); s2.addRow(['DIALLO', 'Sékou', 'Hiré', 'Zaroko']);
  const r2 = await call('POST', '/producers/imports?confirm=true', { ...J, form: upload(Buffer.from(await w2.xlsx.writeBuffer())) });
  check('ancien fichier (Département, Village) encore accepté', r2.body?.created === 1 && r2.body?.mapping?.department === 'Département', r2.body);
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
