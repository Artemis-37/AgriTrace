// Test de bout en bout P2 (synchronisation serveur) + P3 (pesée, réception, stocks, lots, traçabilité).
// Usage : API=http://localhost:3111/v1 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/e2e-p2-p3.js
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;

async function call(method, path, { token, org, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;

(async () => {
  const pw = 'MotDePasseSolide2026!';
  console.log('Mise en place');
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (code) => (await call('POST', '/organizations', { token: adm, body: { code, name: code } })).body;
  const A = await mkOrg('PA' + run), B = await mkOrg('PB' + run);
  for (const [org, mail] of [[A, `a1.${run}@t.test`], [A, `a2.${run}@t.test`], [B, `b1.${run}@t.test`]])
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
  const t1 = await login(`a1.${run}@t.test`, pw), t2 = await login(`a2.${run}@t.test`, pw), tb = await login(`b1.${run}@t.test`, pw);
  const J = (t, o) => ({ token: t, org: o.id });
  await call('PUT', '/purchase-declarations/settings/receipts', { token: t1, org: A.id, body: { mode: 'physical', series: 'A', required: false } }); // ces scénarios ne testent pas le reçu d'achat (voir e2e-recus.js)

  const vc = (await call('POST', '/value-chains', { ...J(t1, A), body: { code: 'CACAO', name: 'Cacao' } })).body;
  await call('POST', '/unit-conversions', { ...J(t1, A), body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = (await call('POST', '/campaigns', { ...J(t1, A), body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne 2025-26', starts_on: '2025-10-01', ends_on: '2026-09-30' } })).body;
  const sched = (await call('POST', '/price-schedules', { ...J(t1, A), body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).body;
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J(t1, A), body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const p1 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const p2 = (await call('POST', '/producers', { ...J(t1, A), body: { last_name: 'TRAORE', first_names: 'Moussa', village: 'Zoukougbeu', section: 'S2', value_chain_ids: [vc.id] } })).body.producer;
  const wh1 = (await call('POST', '/warehouses', { ...J(t1, A), body: { code: 'MAG1', name: 'Magasin 1' } })).body;
  const wh2 = (await call('POST', '/warehouses', { ...J(t1, A), body: { code: 'MAG2', name: 'Magasin 2' } })).body;
  const role = (await call('POST', '/roles', { ...J(t1, A), body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use'] } })).body;
  const adminRole = (await call('GET', '/roles', J(t1, A))).body.find((r) => r.code === 'coop_admin');
  const mkCollector = async (mail) => {
    const u = (await call('POST', '/users', { ...J(t1, A), body: { email: mail, full_name: mail, password: pw, role_id: role.id } })).body;
    const c = (await call('POST', '/collectors', { ...J(t1, A), body: { user_id: u.id } })).body;
    await call('POST', `/collectors/${c.id}/assignments`, { ...J(t1, A), body: { value_chain_id: vc.id } });
    return { user: u, collector: c, token: await login(mail, pw) };
  };
  const c1 = await mkCollector(`c1.${run}@t.test`), c2 = await mkCollector(`c2.${run}@t.test`);
  check('mise en place terminée', !!(vc.id && camp.id && p1.id && wh1.id && c1.collector.id && adminRole));

  console.log('Synchronisation : envoi hors connexion');
  const mkDecl = (producer, k) => ({ id: crypto.randomUUID(), idempotency_key: k, producer_id: producer, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', bags: 2, quantity: '2', unit: 'sac' });
  const d1 = mkDecl(p1.id, key('decl')), d2 = mkDecl(p2.id, key('decl'));
  const batch1 = { operations: [
    { idempotency_key: d1.idempotency_key, type: 'purchase_declaration.create', payload: d1 },
    { idempotency_key: key('submit'), type: 'purchase_declaration.submit', payload: { id: d1.id } },
    { idempotency_key: d2.idempotency_key, type: 'purchase_declaration.create', payload: d2 },
    { idempotency_key: key('submit'), type: 'purchase_declaration.submit', payload: { id: d2.id } },
  ] };
  const s1 = await call('POST', '/sync/batch', { ...J(c1.token, A), body: batch1 });
  check('lot de 4 opérations accepté', s1.status === 201 && s1.body.results.every((r) => r.status === 'accepted'), s1.body);
  const s1b = await call('POST', '/sync/batch', { ...J(c1.token, A), body: batch1 });
  check('renvoi du même lot : mêmes résultats', s1b.body.results.every((r, i) => r.status === 'accepted' && r.idempotency_key === batch1.operations[i].idempotency_key), s1b.body);
  const mine = (await call('GET', '/purchase-declarations', J(c1.token, A))).body;
  check('aucun doublon après renvoi (2 déclarations)', mine.length === 2 && mine.every((d) => d.status === 'received' && Number(d.amount) === 130000), mine);
  const reuse = await call('POST', '/sync/batch', { ...J(c1.token, A), body: { operations: [{ idempotency_key: d1.idempotency_key, type: 'purchase_declaration.create', payload: { ...d1, quantity: '9' } }] } });
  check('même clé avec un contenu différent → conflit', reuse.body.results[0].status === 'conflict', reuse.body);
  const bad = await call('POST', '/sync/batch', { ...J(c1.token, A), body: { operations: [
    { idempotency_key: key('bad'), type: 'inconnu.type', payload: {} },
    { idempotency_key: key('bad'), type: 'purchase_declaration.create', payload: { id: 'pas-un-uuid' } },
    { idempotency_key: key('bad'), type: 'financial_transaction.create', payload: { idempotency_key: key('tx'), account_id: crypto.randomUUID(), direction: 'out', amount: '10', reason: 'test' } },
  ] } });
  const st = bad.body.results.map((r) => r.status);
  check('type inconnu → rejected ; payload invalide → to_correct ; permission absente → rejected', st[0] === 'rejected' && st[1] === 'to_correct' && st[2] === 'rejected', bad.body);
  const other = await call('GET', '/purchase-declarations', J(c2.token, A));
  check('un autre collecteur ne voit rien', other.body.length === 0, other.body);

  console.log('Synchronisation : téléchargement');
  const ch = (await call('GET', '/sync/changes', J(c1.token, A))).body;
  check('référentiels, producteurs et déclarations propres reçus', ch.changes.producers.length === 2 && ch.changes.campaigns.length === 1 && ch.changes.price_versions.length === 1 &&
    ch.changes.declarations.length === 2 && ch.changes.unit_conversions.length === 1 && ch.my_collector_id === c1.collector.id, Object.keys(ch.changes).map((k) => `${k}:${ch.changes[k].length}`));
  check('permissions courantes incluses et résultats d\'opérations', ch.permissions.includes('sync:use') && !ch.permissions.includes('cash:operate') && ch.changes.operation_results.length >= 4);
  const ch2 = (await call('GET', '/sync/changes', J(c2.token, A))).body;
  check('l\'autre collecteur ne reçoit aucune déclaration', ch2.changes.declarations.length === 0, ch2.changes.declarations.length);
  check('pagination : limit=1 → has_more et curseur', (await call('GET', '/sync/changes?limit=1', J(c1.token, A))).body.has_more === true);
  check('curseur invalide → 400', (await call('GET', '/sync/changes?cursor=abc', J(c1.token, A))).status === 400);
  check('synchro vers une autre coopérative → 403', (await call('GET', '/sync/changes', J(tb, A))).status === 403);
  check('collecteur sans permission ne peut pas valider', (await call('POST', `/purchase-declarations/${d1.id}/transition`, { ...J(c1.token, A), body: { to: 'in_review' } })).status === 403);

  console.log('Pesée et réception');
  for (const d of [d1, d2]) {
    await call('POST', `/purchase-declarations/${d.id}/transition`, { ...J(t1, A), body: { to: 'in_review' } });
    await call('POST', `/purchase-declarations/${d.id}/transition`, { ...J(t1, A), body: { to: 'accepted' } });
  }
  const noRecv = await call('POST', '/receipts', { ...J(t1, A), body: { weighing_id: crypto.randomUUID() } });
  check('réception d\'une pesée inconnue → 404', noRecv.status === 404);
  const w1 = (await call('POST', '/weighings', { ...J(t1, A), body: { idempotency_key: key('w'), declaration_id: d1.id, warehouse_id: wh1.id, gross_kg: '135', tare_kg: '5' } })).body;
  check('pesée conforme : net 130 = déclaré 130, écart 0', w1.status === 'recorded' && Number(w1.net_kg) === 130 && Number(w1.declared_kg) === 130 && Number(w1.variance_kg) === 0, w1);
  const w1dup = (await call('POST', '/weighings', { ...J(t1, A), body: { idempotency_key: w1.idempotency_key, declaration_id: d1.id, warehouse_id: wh1.id, gross_kg: '135', tare_kg: '5' } })).body;
  check('renvoi de la pesée : même enregistrement', w1dup.id === w1.id && w1dup.replayed === true);
  const r1 = (await call('POST', '/receipts', { ...J(t1, A), body: { weighing_id: w1.id } })).body;
  check('réception : reçu émis, déclaration confirmée', /^RC-\d{4}-\d{5}$/.test(r1.receipt?.number) && r1.declaration_status === 'received_confirmed', r1);
  const r1b = (await call('POST', '/receipts', { ...J(t1, A), body: { weighing_id: w1.id } })).body;
  check('double réception : même reçu, pas de second mouvement', r1b.replayed === true && r1b.receipt.id === r1.receipt.id);
  const pdf = await call('GET', `/receipts/${r1.receipt.id}/pdf`, { ...J(t1, A), raw: true });
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  check('reçu PDF généré', pdf.status === 200 && pdfBuf.subarray(0, 4).toString() === '%PDF', pdf.status);

  const noJust = await call('POST', '/weighings', { ...J(t1, A), body: { idempotency_key: key('w'), declaration_id: d2.id, warehouse_id: wh1.id, gross_kg: '120' } });
  check('écart > seuil sans justification → 400', noJust.status === 400, noJust.body);
  const w2 = (await call('POST', '/weighings', { ...J(t1, A), body: { idempotency_key: key('w'), declaration_id: d2.id, warehouse_id: wh1.id, gross_kg: '120', justification: 'Sacs humides' } })).body;
  check('écart > seuil avec justification : en attente de validation', w2.status === 'pending_approval' && Number(w2.variance_pct) < -7, w2);
  check('réception impossible avant validation', (await call('POST', '/receipts', { ...J(t1, A), body: { weighing_id: w2.id } })).status === 400);
  check('validation par le même opérateur refusée → 403', (await call('POST', `/weighings/${w2.id}/approve`, { ...J(t1, A), body: { approve: true } })).status === 403);
  const ap = (await call('POST', `/weighings/${w2.id}/approve`, { ...J(t2, A), body: { approve: true } })).body;
  check('validation par un utilisateur distinct', ap.status === 'recorded' && !!ap.approved_by && ap.approved_by !== ap.operator_id, ap);
  const r2 = (await call('POST', '/receipts', { ...J(t1, A), body: { weighing_id: w2.id, lot_id: r1.lot_id } })).body;
  check('2e réception dans le même lot : réception partielle', r2.declaration_status === 'partially_received' && r2.lot_id === r1.lot_id, r2);

  console.log('Stocks');
  const lotId = r1.lot_id;
  const stock = (await call('GET', `/stocks?lot_id=${lotId}`, J(t1, A))).body;
  check('stock du lot : 130 + 120 = 250 kg', stock.length === 1 && Number(stock[0].balance_kg) === 250, stock);
  const ex = await call('POST', '/warehouse-movements', { ...J(t1, A), body: { idempotency_key: key('mv'), warehouse_id: wh1.id, lot_id: lotId, type: 'exit', quantity_kg: '50', reason: 'Vente test' } });
  check('sortie de 50 kg', ex.status === 201, ex.body);
  const over = await call('POST', '/warehouse-movements', { ...J(t1, A), body: { idempotency_key: key('mv'), warehouse_id: wh1.id, lot_id: lotId, type: 'exit', quantity_kg: '500', reason: 'Trop' } });
  check('sortie supérieure au stock → 400', over.status === 400, over.body);
  const tr = await call('POST', '/warehouse-transfers', { ...J(t1, A), body: { idempotency_key: key('tr'), from_warehouse_id: wh1.id, to_warehouse_id: wh2.id, lot_id: lotId, quantity_kg: '20', reason: 'Rééquilibrage' } });
  check('transfert de 20 kg', tr.status === 201 && tr.body.replayed === false, tr.body);
  const st2 = (await call('GET', `/stocks?lot_id=${lotId}`, J(t1, A))).body;
  const bal = Object.fromEntries(st2.map((s) => [s.warehouse_name, Number(s.balance_kg)]));
  check('soldes : Magasin 1 = 180, Magasin 2 = 20', bal['Magasin 1'] === 180 && bal['Magasin 2'] === 20, bal);
  const lossNoPerm = await call('POST', '/warehouse-movements', { ...J(t1, A), body: { idempotency_key: key('mv'), warehouse_id: wh1.id, lot_id: lotId, type: 'loss', quantity_kg: '1', reason: 'Casse' } });
  check('perte enregistrée (administrateur avec stock:adjust)', lossNoPerm.status === 201);

  console.log('Lots : division, fusion, traçabilité');
  const sp = await call('POST', `/lots/${lotId}/split`, { ...J(t1, A), body: { idempotency_key: key('sp'), warehouse_id: wh1.id, quantities_kg: ['100', '30'] } });
  check('division en 2 lots (100 + 30), reste 49', sp.status === 201 && sp.body.children.length === 2 && Number(sp.body.remaining_kg) === 49, sp.body);
  const tooMuch = await call('POST', `/lots/${lotId}/split`, { ...J(t1, A), body: { idempotency_key: key('sp'), warehouse_id: wh1.id, quantities_kg: ['100'] } });
  check('division supérieure au stock → 400', tooMuch.status === 400, tooMuch.body);
  const ids = sp.body.children.map((c) => c.id);
  const mg = await call('POST', '/lots/merge', { ...J(t1, A), body: { idempotency_key: key('mg'), warehouse_id: wh1.id, lot_ids: ids } });
  check('fusion des 2 lots : 130 kg', mg.status === 201 && Number(mg.body.quantity_kg) === 130, mg.body);
  const tr1 = (await call('GET', `/lots/${mg.body.lot.id}/traceability`, J(t1, A))).body;
  check('traçabilité : origines des 2 producteurs à travers division et fusion', tr1.origins.length === 2 && new Set(tr1.origins.map((o) => o.producer_code)).size === 2, tr1.origins);
  check('traçabilité : ancêtres, événements, anomalies de pesée', tr1.ancestors.length >= 4 && tr1.events.length >= 5 && tr1.anomalies.some((a) => a.includes('Sacs humides')), { anc: tr1.ancestors.length, ev: tr1.events.length, an: tr1.anomalies });
  check('traçabilité : informations manquantes signalées', tr1.missing.some((m) => m.includes('aucune parcelle enregistrée')) && tr1.missing.some((m) => m.includes('Expéditions')));
  const tp = await call('GET', `/lots/${mg.body.lot.id}/traceability.pdf`, { ...J(t1, A), raw: true });
  check('rapport de traçabilité PDF', tp.status === 200 && Buffer.from(await tp.arrayBuffer()).subarray(0, 4).toString() === '%PDF', tp.status);
  check('lot inaccessible depuis une autre coopérative → 404', (await call('GET', `/lots/${mg.body.lot.id}/traceability`, J(tb, B))).status === 404);
  const lots = (await call('GET', '/lots', J(tb, B))).body;
  check('autre coopérative : aucun lot, aucun stock', lots.length === 0 && (await call('GET', '/stocks', J(tb, B))).body.length === 0);
  const au = (await call('GET', '/audit-logs?limit=500', J(t1, A))).body.map((r) => r.action);
  check('audit : réception, division, fusion, export tracés', ['receipt.create', 'lot.split', 'lot.merge', 'lot.traceability_export', 'weighing.approve'].every((a) => au.includes(a)), au);

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
