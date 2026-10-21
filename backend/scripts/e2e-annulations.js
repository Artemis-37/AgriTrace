// Test de bout en bout : reçus imprimables et demandes d'annulation approuvées par un responsable.
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
const pw = 'MotDePasseSolide2026!';
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'AN' + run, name: 'AN' + run } })).body;
  const mail = `an.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
  const t0 = await login(mail, pw);
  const J = (t) => ({ token: t, org: org.id });
  const roles = (await call('GET', '/roles', J(t0))).body;
  const role = async (code, permissions) => (roles.find?.((r) => r.code === code) ?? (await call('POST', '/roles', { ...J(t0), body: { code, name: code, permissions } })).body);
  const rCol = await role('collecteur', ['convoys:create', 'convoys:read', 'sync:use', 'collector:stock', 'producers:read']);
  const rMag = await role('magasinier', ['convoys:receive', 'convoys:read', 'warehouses:read', 'stock:move', 'lots:read', 'cancellations:request', 'sync:use']);
  const rCai = await role('caissier', ['convoys:settle', 'convoys:read', 'finance:read', 'cash:operate', 'cancellations:request', 'sync:use']);
  const rCpt = await role('comptable', ['accounting:read', 'accounting:post', 'finance:read', 'cancellations:request', 'sync:use']);
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email, pw) }; };
  const col = await user('collect', rCol), mag = await user('magas', rMag), cai = await user('caiss', rCai), cpt = await user('compt', rCpt), cai2 = await user('caiss2', rCai);
  const collector = (await call('POST', '/collectors', { ...J(t0), body: { user_id: col.id } })).body;
  const wh = (await call('POST', '/warehouses', { ...J(t0), body: { code: 'MC', name: 'Magasin central' } })).body;
  check('mise en place', !!(collector.id && wh.id && mag.t && cpt.t));

  const mkConvoy = async (no, kg) => {
    await call('POST', '/convoys', { ...J(col.t), body: { idempotency_key: key('cv'), convoy_no: no, driver_name: 'Koffi', truck_no: 'AB 1' } });
    return (await call('POST', '/convoys/receive', { ...J(mag.t), body: { idempotency_key: key('rc'), collector_id: collector.id, convoy_no: no, warehouse_id: wh.id, total_kg: kg, bags: 10 } })).body;
  };

  console.log('Reçus imprimables');
  const r1 = await mkConvoy('AN-001', '1000');
  const mine = await call('GET', '/my-operations', J(mag.t));
  check('le magasinier retrouve sa réception', mine.status === 200 && mine.body.some((x) => x.entity_type === 'convoy_reception' && x.entity_id === r1.id && x.cancellable), mine.body);
  check('le collecteur n\'a pas accès aux opérations', (await call('GET', '/my-operations', J(col.t))).status === 403);
  const p1 = await call('GET', `/operation-receipts/convoy_reception/${r1.id}`, J(mag.t));
  check('bon de réception : titre, lignes, opérateur', p1.status === 200 && p1.body.title.includes('réception') && p1.body.lines.length >= 6 && p1.body.operator === 'magas' && p1.body.duplicate === false, p1.body);
  const p2 = await call('GET', `/operation-receipts/convoy_reception/${r1.id}`, J(mag.t));
  check('deuxième impression : duplicata n°2', p2.body.duplicate === true && p2.body.copy_no === 2, p2.body);
  check('type inconnu refusé', (await call('GET', `/operation-receipts/xxx/${r1.id}`, J(mag.t))).status === 400);
  check('le magasinier ne peut pas imprimer un règlement', (await call('GET', `/operation-receipts/convoy_settlement/${r1.id}`, J(mag.t))).status === 403);

  console.log('Annulation d\'une réception (non réglée)');
  const bad = await call('POST', '/cancellation-requests', { ...J(mag.t), body: { entity_type: 'convoy_reception', entity_id: r1.id, reason: 'x' } });
  check('motif trop court refusé', bad.status === 400);
  check('la caissière ne peut pas demander l\'annulation d\'une réception', (await call('POST', '/cancellation-requests', { ...J(cai.t), body: { entity_type: 'convoy_reception', entity_id: r1.id, reason: 'Erreur de pesée' } })).status === 403);
  const q1 = await call('POST', '/cancellation-requests', { ...J(mag.t), body: { entity_type: 'convoy_reception', entity_id: r1.id, reason: 'Erreur de pesée à la réception' } });
  check('demande créée en attente', q1.status === 201 && q1.body.status === 'pending', q1.body);
  check('deuxième demande sur la même opération refusée', (await call('POST', '/cancellation-requests', { ...J(mag.t), body: { entity_type: 'convoy_reception', entity_id: r1.id, reason: 'Encore une fois' } })).status === 409);
  const nt = await call('GET', '/notifications', J(t0));
  check('l\'administrateur est notifié', JSON.stringify(nt.body).includes('cancellation_request'), nt.body);
  check('le demandeur ne peut pas approuver', (await call('POST', `/cancellation-requests/${q1.body.id}/decide`, { ...J(mag.t), body: { decision: 'approve' } })).status === 403);
  check('le magasinier ne voit que ses demandes', (await call('GET', '/cancellation-requests', J(mag.t))).body.length === 1 && (await call('GET', '/cancellation-requests', J(cai.t))).body.length === 0);
  const ap1 = await call('POST', `/cancellation-requests/${q1.body.id}/decide`, { ...J(t0), body: { decision: 'approve' } });
  check('approbation par l\'administrateur', ap1.status === 201 && ap1.body.status === 'approved', ap1.body);
  check('réception supprimée, convoi de nouveau attendu', (await call('GET', `/convoys/expected?collector_id=${collector.id}`, J(mag.t))).body.some((c) => c.convoy_no === 'AN-001'));
  check('déjà décidée : 409', (await call('POST', `/cancellation-requests/${q1.body.id}/decide`, { ...J(t0), body: { decision: 'approve' } })).status === 409);
  check('le demandeur est notifié de la décision', JSON.stringify((await call('GET', '/notifications', J(mag.t))).body).includes('cancellation_decided'));

  console.log('Règlement puis annulation du règlement');
  const r2 = await mkConvoy('AN-002', '1000');
  const s = await call('POST', `/convoy-receptions/${r2.id}/settle`, { ...J(cai.t), body: { idempotency_key: key('st'), unit_price: '1000' } });
  check('règlement', s.status === 201 && s.body.status === 'settled', s.body);
  const rc = await call('GET', `/operation-receipts/convoy_settlement/${r2.id}`, J(cai.t));
  check('reçu de règlement avec net payé', rc.status === 200 && rc.body.lines.some((l) => l.label === 'Net payé' && Number(l.value) === 1000000), rc.body);
  const mq = await call('POST', '/cancellation-requests', { ...J(mag.t), body: { entity_type: 'convoy_reception', entity_id: r2.id, reason: 'Je veux annuler' } });
  check('réception réglée : annulation à passer par la caisse', mq.status === 409, mq.body);
  const q2 = await call('POST', '/cancellation-requests', { ...J(cai.t), body: { entity_type: 'convoy_settlement', entity_id: r2.id, reason: 'Mauvais prix saisi' } });
  check('demande d\'annulation du règlement', q2.status === 201, q2.body);
  const ap2 = await call('POST', `/cancellation-requests/${q2.body.id}/decide`, { ...J(t0), body: { decision: 'approve' } });
  check('approbation : règlement annulé', ap2.status === 201, ap2.body);
  const accs = (await call('GET', '/financial-accounts', J(cai.t))).body;
  const acc = accs.find((a) => a.owner_type === 'collector');
  check('compte du collecteur remis à zéro', Number(acc.balance) === 0, acc);
  check('la réception revient dans la file de la caisse', (await call('GET', '/convoys/cashier-queue', J(cai.t))).body.some((x) => x.id === r2.id));
  const s3 = await call('POST', `/convoy-receptions/${r2.id}/settle`, { ...J(cai.t), body: { idempotency_key: key('st'), unit_price: '1200' } });
  check('nouveau règlement au bon prix', s3.status === 201 && Number(s3.body.amount) === 1200000, s3.body);
  check('compte du collecteur recrédité', Number((await call('GET', '/financial-accounts', J(cai.t))).body.find((a) => a.owner_type === 'collector').balance) === 1200000);

  console.log('Refus et opérations non annulables');
  const q3 = await call('POST', '/cancellation-requests', { ...J(cai.t), body: { entity_type: 'convoy_settlement', entity_id: r2.id, reason: 'Test de refus' } });
  check('refus sans motif : 400', (await call('POST', `/cancellation-requests/${q3.body.id}/decide`, { ...J(t0), body: { decision: 'reject' } })).status === 400);
  const rj = await call('POST', `/cancellation-requests/${q3.body.id}/decide`, { ...J(t0), body: { decision: 'reject', note: 'Prix correct' } });
  check('refus motivé', rj.status === 201 && rj.body.status === 'rejected', rj.body);
  check('le règlement reste en vigueur', Number((await call('GET', '/financial-accounts', J(cai.t))).body.find((a) => a.owner_type === 'collector').balance) === 1200000);
  check('seul un responsable décide', (await call('POST', `/cancellation-requests/${q3.body.id}/decide`, { ...J(cai2.t), body: { decision: 'approve' } })).status === 403);
  const txs = (await call('GET', `/financial-accounts/${acc.id}/transactions`, J(cai.t))).body;
  const rev = txs.find((t) => t.reversal_of);
  check('une écriture compensatoire ne peut pas être annulée', rev && (await call('POST', '/cancellation-requests', { ...J(cai.t), body: { entity_type: 'financial_transaction', entity_id: rev.id, reason: 'Annuler une annulation' } })).status === 409, rev);
  const lied = txs.find((t) => !t.reversal_of && t.reference_type === 'convoy_reception');
  check('écriture liée à un règlement : à annuler via le règlement', lied && (await call('POST', '/cancellation-requests', { ...J(cai.t), body: { entity_type: 'financial_transaction', entity_id: lied.id, reason: 'Je tente directement' } })).status === 409, lied);

  console.log('Comptable : écriture manuelle');
  const en = await call('POST', '/accounting/entries', { ...J(cpt.t), body: { idempotency_key: key('en'), journal: 'OD', entry_date: new Date().toISOString().slice(0, 10), label: 'Régularisation test', lines: [{ code: '601', debit: '500' }, { code: '571', credit: '500' }] } });
  check('écriture manuelle passée', en.status === 201, en.body);
  const myc = await call('GET', '/my-operations', J(cpt.t));
  check('le comptable retrouve son écriture', myc.body.some((x) => x.entity_type === 'accounting_entry' && x.entity_id === en.body.id && x.cancellable), myc.body);
  const pe = await call('GET', `/operation-receipts/accounting_entry/${en.body.id}`, J(cpt.t));
  check('pièce comptable imprimable avec lignes débit/crédit', pe.status === 200 && pe.body.lines.some((l) => l.value.startsWith('Débit')) && pe.body.lines.some((l) => l.value.startsWith('Crédit')), pe.body);
  const q4 = await call('POST', '/cancellation-requests', { ...J(cpt.t), body: { entity_type: 'accounting_entry', entity_id: en.body.id, reason: 'Mauvais compte utilisé' } });
  const ap4 = await call('POST', `/cancellation-requests/${q4.body.id}/decide`, { ...J(t0), body: { decision: 'approve' } });
  check('écriture inversée après approbation', ap4.status === 201 && /EC-/.test(ap4.body.summary), ap4.body);
  check('l\'écriture ne peut plus être annulée', (await call('POST', '/cancellation-requests', { ...J(cpt.t), body: { entity_type: 'accounting_entry', entity_id: en.body.id, reason: 'Encore une fois' } })).status === 409);

  console.log('Magasinier : mouvement de stock manuel');
  const { execSync } = require('child_process');
  const dbu = process.env.DATABASE_URL_ADMIN || 'postgres://pgtest@/agritrace?host=/tmp&port=5439';
  let lotId = null;
  try {
    const sql = `WITH v AS (INSERT INTO value_chains(organization_id, code, name) VALUES ('${org.id}','CA','Cacao') RETURNING id),
      c AS (INSERT INTO campaigns(organization_id, value_chain_id, code, name, starts_on, ends_on) SELECT '${org.id}', id, 'C1', 'C1', '2026-01-01', '2026-12-31' FROM v RETURNING id, value_chain_id)
      INSERT INTO lots(organization_id, code, value_chain_id, campaign_id) SELECT '${org.id}', 'LOT-AN-${run}', value_chain_id, id FROM c RETURNING id`;
    lotId = execSync(`psql "${dbu}" -Atqc "${sql.replace(/\n/g, ' ')}"`).toString().trim().split('\n')[0];
  } catch (e) { /* base inaccessible : bloc ignoré */ }
  if (lotId) {
    const mv = await call('POST', '/warehouse-movements', { ...J(t0), body: { idempotency_key: key('mv'), warehouse_id: wh.id, lot_id: lotId, type: 'entry', quantity_kg: '300', reason: 'Entrée de régularisation' } });
    check('mouvement d\'entrée créé', mv.status === 201, mv.body);
    if (mv.status === 201) {
      const bon = await call('GET', `/operation-receipts/warehouse_movement/${mv.body.id}`, J(t0));
      check('bon de mouvement imprimable', bon.status === 200 && bon.body.lines.some((l) => l.label === 'Quantité'), bon.body);
      const qm = await call('POST', '/cancellation-requests', { ...J(mag.t), body: { entity_type: 'warehouse_movement', entity_id: mv.body.id, reason: 'Saisi par erreur' } });
      const am = await call('POST', `/cancellation-requests/${qm.body.id}/decide`, { ...J(cai.t), body: { decision: 'approve' } });
      check('un caissier sans droit d\'approuver ne peut pas décider', am.status === 403);
      const aTwo = await call('POST', `/cancellation-requests/${qm.body.id}/decide`, { ...J(t0), body: { decision: 'approve' } });
      check('approbation : mouvement d\'annulation créé', aTwo.status === 201 && /MV-/.test(aTwo.body.summary), aTwo.body);
      check('mouvement déjà annulé : nouvelle demande refusée', (await call('POST', '/cancellation-requests', { ...J(mag.t), body: { entity_type: 'warehouse_movement', entity_id: mv.body.id, reason: 'Encore' } })).status === 409);
    }
  } else console.log('  (bloc stock ignoré : base non accessible)');

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})();
