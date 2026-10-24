/* Fiche d'accompagnement : producteurs d'un convoi / d'un chargement, export Excel (modèle), import d'une fiche, transmission à l'exportateur. Utilise la démo (seed-demo-complet). */
const fs = require('fs'); const ExcelJS = require('exceljs');
const API = process.env.API; const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 240) : ''); } };
async function call(m, p, { token, body, form, raw } = {}) {
  const r = await fetch(API + p, { method: m, headers: { ...(!form && body && { 'content-type': 'application/json' }), ...(token && { authorization: 'Bearer ' + token, 'x-organization-id': demo.org }) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b };
}
const login = async (role) => (await call('POST', '/auth/login', { body: { email: demo.accounts.find((a) => a.role === role).email, password: demo.password } })).body.access_token;
(async () => {
  const T = await login('responsable_tracabilite'), X = await login('exportateur'), M = await login('magasinier'), C = await login('caissier');
  const convs = (await call('GET', '/dispatch-sheets/convoys', { token: T })).body;
  check('le responsable de traçabilité liste les convois pesés', Array.isArray(convs) && convs.length > 0, convs);
  const cv = convs.find((c) => c.producers > 0);
  check('un convoi porte au moins un producteur', !!cv, convs.slice(0, 2));
  check('le magasinier et le caissier n\'ont pas accès', (await call('GET', '/dispatch-sheets/convoys', { token: M })).status === 403 && (await call('GET', '/dispatch-sheets', { token: C })).status === 403);
  const one = await call('GET', `/convoys/${cv.id}/fiche-accompagnement`, { token: T });
  const L = one.body.lines ?? [];
  check('consultation : producteurs du convoi (nom, section, code, poids, sacs)', one.status === 200 && L.length === cv.producers && L.every((l) => l.name && l.code && l.kg > 0), one.body);
  check('total des poids = poids net pesé au magasin', Math.abs(one.body.total_kg - Number(cv.net_kg)) < 0.002, { t: one.body.total_kg, net: cv.net_kg });
  const x1 = await call('GET', `/convoys/${cv.id}/fiche-accompagnement.xlsx`, { token: T, raw: true });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x1.buf); const ws = wb.worksheets[0];
  check('export Excel du convoi : modèle conservé, 1re ligne remplie', x1.status === 200 && /ACCOMPAGNEMENT/i.test(String(ws.getCell('E1').value)) && String(ws.getCell('C18').value) === L[0].name && String(ws.getCell('F18').value) === L[0].code, { c: ws.getCell('C18').value });
  check('en-tête : coopérative, chauffeur, camion, connaissement', !!ws.getCell('D3').value && !!ws.getCell('D4').value && String(ws.getCell('D13').value) === cv.convoy_no, { d3: ws.getCell('D3').value, d13: ws.getCell('D13').value });
  check('aucun nom de coopérative ni « ID FT USA » dans le modèle', !JSON.stringify(ws.getSheetValues()).match(/socahi|outspan|ID FT USA/i));
  // chargement = plusieurs convois
  const ids = convs.filter((c) => c.producers > 0).slice(0, 2).map((c) => c.id);
  const mk = await call('POST', '/dispatch-sheets', { token: T, body: { convoy_ids: ids, lot_id_dse: 'DSE-TEST-1', bl_no: 'BL-2026-77', departure_date: '2026-10-25', cocoa_type: 'certifie', certifications: ['Rainforest Alliance', 'UTZ'], adg_name: 'Nom ADG', warehouse_keeper_name: 'Nom Magasinier' } });
  check('création d\'une fiche de chargement (numéro FA-aaaa-nnnnn)', mk.status === 201 && /^FA-\d{4}-\d{5}$/.test(mk.body.number), mk.body);
  const sid = mk.body.id;
  const det = (await call('GET', `/dispatch-sheets/${sid}`, { token: T })).body;
  check('fiche : producteurs de tous les convois, poids total cohérent', det.lines.length === convs.filter((c) => ids.includes(c.id)).reduce((a, c) => a + c.producers, 0) && Math.abs(Number(det.declared_kg) - det.lines.reduce((a, l) => a + l.kg, 0)) < 0.002, { n: det.lines.length, kg: det.declared_kg });
  const x2 = await call('GET', `/dispatch-sheets/${sid}/export`, { token: T, raw: true });
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(x2.buf); const w2 = wb2.worksheets[0];
  const marks = ['J5', 'J6', 'J7', 'J8', 'J9', 'J10', 'J11', 'J12', 'J13'].map((a) => String(w2.getCell(a).value ?? ''));
  check('export : certifications cochées (UTZ, Rainforest Alliance) et Atsource décoché', marks[2] === 'X' && marks[5] === 'X' && marks[7] === '' && String(w2.getCell('D12').value) === 'DSE-TEST-1', marks);
  check('export : total en pied et signatures', Math.abs(Number(w2.getCell('H344').value?.result ?? w2.getCell('H344').value) - Number(det.declared_kg)) < 0.002 && String(w2.getCell('B346').value) === 'Nom ADG', { h: w2.getCell('H344').value });
  // import d'une fiche remplie (ici : celle qu'on vient d'exporter, modifiée)
  w2.getCell('D13').value = 'BL-IMPORT-9'; w2.getCell('C19').value = 'NOUVEAU PLANTEUR'; w2.getCell('F19').value = 'ZZ-INCONNU'; w2.getCell('H19').value = 120; w2.getCell('I19').value = 2;
  const edited = Buffer.from(await wb2.xlsx.writeBuffer()); const fd = new FormData(); fd.append('file', new Blob([edited]), 'fiche-remplie.xlsx');
  const imp = await call('POST', '/dispatch-sheets/import', { token: T, form: fd });
  check('import : fiche lue, numéro attribué, source « imported »', imp.status === 201 && imp.body.sheet.source === 'imported' && imp.body.sheet.bl_no === 'BL-IMPORT-9' && imp.body.sheet.has_file, imp.body);
  check('import : avertissement sur le code planteur absent du registre', (imp.body.warnings ?? []).some((w) => /ZZ-INCONNU/.test(w)), imp.body.warnings);
  const bad = new FormData(); bad.append('file', new Blob([Buffer.from('pas un xlsx')]), 'x.xlsx');
  check('import : fichier invalide refusé', (await call('POST', '/dispatch-sheets/import', { token: T, form: bad })).status === 400);
  const wb3 = new ExcelJS.Workbook(); wb3.addWorksheet('A').addRow(['autre']); const fd3 = new FormData(); fd3.append('file', new Blob([Buffer.from(await wb3.xlsx.writeBuffer())]), 'autre.xlsx');
  check('import : classeur sans le titre de la fiche refusé', (await call('POST', '/dispatch-sheets/import', { token: T, form: fd3 })).status === 400);
  const dl = await call('GET', `/dispatch-sheets/${imp.body.sheet.id}/export`, { token: T, raw: true });
  check('une fiche importée est restituée telle quelle (fichier d\'origine)', dl.buf.equals(edited));
  // transmission à l'exportateur
  const exps = (await call('GET', '/dispatch-sheets/exporters', { token: T })).body;
  check('liste des comptes exportateurs destinataires', Array.isArray(exps) && exps.length >= 1, exps);
  check('avant transmission, l\'exportateur ne voit rien', ((await call('GET', '/dispatch-sheets', { token: X })).body ?? []).length === 0 && (await call('GET', `/dispatch-sheets/${sid}`, { token: X })).status === 404);
  const tr = await call('POST', `/dispatch-sheets/${sid}/transmit`, { token: T, body: { exporter_user_id: exps[0].id } });
  check('transmission à l\'exportateur', tr.status === 201 && tr.body.status === 'transmitted' && tr.body.exporter_name, tr.body);
  check('deuxième transmission refusée', (await call('POST', `/dispatch-sheets/${sid}/transmit`, { token: T, body: { exporter_user_id: exps[0].id } })).status === 409);
  const lx = (await call('GET', '/dispatch-sheets', { token: X })).body;
  check('l\'exportateur voit la fiche transmise (et elle seule)', lx.length === 1 && lx[0].id === sid, lx);
  const xd = await call('GET', `/dispatch-sheets/${sid}/export`, { token: X, raw: true });
  check('l\'exportateur télécharge le fichier Excel', xd.status === 200 && xd.buf.length > 5000);
  check('l\'exportateur ne peut pas créer ni transmettre', (await call('POST', '/dispatch-sheets', { token: X, body: { convoy_ids: ids } })).status === 403);
  check('un convoi déjà sur une fiche transmise ne peut plus être repris', (await call('POST', '/dispatch-sheets', { token: T, body: { convoy_ids: ids } })).status === 409);
  const notes = (await call('GET', '/notifications', { token: X })).body; check('l\'exportateur est notifié', JSON.stringify(notes).includes('Fiche d'+"'"+'accompagnement'), notes);
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
