/* Comptes bancaires : n° de compte et solde initial. */
const API = process.env.API; let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 200) : ''); } };
async function call(m, p, { token, org, body } = {}) { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body && JSON.stringify(body) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; }
(async () => {
  const run = Math.random().toString(36).slice(2, 7).toUpperCase(); const pw = 'Test-Banque-2026!';
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).body.access_token;
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'CB' + run, name: 'CB' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `cb.${run}@t.test`, full_name: 'Chef', password: pw } });
  const A = { token: (await call('POST', '/auth/login', { body: { email: `cb.${run}@t.test`, password: pw } })).body.access_token, org: org.id };
  const r = await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'SGBCI 0123', bank_name: 'SGBCI', account_number: 'CI0123456789', opening_balance: '2500000' } });
  check('compte créé avec banque, n° et solde initial', r.status < 300 && r.body.account_number === 'CI0123456789' && r.body.bank_name === 'SGBCI', r.body);
  const l = (await call('GET', '/financial-accounts', A)).body.find((a) => a.id === r.body.id);
  check('le solde initial est le solde du compte', Number(l?.balance) === 2500000 && l.account_number === 'CI0123456789', l);
  const tx = await call('GET', `/financial-accounts/${r.body.id}/transactions`, A);
  check('l\'entrée « Solde initial » est tracée', JSON.stringify(tx.body).includes('Solde initial'), tx.body);
  const r2 = await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'Sans solde' } });
  check('sans solde initial : compte à zéro', Number((await call('GET', '/financial-accounts', A)).body.find((a) => a.id === r2.body.id).balance) === 0);
  check('solde initial négatif refusé', (await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'Neg', opening_balance: '-5' } })).status === 400);
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
