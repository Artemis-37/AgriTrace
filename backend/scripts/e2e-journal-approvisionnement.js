/* Type de prélèvement du délégué et journal d'approvisionnement. */
const API = process.env.API; let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 220) : ''); } };
async function call(m, p, { token, org, body } = {}) { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body && JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; }
(async () => {
  const run = Math.random().toString(36).slice(2, 7).toUpperCase(); const pw = 'Test-Journal-2026!';
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'JA' + run, name: 'JA' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `ja.${run}@t.test`, full_name: 'Chef', password: pw } });
  const login = async (e) => (await call('POST', '/auth/login', { body: { email: e, password: pw } })).body.access_token;
  const A = { token: await login(`ja.${run}@t.test`), org: org.id };
  const role = async (code, permissions) => (await call('POST', '/roles', { ...A, body: { code, name: code, permissions } })).body;
  const rCol = await role('collecteur', ['convoys:create', 'convoys:read', 'sync:use', 'collector:stock', 'producers:read']);
  const rMag = await role('magasinier', ['convoys:receive', 'convoys:read', 'sync:use']);
  const rCai = await role('caissier', ['convoys:settle', 'convoys:read', 'finance:read', 'cash:operate']);
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...A, body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { ...u, t: await login(email) }; };
  const c1 = await user('kouame', rCol), mag = await user('magasinier', rMag), cai = await user('caissier', rCai);
  const col = (await call('POST', '/collectors', { ...A, body: { user_id: c1.id } })).body;
  const wh = (await call('POST', '/warehouses', { ...A, body: { code: 'MJ', name: 'Magasin' } })).body;
  const J = (t) => ({ token: t, org: org.id });
  check('le caissier ne peut pas fixer le type de prélèvement', (await call('PUT', `/collectors/${col.id}/rates`, { ...J(cai.t), body: { retention_type: 'epargne' } })).status === 403);
  check('type inconnu refusé', (await call('PUT', `/collectors/${col.id}/rates`, { ...A, body: { retention_type: 'autre' } })).status === 400);
  const rt = await call('PUT', `/collectors/${col.id}/rates`, { ...A, body: { transport_per_kg: '0', retention_per_kg: '10', retention_type: 'epargne' } });
  check('l\'administrateur fixe retenue 10 de type épargne', rt.status < 300 && rt.body.retention_type === 'epargne', rt.body);
  await call('POST', '/convoys', { ...J(c1.t), body: { idempotency_key: 'cv-' + run + '-1', convoy_no: 'JA-001', driver_name: 'Ko', truck_no: 'AB 1' } });
  const rec = await call('POST', '/convoys/receive', { ...J(mag.t), body: { idempotency_key: 'rc-' + run + '-1', collector_id: col.id, convoy_no: 'JA-001', warehouse_id: wh.id, total_kg: '1000', bags: 15 } });
  check('réception enregistrée', rec.status === 201, rec.body);
  const st = await call('POST', `/convoy-receptions/${rec.body.id}/settle`, { ...A, body: { idempotency_key: 'st-' + run + '-1', unit_price: '1000' } });
  check('règlement : retenue 10 000 conservant le type épargne', st.status < 300 && st.body.retention_type === 'epargne' && Number(st.body.retention_amount) === 10000, st.body);
  const jr = await call('GET', '/reports/supply', A);
  check('journal : 1 réception, 1 000 kg, 15 sacs', jr.status === 200 && jr.body.total.receptions === 1 && jr.body.total.kg === 1000 && jr.body.total.bags === 15, jr.body);
  check('journal : retenue par type (épargne 10 000)', jr.body.retention_by_type?.epargne === 10000 && jr.body.by_collector.length === 1, jr.body);
  check('journal : net payé = 1 000 000 − 10 000', jr.body.total.net_paid === 990000, jr.body.total);
  check('journal : filtre de période hors plage → vide', (await call('GET', '/reports/supply?from=2000-01-01&to=2000-01-31', A)).body.total.receptions === 0);
  check('le magasinier ne voit pas les rapports', (await call('GET', '/reports/supply', J(mag.t))).status === 403);
  const x = await fetch(API + '/reports/supply/xlsx', { headers: { authorization: 'Bearer ' + A.token, 'x-organization-id': org.id } });
  check('export Excel du journal', x.status === 200 && (x.headers.get('content-type') ?? '').includes('spreadsheetml'));
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
