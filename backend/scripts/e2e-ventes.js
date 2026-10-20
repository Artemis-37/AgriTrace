// Test de bout en bout : transport, expéditions, acheteurs, commandes, factures, paiements, réclamations, traçabilité descendante.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const pw = 'MotDePasseSolide2026!';
const pdf = (t) => Buffer.from(`%PDF-1.4\n% ${t}\n%%EOF\n`);
const num = (x) => Number(x);

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mk = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
    return { org, t: await login(mail, pw) };
  };
  const A = await mk('VA'), B = await mk('VB');
  const J = (X, tok) => ({ token: tok ?? X.t, org: X.org.id });
  await call('PUT', '/purchase-declarations/settings/receipts', { ...J(A), body: { mode: 'physical', series: 'A', required: false } });
  const vc = (await call('POST', '/value-chains', { ...J(A), body: { code: 'CACAO', name: 'Cacao' } })).body;
  await call('POST', '/unit-conversions', { ...J(A), body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = (await call('POST', '/campaigns', { ...J(A), body: { value_chain_id: vc.id, code: 'C2526', name: 'Campagne', starts_on: '2025-10-01', ends_on: '2026-12-31' } })).body;
  const sched = (await call('POST', '/price-schedules', { ...J(A), body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } })).body;
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J(A), body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const prod = (await call('POST', '/producers', { ...J(A), body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', section: 'S1', value_chain_ids: [vc.id] } })).body.producer;
  const wh = (await call('POST', '/warehouses', { ...J(A), body: { code: 'MAG1', name: 'Magasin 1' } })).body;
  const rcol = (await call('POST', '/roles', { ...J(A), body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use'] } })).body;
  const cu = (await call('POST', '/users', { ...J(A), body: { email: `col.${run}@t.test`, full_name: 'col', password: pw, role_id: rcol.id } })).body;
  const col = (await call('POST', '/collectors', { ...J(A), body: { user_id: cu.id } })).body;
  await call('POST', `/collectors/${col.id}/assignments`, { ...J(A), body: { value_chain_id: vc.id } });
  const tcol = await login(`col.${run}@t.test`, pw);
  // Stock : 10 sacs = 650 kg
  const decl = { id: crypto.randomUUID(), idempotency_key: key('d'), producer_id: prod.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', bags: 10, quantity: '10', unit: 'sac' };
  await call('POST', '/sync/batch', { ...J(A, tcol), body: { operations: [
    { idempotency_key: decl.idempotency_key, type: 'purchase_declaration.create', payload: decl }, { idempotency_key: key('s'), type: 'purchase_declaration.submit', payload: { id: decl.id } }] } });
  await call('POST', `/purchase-declarations/${decl.id}/transition`, { ...J(A), body: { to: 'in_review' } });
  await call('POST', `/purchase-declarations/${decl.id}/transition`, { ...J(A), body: { to: 'accepted' } });
  const w = (await call('POST', '/weighings', { ...J(A), body: { idempotency_key: key('w'), declaration_id: decl.id, warehouse_id: wh.id, gross_kg: '655', tare_kg: '5' } })).body;
  const rc = (await call('POST', '/receipts', { ...J(A), body: { weighing_id: w.id } })).body;
  const lotId = rc.receipt?.lot_id ?? rc.lot_id;
  const bal = async (X = A) => num(((await call('GET', `/stocks?lot_id=${lotId}`, J(X))).body[0] ?? {}).balance_kg ?? 0);
  check('mise en place : lot de 650 kg en stock', !!lotId && (await bal()) === 650, { lotId, rc });

  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(A), body: { code, name: code, permissions } })).body;
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(A), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email, pw) }; };
  const rLog = await role('logisticien', ['logistics:manage', 'logistics:read', 'shipments:manage', 'documents:upload', 'documents:read', 'lots:read', 'warehouses:read']);
  const rCom = await role('commercial', ['buyers:manage', 'buyers:read', 'orders:manage', 'invoices:issue', 'invoices:read', 'invoices:payments', 'claims:manage', 'lots:read', 'warehouses:read']);
  const rCtl = await role('controleur', ['shipments:validate', 'logistics:read', 'documents:read']);
  const rLec = await role('lecteur', ['lots:read']);
  const log = await user('log', rLog), com = await user('com', rCom), ctl = await user('ctl', rCtl), lec = await user('lec', rLec);

  console.log('Transporteurs, véhicules, conducteurs');
  check('lecteur ne peut pas créer de transporteur', (await call('POST', '/carriers', { ...J(A, lec.t), body: { code: 'TR1', name: 'Trans' } })).status === 403);
  const car = (await call('POST', '/carriers', { ...J(A, log.t), body: { code: 'TR1', name: 'Transports Gôh', phone: '0700000000' } })).body;
  check('transporteur créé ; code unique', !!car.id && (await call('POST', '/carriers', { ...J(A, log.t), body: { code: 'TR1', name: 'Autre' } })).status === 409);
  const vSmall = (await call('POST', '/vehicles', { ...J(A, log.t), body: { plate: '1234 ab 01', carrier_id: car.id, capacity_kg: '250' } })).body;
  const vBig = (await call('POST', '/vehicles', { ...J(A, log.t), body: { plate: '5678 CD 01', carrier_id: car.id, capacity_kg: '1000' } })).body;
  check('véhicules créés (immatriculation normalisée, unique)', vSmall.plate === '1234 AB 01' && (await call('POST', '/vehicles', { ...J(A, log.t), body: { plate: '1234 AB 01' } })).status === 409);
  const drv = (await call('POST', '/drivers', { ...J(A, log.t), body: { full_name: 'Yao Konan', carrier_id: car.id, licence_no: 'PC-001' } })).body;
  check('conducteur créé', !!drv.id);

  console.log('Acheteurs, contrats, commandes');
  check('fiche acheteur : code unique', (await call('POST', '/buyers', { ...J(A, com.t), body: { code: 'CEMOI', name: 'Cemoi Négoce', country: 'FR', currency: 'XOF', payment_terms_days: 30 } })).status === 201
    && (await call('POST', '/buyers', { ...J(A, com.t), body: { code: 'CEMOI', name: 'Doublon' } })).status === 409);
  const buyer = (await call('GET', '/buyers', J(A, com.t))).body[0];
  check('lecteur ne voit pas les acheteurs', (await call('GET', '/buyers', J(A, lec.t))).status === 403);
  const ct = await call('POST', '/sales-contracts', { ...J(A, com.t), body: { number: 'CT-001', buyer_id: buyer.id, value_chain_id: vc.id, starts_on: '2026-01-01', ends_on: '2026-12-31', quantity_kg: '600', unit_price: '1500' } });
  check('contrat créé', ct.status === 201 && ct.body.currency === 'XOF');
  const ord = async (qty, extra = {}) => call('POST', '/sales-orders', { ...J(A, com.t), body: { idempotency_key: key('o'), buyer_id: buyer.id, value_chain_id: vc.id, contract_id: ct.body.id, lines: [{ description: 'Cacao', quantity_kg: qty, unit_price: '1500' }], ...extra } });
  const o1 = await ord('500');
  check('commande créée, numérotée, devise et délai issus du contrat', o1.status === 201 && /^CMD-\d{4}-\d{5}$/.test(o1.body.number) && o1.body.status === 'draft' && o1.body.payment_terms_days === 30, o1.body);
  const o1b = await call('POST', '/sales-orders', { ...J(A, com.t), body: { idempotency_key: o1.body.idempotency_key, buyer_id: buyer.id, value_chain_id: vc.id, lines: [{ quantity_kg: '1', unit_price: '1' }] } });
  check('même clé : pas de doublon', o1b.body.id === o1.body.id);
  check('dépassement du solde du contrat refusé (409)', (await ord('200')).status === 409);
  const orderId = o1.body.id;
  const det0 = (await call('GET', `/sales-orders/${orderId}`, J(A, com.t))).body;
  const lineId = det0.lines[0].id;
  check('montant de ligne exact', det0.lines[0].amount === '750000.00', det0.lines);

  console.log('Affectation des lots');
  const al = (q) => call('POST', `/sales-orders/${orderId}/allocations`, { ...J(A, com.t), body: { line_id: lineId, lot_id: lotId, warehouse_id: wh.id, quantity_kg: q } });
  check('affectation supérieure au stock refusée', (await al('700')).status === 400);
  const a1 = await al('400'); const a2 = await al('100');
  check('lot affecté (réservé) : 400 + 100', a1.status === 201 && a2.status === 201);
  check('au-delà de la quantité commandée → 400', (await al('1')).status === 400);
  // une 2e commande ne peut pas réserver plus que le disponible (650 - 500 = 150)
  const o2 = await call('POST', '/sales-orders', { ...J(A, com.t), body: { idempotency_key: key('o'), buyer_id: buyer.id, value_chain_id: vc.id, lines: [{ quantity_kg: '300', unit_price: '1400' }] } });
  const l2 = (await call('GET', `/sales-orders/${o2.body.id}`, J(A, com.t))).body.lines[0].id;
  const over = await call('POST', `/sales-orders/${o2.body.id}/allocations`, { ...J(A, com.t), body: { line_id: l2, lot_id: lotId, warehouse_id: wh.id, quantity_kg: '200' } });
  check('stock réservé par une autre commande non disponible', over.status === 400 && /disponible/.test(JSON.stringify(over.body)), over.body);
  check('annulation d\'une commande en brouillon', (await call('POST', `/sales-orders/${o2.body.id}/cancel`, { ...J(A, com.t), body: { reason: 'Test' } })).body.status === 'cancelled');
  check('expédition impossible avant confirmation', (await call('POST', '/shipments', { ...J(A, log.t), body: { idempotency_key: key('s'), order_id: orderId, origin_warehouse_id: wh.id, destination: 'Port', items: [{ allocation_id: a1.body.id, planned_kg: '100' }] } })).status === 409);
  check('commande confirmée', (await call('POST', `/sales-orders/${orderId}/confirm`, J(A, com.t))).body.status === 'confirmed');

  console.log('Expéditions : chargement');
  const shipBody = (items, extra = {}) => ({ idempotency_key: key('s'), order_id: orderId, origin_warehouse_id: wh.id, destination: 'Port de San Pedro', carrier_id: car.id, vehicle_id: vBig.id, driver_id: drv.id, items, ...extra });
  const sTry = await call('POST', '/shipments', { ...J(A, log.t), body: shipBody([{ allocation_id: a1.body.id, planned_kg: '300' }], { vehicle_id: vSmall.id }) });
  check('expédition planifiée', sTry.status === 201 && /^EXP-\d{4}-\d{5}$/.test(sTry.body.reference) && sTry.body.status === 'planned');
  check('chargement supérieur à la capacité du véhicule refusé', (await call('POST', `/shipments/${sTry.body.id}/load`, { ...J(A, log.t), body: {} })).status === 409);
  check('annulation motivée d\'une expédition non chargée', (await call('POST', `/shipments/${sTry.body.id}/cancel`, { ...J(A, log.t), body: { reason: 'Mauvais véhicule' } })).body.status === 'cancelled');
  const sNo = (await call('POST', '/shipments', { ...J(A, log.t), body: shipBody([{ allocation_id: a1.body.id, planned_kg: '10' }], { carrier_id: undefined, vehicle_id: undefined, driver_id: undefined }) })).body;
  check('expédition créée sans véhicule ni conducteur', sNo.status === 'planned' && !sNo.vehicle_id && !sNo.driver_id, sNo);
  check('affectation vide refusée', (await call('POST', `/shipments/${sNo.id}/assign`, { ...J(A, log.t), body: {} })).status === 400);
  check('véhicule inconnu refusé', (await call('POST', `/shipments/${sNo.id}/assign`, { ...J(A, log.t), body: { vehicle_id: '00000000-0000-4000-8000-000000000000' } })).status === 400);
  const asg = await call('POST', `/shipments/${sNo.id}/assign`, { ...J(A, log.t), body: { carrier_id: car.id, vehicle_id: vBig.id, driver_id: drv.id } });
  check('affectation du transporteur, du véhicule et du conducteur', asg.status === 201 && asg.body.vehicle_id === vBig.id && asg.body.driver_id === drv.id && asg.body.carrier_id === car.id, asg.body);
  check('affectation refusée sans la permission', (await call('POST', `/shipments/${sNo.id}/assign`, { ...J(A, ctl.t), body: { driver_id: drv.id } })).status === 403);
  await call('POST', `/shipments/${sNo.id}/cancel`, { ...J(A, log.t), body: { reason: 'Test affectation' } });
  const s1 = (await call('POST', '/shipments', { ...J(A, log.t), body: shipBody([{ allocation_id: a1.body.id, planned_kg: '300' }]) })).body;
  check('quantité au-delà du reste de l\'affectation refusée', (await call('POST', '/shipments', { ...J(A, log.t), body: shipBody([{ allocation_id: a1.body.id, planned_kg: '150' }]) })).status === 400);
  check('départ avant chargement refusé', (await call('POST', `/shipments/${s1.id}/depart`, J(A, log.t))).status === 409);
  const ld = await call('POST', `/shipments/${s1.id}/load`, { ...J(A, log.t), body: { seals: ['SC-001', 'SC-002'], transport_doc_no: 'BL-9001' } });
  check('chargement : statut, scellés, bon de transport', ld.status === 201 && ld.body.status === 'loaded' && ld.body.seals.length === 2 && ld.body.transport_doc_no === 'BL-9001', ld.body);
  check('le stock du magasin diminue (650 → 350)', (await bal()) === 350);
  check('rechargement idempotent (pas de second mouvement)', (await call('POST', `/shipments/${s1.id}/load`, { ...J(A, log.t), body: {} })).status === 201 && (await bal()) === 350);
  check('commande « partiellement expédiée »', (await call('GET', `/sales-orders/${orderId}`, J(A, com.t))).body.status === 'partially_shipped');
  const noBl = await call('POST', `/shipments/${s1.id}/depart`, J(A, log.t));
  check('départ sans n° de connaissement refusé', noBl.status === 400, noBl.body);
  const dep = await call('POST', `/shipments/${s1.id}/depart`, { ...J(A, log.t), body: { bill_of_lading_no: 'MEDU1234567', port: 'San Pedro', exporter_name: 'Exportateur SA' } });
  check('départ avec B/L saisi', dep.body.status === 'in_transit' && dep.body.bill_of_lading_no === 'MEDU1234567' && dep.body.port === 'San Pedro', dep.body);

  console.log('Livraison, écarts, preuves, validation');
  const s1d = (await call('GET', `/shipments/${s1.id}`, J(A, log.t))).body;
  const it1 = s1d.items[0];
  check('livraison supérieure au chargé refusée', (await call('POST', `/shipments/${s1.id}/deliver`, { ...J(A, log.t), body: { received_by_name: 'M. Bamba', items: [{ item_id: it1.id, delivered_kg: '310' }] } })).status === 400);
  const noJust = await call('POST', `/shipments/${s1.id}/deliver`, { ...J(A, log.t), body: { received_by_name: 'M. Bamba', items: [{ item_id: it1.id, delivered_kg: '295' }] } });
  check('écart sans justification ni responsable → 400', noJust.status === 400 && /justification/.test(JSON.stringify(noJust.body)), noJust.body);
  const dl = await call('POST', `/shipments/${s1.id}/deliver`, { ...J(A, log.t), body: { received_by_name: 'M. Bamba', items: [{ item_id: it1.id, delivered_kg: '295', reason: 'Sacs déchirés au déchargement', handler_id: log.id }] } });
  check('livraison enregistrée avec écart de 5 kg justifié', dl.status === 201 && dl.body.status === 'delivered' && dl.body.discrepancies[0].gap_kg === '5.000', dl.body);
  const s1e = (await call('GET', `/shipments/${s1.id}`, J(A, log.t))).body;
  check('comparaison prévu / chargé / livré', num(s1e.items[0].planned_kg) === 300 && num(s1e.items[0].loaded_kg) === 300 && num(s1e.items[0].delivered_kg) === 295 && num(s1e.items[0].discrepancy_kg) === 5 && s1e.items[0].discrepancy_handler === log.id, s1e.items[0]);
  check('validation sans preuve de livraison refusée', (await call('POST', `/shipments/${s1.id}/validate`, { ...J(A, ctl.t), body: {} })).status === 400);
  const inc = await call('POST', `/shipments/${s1.id}/incidents`, { ...J(A, log.t), body: { kind: 'damage', description: 'Sacs déchirés', quantity_kg: '5', handler_id: log.id } });
  check('incident enregistré', inc.status === 201);
  const f = new FormData(); f.append('file', new Blob([pdf('bl signé')], { type: 'application/pdf' }), 'bl.pdf'); f.append('subject_type', 'shipment'); f.append('subject_id', s1.id); f.append('kind', 'proof_of_delivery');
  check('preuve de livraison téléversée', (await call('POST', '/documents', { ...J(A, log.t), form: f })).status === 201);
  check('incident ouvert : validation refusée', (await call('POST', `/shipments/${s1.id}/validate`, { ...J(A, ctl.t), body: {} })).status === 409);
  check('incident traité', (await call('POST', `/shipment-incidents/${inc.body.id}/resolve`, { ...J(A, log.t), body: { resolution: 'Constat avec le transporteur' } })).body.status === 'resolved');
  check('le logisticien ne valide pas la livraison (permission séparée)', (await call('POST', `/shipments/${s1.id}/validate`, { ...J(A, log.t), body: {} })).status === 403);
  const val = await call('POST', `/shipments/${s1.id}/validate`, { ...J(A, ctl.t), body: { note: 'Conforme' } });
  check('livraison validée par le contrôleur', val.body.status === 'validated' && val.body.validated_by);

  console.log('Seconde expédition et statut de la commande');
  const s2 = (await call('POST', '/shipments', { ...J(A, log.t), body: shipBody([{ allocation_id: a1.body.id, planned_kg: '100' }, { allocation_id: a2.body.id, planned_kg: '100' }]) })).body;
  await call('POST', `/shipments/${s2.id}/load`, { ...J(A, log.t), body: { seals: ['SC-010'] } });
  check('commande entièrement expédiée', (await call('GET', `/sales-orders/${orderId}`, J(A, com.t))).body.status === 'shipped');
  check('stock restant 150 kg', (await bal()) === 150);
  await call('POST', `/shipments/${s2.id}/depart`, { ...J(A, log.t), body: { bill_of_lading_no: 'MEDU7654321' } });
  const s2d = (await call('GET', `/shipments/${s2.id}`, J(A, log.t))).body;
  await call('POST', `/shipments/${s2.id}/deliver`, { ...J(A, log.t), body: { received_by_name: 'M. Bamba', items: s2d.items.map((i) => ({ item_id: i.id, delivered_kg: i.loaded_kg })) } });
  const f2 = new FormData(); f2.append('file', new Blob([pdf('bl2')], { type: 'application/pdf' }), 'bl2.pdf'); f2.append('subject_type', 'shipment'); f2.append('subject_id', s2.id); f2.append('kind', 'proof_of_delivery');
  await call('POST', '/documents', { ...J(A, log.t), form: f2 });

  console.log('Factures et paiements');
  const inv = (lines, extra = {}) => call('POST', '/invoices', { ...J(A, com.t), body: { idempotency_key: key('i'), order_id: orderId, lines, ...extra } });
  const s1items = (await call('GET', `/shipments/${s1.id}`, J(A, log.t))).body.items;
  check('livraison non validée non facturable', (await inv([{ shipment_item_id: s2d.items[0].id, quantity_kg: '100' }])).status === 409);
  check('facturation au-delà du livré refusée (295 kg livrés)', (await inv([{ shipment_item_id: s1items[0].id, quantity_kg: '296' }])).status === 400);
  const i1 = await inv([{ shipment_item_id: s1items[0].id, quantity_kg: '295' }]);
  check('facture : numéro, montant exact 442 500,00, échéance à 30 jours', i1.status === 201 && /^FA-\d{4}-\d{5}$/.test(i1.body.number) && i1.body.total === '442500.00' && i1.body.status === 'issued', i1.body);
  check('livré déjà facturé : pas de seconde facture', (await inv([{ shipment_item_id: s1items[0].id, quantity_kg: '1' }])).status === 400);
  check('commande non clôturable (non livrée / non soldée)', (await call('POST', `/sales-orders/${orderId}/close`, J(A, com.t))).status === 409);
  const p1 = await call('POST', `/invoices/${i1.body.id}/payments`, { ...J(A, com.t), body: { idempotency_key: key('p'), amount: '200000', received_on: '2026-03-01', method: 'bank_transfer', reference: 'VIR-1' } });
  check('paiement partiel : solde 242 500,00', p1.status === 201 && p1.body.balance === '242500.00');
  const pk = { idempotency_key: key('p'), amount: '100000', received_on: '2026-03-02', method: 'cash' };
  await call('POST', `/invoices/${i1.body.id}/payments`, { ...J(A, com.t), body: pk });
  await call('POST', `/invoices/${i1.body.id}/payments`, { ...J(A, com.t), body: pk });
  const iv = (await call('GET', `/invoices/${i1.body.id}`, J(A, com.t))).body;
  check('paiement renvoyé : pas de doublon ; statut partiellement payé', iv.payments.length === 2 && iv.status === 'partially_paid' && iv.balance === '142500.00', iv);
  check('surpaiement refusé', (await call('POST', `/invoices/${i1.body.id}/payments`, { ...J(A, com.t), body: { idempotency_key: key('p'), amount: '142500.01', received_on: '2026-03-03', method: 'cash' } })).status === 400);
  check('annulation impossible avec paiements', (await call('POST', `/invoices/${i1.body.id}/cancel`, { ...J(A, com.t), body: { reason: 'erreur' } })).status === 409);
  check('encaissement du solde → payée', (await call('POST', `/invoices/${i1.body.id}/payments`, { ...J(A, com.t), body: { idempotency_key: key('p'), amount: '142500', received_on: '2026-03-04', method: 'cheque' } })).body.balance === '0.00'
    && (await call('GET', `/invoices/${i1.body.id}`, J(A, com.t))).body.status === 'paid');
  await call('POST', `/shipments/${s2.id}/validate`, { ...J(A, ctl.t), body: {} });
  check('toutes livraisons validées → commande livrée', (await call('GET', `/sales-orders/${orderId}`, J(A, com.t))).body.status === 'delivered');
  const s2items = (await call('GET', `/shipments/${s2.id}`, J(A, log.t))).body.items;
  const i2 = await inv(s2items.map((i) => ({ shipment_item_id: i.id, quantity_kg: i.delivered_kg })), { issue_date: '2026-01-15' });
  check('seconde facture (200 kg → 300 000,00), échéance dépassée', i2.status === 201 && i2.body.total === '300000.00' && i2.body.due_date.startsWith('2026-02-14'), i2.body);
  const od = (await call('GET', '/invoices?overdue=true', J(A, com.t))).body;
  check('filtre factures en retard', od.length === 1 && od[0].id === i2.body.id && od[0].overdue === true);
  const st = (await call('GET', `/buyers/${buyer.id}/statement`, J(A, com.t))).body;
  check('situation acheteur : facturé 742 500, encaissé 442 500, solde 300 000, en retard 300 000', st.totals.invoiced === '742500.00' && st.totals.paid === '442500.00' && st.totals.balance === '300000.00' && st.totals.overdue === '300000.00', st.totals);
  check('clôture refusée tant qu\'une facture est impayée', (await call('POST', `/sales-orders/${orderId}/close`, J(A, com.t))).status === 409);
  const bank = (await call('POST', '/financial-accounts', { ...J(A, A.t), body: { owner_type: 'other', name: 'Banque principale' } })).body;
  const accPay = { idempotency_key: key('p'), amount: '300000', received_on: '2026-03-05', method: 'bank_transfer', account_id: bank.id };
  check('encaissement comptabilisé : droit de caisse exigé', (await call('POST', `/invoices/${i2.body.id}/payments`, { ...J(A, com.t), body: accPay })).status === 403);
  const ap = await call('POST', `/invoices/${i2.body.id}/payments`, { ...J(A, A.t), body: accPay });
  check('encaissement comptabilisé : paiement enregistré', ap.status === 201 && ap.body.balance === '0.00', ap.body);
  await call('POST', `/invoices/${i2.body.id}/payments`, { ...J(A, A.t), body: accPay });
  const bk = (await call('GET', '/financial-accounts', J(A, A.t))).body.find((a) => a.id === bank.id);
  check('compte bancaire crédité une seule fois (renvoi idempotent)', Number(bk.balance) === 300000, bk);
  const tbv = JSON.stringify((await call('GET', '/accounting/trial-balance', J(A, A.t))).body);
  check('écriture comptable : clients (411) et banque (521)', tbv.includes('411') && tbv.includes('521'), tbv.slice(0, 300));
  check('commande clôturée une fois soldée', (await call('POST', `/sales-orders/${orderId}/close`, J(A, com.t))).body.status === 'closed');
  check('commande clôturée non annulable', (await call('POST', `/sales-orders/${orderId}/cancel`, { ...J(A, com.t), body: { reason: 'x y z' } })).status === 409);

  console.log('Réclamations');
  const cl = await call('POST', '/sales-claims', { ...J(A, com.t), body: { buyer_id: buyer.id, order_id: orderId, shipment_id: s1.id, description: 'Sacs abîmés à la livraison', amount_claimed: '7500' } });
  check('réclamation enregistrée', cl.status === 201 && cl.body.status === 'open');
  check('réclamation traitée', (await call('POST', `/sales-claims/${cl.body.id}/resolve`, { ...J(A, com.t), body: { outcome: 'resolved', resolution: 'Avoir de 7 500 F' } })).body.status === 'resolved'
    && (await call('POST', `/sales-claims/${cl.body.id}/resolve`, { ...J(A, com.t), body: { outcome: 'rejected', resolution: 'encore' } })).status === 404);

  console.log('Traçabilité descendante');
  const fw = (await call('GET', `/traceability/forward?producer_id=${prod.id}`, J(A))).body;
  check('producteur → lot → expéditions → commande → factures → acheteur', fw.lots.some((l) => l.id === lotId) && fw.shipments.length === 2 && fw.orders.length === 1 && fw.invoices.length === 2 && fw.buyers[0]?.code === 'CEMOI', fw);
  const fwd = (await call('GET', `/traceability/forward?declaration_id=${decl.id}`, J(A))).body;
  check('déclaration d\'achat → mêmes acheteurs', fwd.buyers.length === 1 && fwd.shipments.length === 2);
  const par = (await call('POST', '/parcels', { ...J(A), body: { idempotency_key: key('p'), producer_id: prod.id, value_chain_id: vc.id, declared_area_ha: '2', latitude: 6.8, longitude: -6 } })).body;
  const fwp = (await call('GET', `/traceability/forward?parcel_id=${par.id}`, J(A))).body;
  check('parcelle → lien indirect signalé', fwp.buyers.length === 1 && fwp.notes.some((n) => /indirect/.test(n)), fwp.notes);
  check('critère unique obligatoire', (await call('GET', `/traceability/forward?producer_id=${prod.id}&lot_id=${lotId}`, J(A))).status === 400);
  const lt = (await call('GET', `/lots/${lotId}/traceability`, J(A))).body;
  check('rapport de traçabilité du lot : expéditions et factures réelles', new Set(lt.shipments.map((s) => s.reference)).size === 2 && lt.invoices.length === 2 && !lt.missing.some((m) => /Expéditions/.test(m)), lt.missing);

  console.log('Droits et isolation');
  check('lecteur ne crée pas de commande', (await call('POST', '/sales-orders', { ...J(A, lec.t), body: { idempotency_key: key('o'), buyer_id: buyer.id, value_chain_id: vc.id, lines: [{ quantity_kg: '1', unit_price: '1' }] } })).status === 403);
  check('commercial n\'enregistre pas d\'expédition', (await call('POST', '/shipments', { ...J(A, com.t), body: shipBody([{ allocation_id: a1.body.id, planned_kg: '1' }]) })).status === 403);
  check('autre coopérative : commande, expédition, facture introuvables', (await call('GET', `/sales-orders/${orderId}`, J(B))).status === 404 && (await call('GET', `/shipments/${s1.id}`, J(B))).status === 404 && (await call('GET', `/invoices/${i1.body.id}`, J(B))).status === 404);
  check('autre coopérative : traçabilité vide', (await call('GET', `/traceability/forward?lot_id=${lotId}`, J(B))).body.shipments.length === 0);
  const aud = JSON.stringify((await call('GET', '/audit-logs?limit=500', J(A))).body);
  check('opérations auditées (expédition, facture, paiement)', ['shipment.load', 'shipment.validate', 'invoice.issue', 'invoice.payment', 'order.allocate'].every((a) => aud.includes(a)));

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
