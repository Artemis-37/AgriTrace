/* Déclarations d'achat : informations du producteur issues de la base importée (code, nom, section, village, téléphone, superficie, estimation). */
const API = process.env.API; let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 220) : ''); } };
async function call(m, p, { token, org, body, form } = {}) { const r = await fetch(API + p, { method: m, headers: { ...(!form && { 'content-type': 'application/json' }), ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: form ?? (body && JSON.stringify(body)) }); return { status: r.status, body: await r.json().catch(() => null) }; }
(async () => {
  const run = Math.random().toString(36).slice(2, 7).toUpperCase(); const pw = 'Test-Decl-2026!';
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'DP' + run, name: 'DP' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `dp.${run}@t.test`, full_name: 'Chef', password: pw } });
  const A = { token: (await call('POST', '/auth/login', { body: { email: `dp.${run}@t.test`, password: pw } })).body.access_token, org: org.id };
  // import Excel avec superficie et estimation
  const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('P');
  ws.addRow(['Code', 'Nom', 'Prénoms', 'Téléphone', 'Section', 'Village', 'Superficie (ha)', 'Estimation (kg)']);
  ws.addRow(['P-001', 'BAMBA', 'Seydou', '0701020304', 'Hiré', 'Zakoua', '4,5', '3 200']);
  ws.addRow(['P-002', 'ADJE', 'Sylvain', '0701020305', 'Hiré', 'Zakoua', 'abc', '100']);
  const buf = await wb.xlsx.writeBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf]), 'p.xlsx'); 
  const imp = await call('POST', '/producers/imports?confirm=true', { ...A, form: fd });
  check('import : une ligne valide, la ligne à superficie invalide est refusée', imp.status < 300 && imp.body.created === 1 && imp.body.skipped === 1, imp.body);
  const pl = await call('GET', '/producers?q=bamba', A); if (!Array.isArray(pl.body) || !pl.body[0]) console.log('  (liste:', pl.status, JSON.stringify(pl.body).slice(0, 200), ')'); const pr = pl.body[0];
  check('le producteur porte superficie 4,5 ha et estimation 3 200 kg', pr && Number(pr.area_ha) === 4.5 && Number(pr.estimated_kg) === 3200, pr);
  // déclaration d'achat, faite par un délégué affecté
  await call('PUT', '/purchase-declarations/settings/receipts', { ...A, body: { mode: 'physical', series: 'A', required: false } });
  const vc = (await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao', default_unit: 'kg' } })).body;
  const camp = (await call('POST', '/campaigns', { ...A, body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne', starts_on: '2025-10-01', ends_on: '2026-12-31' } })).body;
  const sched = (await call('POST', '/price-schedules', { ...A, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).body;
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...A, body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const role = (await call('POST', '/roles', { ...A, body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'campaigns:read', 'prices:read'] } })).body;
  const col = (await call('POST', '/users', { ...A, body: { email: `col.${run}@t.test`, full_name: 'Collecteur Un', password: pw, role_id: role.id } })).body;
  const collector = (await call('POST', '/collectors', { ...A, body: { user_id: col.id } })).body;
  await call('POST', `/collectors/${collector.id}/assignments`, { ...A, body: { value_chain_id: vc.id } });
  const tc = (await call('POST', '/auth/login', { body: { email: `col.${run}@t.test`, password: pw } })).body.access_token;
  const d = await call('POST', '/purchase-declarations', { token: tc, org: org.id, body: { id: require('crypto').randomUUID(), idempotency_key: 'decl-key-' + run, producer_id: pr.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', bags: 2, quantity: '2', unit: 'sac' } });
  const list = (await call('GET', '/purchase-declarations', A)).body;
  const listCol = (await call('GET', '/purchase-declarations', { token: tc, org: org.id })).body;
  const row = Array.isArray(list) ? list.find((x) => x.producer_id === pr.id) : null;
  if (!row) console.log('  (déclaration non créée:', d.status, JSON.stringify(d.body).slice(0, 200), ')');
  check('la liste porte code, nom, section, village, téléphone', row && row.producer_code === 'P-001' && /BAMBA/.test(row.producer_name) && row.producer_section === 'Hiré' && row.producer_village === 'Zakoua' && row.producer_phone === '0701020304', row);
  check('la liste porte superficie et estimation', row && Number(row.producer_area_ha) === 4.5 && Number(row.producer_estimated_kg) === 3200, row);
  check('le délégué voit aussi les informations du producteur', Array.isArray(listCol) && listCol[0]?.producer_code === 'P-001' && listCol[0]?.producer_village === 'Zakoua', listCol);
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
