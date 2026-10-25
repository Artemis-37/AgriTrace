// Complète la démonstration : données FICTIVES pour que chaque profil trouve des éléments dans ses écrans
// (logistique, ventes, inventaire, préfinancement, paiements, partenaires, documents, cartographie, audit, livraisons à l'exportateur, messagerie…).
// Lancé à la fin de seed-demo-complet.js (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-enrichi.js).
// Chaque étape est facultative : un échec est signalé sans interrompre les autres.
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const PASSWORD = J.password;
const run = crypto.randomBytes(2).toString('hex');
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pdf = (t) => Buffer.from(`%PDF-1.4\n% ${t} (document fictif de démonstration)\n%%EOF\n`);
const warnings = [];

const MOBILE = new Set(['collecteur', 'agent_terrain', 'coach']);
async function call(method, p, { token, org, body, form, client } = {}) {
  const headers = { 'x-client': client || 'web' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${String(t).slice(0, 200)}`);
  return j;
}
async function soft(label, fn) {
  try { const r = await fn(); console.log('  ✓', label); return r; }
  catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; }
}

(async () => {
  const byRole = Object.fromEntries(J.accounts.filter((a) => a.org == null).map((a) => [a.role, a.email]));
  const exp = Object.fromEntries(J.accounts.filter((a) => a.org).map((a) => [a.role, a.email]));
  const login = async (email, client) => (await call('POST', '/auth/login', { client, body: { email, password: PASSWORD } })).access_token;
  const C = J.org, E = J.exporter?.id;
  const tok = {};
  const SKIP = new Set(['auditeur', 'collecteur', 'exportateur']); // pas utilisés ici : on évite des ouvertures de session inutiles
  for (const [r, e] of Object.entries(byRole)) if (!SKIP.has(r)) tok[r] = await login(e, MOBILE.has(r) ? 'mobile' : 'web');
  const etok = {};
  for (const [r, e] of Object.entries(exp)) etok[r] = await login(e);
  const as = (r) => ({ token: tok[r], org: C, client: MOBILE.has(r) ? 'mobile' : 'web' });
  const asE = (r) => ({ token: etok[r], org: E });
  // Essaie plusieurs profils : le premier qui a le droit réussit.
  const any = async (roles, method, p, body, form) => {
    let last;
    for (const r of roles) { try { return await call(method, p, { ...as(r), body, form }); } catch (e) { last = e; if (!/→ 40[13]/.test(e.message)) throw e; } }
    throw last;
  };
  const ADM = 'coop_admin';

  const producers = await call('GET', '/producers', as(ADM)).then((r) => (Array.isArray(r) ? r : r.items ?? r.rows ?? []));
  const lots = await call('GET', '/lots', as(ADM));
  const whs = await call('GET', '/warehouses', as(ADM));
  const wh = whs[0];
  const lot = lots[0];
  const vc = (await call('GET', '/value-chains', as(ADM)))[0];
  const accountsFin = await call('GET', '/financial-accounts', as(ADM));
  const bank = accountsFin.find((a) => /Banque/.test(a.name)) ?? accountsFin[0];

  // ── Logistique : transporteurs, véhicules, conducteurs
  const log = ['responsable_logistique', ADM];
  const ref = {};
  await soft('transporteurs, véhicules, conducteurs', async () => {
    ref.car = await any(log, 'POST', '/carriers', { code: 'TRANSAFRIK', name: 'Transafrik Logistique (fictif)', phone: '+2250700000101' });
    await any(log, 'POST', '/carriers', { code: 'SAVANE', name: 'Savane Transports (fictif)', phone: '+2250700000102' });
    ref.vBig = await any(log, 'POST', '/vehicles', { plate: 'CI-2210-AB', carrier_id: ref.car.id, kind: 'Camion 10 t', capacity_kg: '10000' });
    ref.vSmall = await any(log, 'POST', '/vehicles', { plate: 'CI-0877-CD', carrier_id: ref.car.id, kind: 'Camionnette', capacity_kg: '2500' });
    ref.drv = await any(log, 'POST', '/drivers', { full_name: 'Moussa Traoré', carrier_id: ref.car.id, phone: '+2250700000103', licence_no: 'PC-445566' });
    await any(log, 'POST', '/drivers', { full_name: 'Issouf Diomandé', carrier_id: ref.car.id, phone: '+2250700000104', licence_no: 'PC-778899' });
  });

  ref.logUser = (await call('GET', '/users', as(ADM))).find((u) => u.email === byRole.responsable_logistique)?.id;

  // ── Ventes → expédition → livraison → validation → facture → paiement → réclamation
  await soft('commande, expédition, livraison, facture, paiement, réclamation', async () => {
    const orders = await call('GET', '/sales-orders', as('acheteur')).catch(() => call('GET', '/sales-orders', as(ADM)));
    const order = orders[0];
    const com = ['acheteur', ADM];
    const det = await any(com, 'GET', `/sales-orders/${order.id}`);
    const lineId = (det.lines ?? det.items)[0].id;
    await any(com, 'POST', `/sales-orders/${order.id}/confirm`, {});
    const al = await any(com, 'POST', `/sales-orders/${order.id}/allocations`, { line_id: lineId, lot_id: lot.id, warehouse_id: wh.id, quantity_kg: '600' });
    const al2 = await any(com, 'POST', `/sales-orders/${order.id}/allocations`, { line_id: lineId, lot_id: lot.id, warehouse_id: wh.id, quantity_kg: '400' });
    const ship = (planned, a) => any(log, 'POST', '/shipments', {
      idempotency_key: key('s'), order_id: order.id, origin_warehouse_id: wh.id, destination: 'Port de San Pedro (fictif)',
      carrier_id: ref.car?.id, vehicle_id: ref.vBig?.id, driver_id: ref.drv?.id, planned_departure: days(1), items: [{ allocation_id: a.id, planned_kg: planned }],
    });
    // 1) livrée, validée, facturée, payée
    const s1 = await ship('600', al);
    await any(log, 'POST', `/shipments/${s1.id}/load`, { seals: ['SC-001', 'SC-002'], transport_doc_no: 'BL-DEMO-001' });
    await any(log, 'POST', `/shipments/${s1.id}/depart`, { bill_of_lading_no: 'MEDU0000001', port: 'San Pedro', exporter_name: 'Exportateur de Démonstration' });
    const s1d = await any(log, 'GET', `/shipments/${s1.id}`);
    const it = s1d.items[0];
    await any(log, 'POST', `/shipments/${s1.id}/deliver`, { received_by_name: 'M. Bamba', items: [{ item_id: it.id, delivered_kg: '596', reason: 'Sacs déchirés au déchargement', handler_id: ref.logUser }] });
    await soft('incident de livraison', async () => {
      const inc = await any(log, 'POST', `/shipments/${s1.id}/incidents`, { kind: 'damage', description: 'Quelques sacs déchirés au déchargement', quantity_kg: '4', handler_id: ref.logUser });
      await any(log, 'POST', `/shipment-incidents/${inc.id}/resolve`, { resolution: 'Constat établi avec le transporteur' });
    });
    const f = new FormData(); f.append('file', new Blob([pdf('bon de livraison signé')], { type: 'application/pdf' }), 'bl.pdf'); f.append('subject_type', 'shipment'); f.append('subject_id', s1.id); f.append('kind', 'proof_of_delivery');
    await any(log, 'POST', '/documents', undefined, f);
    await any(['responsable_tracabilite', 'direction', ADM], 'POST', `/shipments/${s1.id}/validate`, { note: 'Conforme' });
    const inv = await any(com, 'POST', '/invoices', { idempotency_key: key('i'), order_id: order.id, lines: [{ shipment_item_id: it.id, quantity_kg: '596' }] });
    await soft('paiement de facture', () => any(['comptable', 'responsable_financier', ADM], 'POST', `/invoices/${inv.id}/payments`, { idempotency_key: key('ip'), amount: '400000', received_on: days(-1), method: 'bank_transfer', reference: 'VIR-DEMO-001', account_id: bank.id }));
    await soft('réclamation de l\'acheteur', () => any(com, 'POST', '/sales-claims', { buyer_id: order.buyer_id, order_id: order.id, shipment_id: s1.id, invoice_id: inv.id, description: 'Quatre sacs reçus déchirés : demande de geste commercial.', amount_claimed: '6000' }));
    // 2) chargée et en route
    const s2 = await ship('400', al2);
    await any(log, 'POST', `/shipments/${s2.id}/load`, { seals: ['SC-010'], transport_doc_no: 'BL-DEMO-002' });
    await any(log, 'POST', `/shipments/${s2.id}/depart`, { bill_of_lading_no: 'MEDU0000002', port: 'San Pedro' });
  });

  // ── Inventaire : un approuvé, un en attente d'approbation
  await soft('inventaires', async () => {
    const mag = ['magasinier', 'responsable_magasin', ADM];
    const lotsNow = await call('GET', '/lots', as(ADM));
    const counted = (extra) => lotsNow.map((l) => ({ lot_id: l.id, counted_kg: String(Number(l.balance_kg) + extra), ...(extra ? { reason: 'Écart constaté au comptage (sacs humides)' } : {}) }));
    const sc = await any(mag, 'POST', '/stock-counts', { idempotency_key: key('inv'), warehouse_id: wh.id });
    await any(mag, 'POST', `/stock-counts/${sc.id}/counts`, { lines: counted(-3) });
    await any(mag, 'POST', `/stock-counts/${sc.id}/submit`, {});
    await any(['responsable_magasin', ADM], 'POST', `/stock-counts/${sc.id}/approve`, { note: 'Écart accepté après vérification' });
    const sc2 = await any(mag, 'POST', '/stock-counts', { idempotency_key: key('inv'), warehouse_id: wh.id });
    const lots2 = await call('GET', '/lots', as(ADM));
    await any(mag, 'POST', `/stock-counts/${sc2.id}/counts`, { lines: lots2.map((l) => ({ lot_id: l.id, counted_kg: String(Number(l.balance_kg)) })) });
    await any(mag, 'POST', `/stock-counts/${sc2.id}/submit`, {});
  });

  // ── Préfinancement reçu, utilisé, partiellement remboursé
  await soft('préfinancement', async () => {
    const fin = ['responsable_financier', ADM];
    const camp = (await call('GET', '/campaigns', as(ADM)))[0];
    const p = await any(fin, 'POST', '/prefinancings', { idempotency_key: key('pf'), funder: 'Fonds d\'appui agricole (fictif)', amount: '3000000', currency: 'XOF', account_id: bank.id, received_on: days(-20), conditions: 'Achat de fèves de la campagne et intrants. Remboursement en deux échéances.', campaign_id: camp?.id, value_chain_id: vc.id, due_date: days(90) });
    await any(fin, 'POST', `/prefinancings/${p.id}/uses`, { idempotency_key: key('pfu'), kind: 'advance', amount: '1200000', used_on: days(-12), purpose: 'Avances aux producteurs pour la récolte', document_ref: 'PIECE-AV-001' });
    await any(fin, 'POST', `/prefinancings/${p.id}/uses`, { idempotency_key: key('pfu'), kind: 'expense', amount: '250000', used_on: days(-8), purpose: 'Sacs et fournitures de magasin', document_ref: 'FACT-SAC-014' });
    await any(fin, 'POST', `/prefinancings/${p.id}/repayments`, { idempotency_key: key('pfr'), amount: '500000', paid_on: days(-3), reference: 'REMB-DEMO-1' });
  });

  // ── Paiements aux producteurs
  await soft('paiements', async () => {
    const fin = ['responsable_financier', 'comptable', ADM];
    for (const [i, m, amt] of [[0, 'mobile_money', '85000'], [1, 'bank_transfer', '120000'], [2, 'cash', '40000']]) {
      const pay = await any(fin, 'POST', '/payments', { idempotency_key: key('pay'), source_account_id: bank.id, payee_type: 'producer', payee_id: producers[i].id, amount: amt, method: m });
      if (i < 2) await soft(`initiation du paiement ${i + 1}`, () => any(fin, 'POST', `/payments/${pay.id}/transition`, { to: 'initiated', note: 'Ordre transmis' }));
      if (i < 2) await soft(`confirmation du paiement ${i + 1}`, () => any(['direction', 'responsable_financier', ADM], 'POST', `/payments/${pay.id}/confirm`, { confirmation_source: 'manual', note: 'Fonds remis au bénéficiaire' }));
    }
  });

  // ── Partenaires
  await soft('partenaires', async () => {
    const fin = ['responsable_financier', 'comptable', ADM];
    for (const [kind, name, phone] of [['supplier', 'Quincaillerie du Centre (fictif)', '+2250700000201'], ['supplier', 'Sacs & Emballages Hiré (fictif)', '+2250700000202'], ['client', 'Négoce Exemple SA (fictif)', '+2250700000203'], ['lender', 'Fonds d\'appui agricole (fictif)', '+2250700000204'], ['partner', 'ONG Agro-Avenir (fictif)', '+2250700000205']])
      await any(fin, 'POST', '/partners', { kind, name, phone, notes: 'Donnée de démonstration' });
  });

  // ── Documents rattachés (producteur, parcelle, lot)
  await soft('documents', async () => {
    const up = async (subject_type, subject_id, kind, name) => {
      const f = new FormData(); f.append('file', new Blob([pdf(name)], { type: 'application/pdf' }), name + '.pdf');
      f.append('subject_type', subject_type); f.append('subject_id', subject_id); f.append('kind', kind);
      await any(['responsable_tracabilite', 'agent_terrain', ADM], 'POST', '/documents', undefined, f);
    };
    await up('producer', producers[0].id, 'identity', 'fiche-producteur');
    await up('producer', producers[1].id, 'identity', 'fiche-producteur-2');
    await up('lot', lot.id, 'quality_report', 'rapport-lot');
    await up('declaration', (await call('GET', '/purchase-declarations', as(ADM)))[0].id, 'receipt_scan', 'recu-achat');
  });

  // ── Cartographie : zone protégée fictive + parcelle chevauchante + contrôle
  await soft('cartographie (couche, chevauchement, contrôle)', async () => {
    const cart = ['responsable_cartographie', 'cartographe', ADM];
    const sq = (lon, lat, s) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Forêt classée exemple (fictive)' }, geometry: sq(-5.9, 7.0, 0.0006) }] };
    const f = new FormData(); f.append('file', new Blob([JSON.stringify(fc)]), 'zone.geojson');
    for (const [k, v] of Object.entries({ name: 'Aires protégées (exemple fictif)', source: 'Démonstration', license: 'Libre', attribution: 'Données inventées' })) f.append(k, v);
    await soft('couche de référence', () => any(cart, 'POST', '/geo/layers', undefined, f));
    await soft('parcelle chevauchante', () => any(['cartographe', 'agent_terrain', ADM], 'POST', '/parcels', { idempotency_key: key('parcel'), producer_id: producers[11].id, value_chain_id: vc.id, declared_area_ha: '1.5', geometry: sq(-5.8903, 7.0003, 0.0009) }));
    await any(cart, 'POST', '/geo/checks/run', {});
  });

  // ── Terrain : modèles de fiches, relevés supplémentaires
  await soft('modèles de relevés', () => any(['adg', 'coach', ADM], 'POST', '/field-templates/defaults', {}));
  await soft('modèle de relevé personnalisé', () => any(['adg', ADM], 'POST', '/field-templates', { kind: 'infrastructure', category: 'Centre de santé', definition: { questions: [
    { key: 'nom', label: 'Nom du centre', type: 'text', required: true, options: [] }, { key: 'lits', label: 'Nombre de lits', type: 'number', required: true, options: [] }, { key: 'eau', label: 'Eau potable disponible', type: 'select', required: true, options: ['Oui', 'Non'] }] } }));
  await soft('relevés de terrain', async () => {
    const op = (kind, title, data, lat, lon) => ({ idempotency_key: key('fr'), type: 'field_record.create', payload: { id: crypto.randomUUID(), idempotency_key: key('frp'), kind, title, latitude: lat, longitude: lon, data } });
    const r = await call('POST', '/sync/batch', { ...as('agent_terrain'), body: { operations: [
      op('social_infrastructure', 'École primaire de Hiré', { type: 'Ecole', classes: 6, inscrits: 210 }, 6.1889859, -5.2903245),
      op('social_infrastructure', 'Puits villageois de Zoukougbeu', { type: 'Puits', profondeur_m: 32 }, 6.2, -5.3),
      op('training', 'Séance sur la taille des cacaoyers', { theme: 'Taille et entretien', participants: producers.slice(0, 4).map((x, i) => ({ producer_id: x.id, role: i ? 'participant' : 'principal', score: 70 + i * 5 })) }, 6.19, -5.29),
      op('training', 'Sensibilisation au travail des enfants', { theme: 'Protection des enfants', participants: producers.slice(4, 8).map((x) => ({ producer_id: x.id, role: 'participant', score: 80 })) }),
      op('distribution', 'Distribution d\'engrais', { category: 'Intrants et Outils', group: 'Engrais', article: 'NPK', quantity: 2, producer_id: producers[0].id }),
      op('distribution', 'Distribution de plants', { category: 'Intrants et Outils', group: 'Plants', article: 'Cacaoyer', quantity: 10, producer_id: producers[1].id }),
    ] } });
    const bad = (r.results ?? []).filter((x) => !['accepted', 'processed', 'applied'].includes(x.status));
    if (bad.length) throw new Error(`${bad.length} relevé(s) refusé(s) : ${bad[0].error ?? bad[0].status}`);
  });

  // ── Rapports programmés et exécutés (chaque destinataire retrouve les siens)
  await soft('rapports programmés et exécutés', async () => {
    const uid = async (role) => (await call('GET', '/users', as(ADM))).find((u) => u.email === byRole[role])?.id;
    const plan = [['stock', 'daily', ['responsable_magasin']], ['finance', 'daily', ['direction', 'responsable_financier']], ['quality', 'daily', ['responsable_qualite', 'responsable_tracabilite']], ['purchases', 'daily', ['responsable_tracabilite', 'adg']]];
    // Un rapport par destinataire : le serveur refuse la programmation si l'un d'eux n'a pas les droits de lecture.
    for (const [report, frequency, who] of plan) for (const role of who) await soft(`rapport ${report} pour ${role}`, async () => {
      const sch = await call('POST', '/report-schedules', { ...as(ADM), body: { report, frequency, hour: 6, recipients: [await uid(role)], send_email: false } });
      await call('POST', `/report-schedules/${sch.id}/run`, { ...as(ADM), body: {} });
    });
  });

  // ── Messagerie : échanges entre profils
  await soft('messages', async () => {
    const say = (from, to, body) => call('POST', '/messages', { ...as(from), body: { idempotency_key: key('m'), ...(to ? { to: J.accounts.find((a) => a.role === to) && undefined } : {}), body } });
    const id = async (role) => (await call('GET', '/users', as(ADM))).find((u) => u.email === byRole[role])?.id;
    const ids = {}; for (const r of ['magasinier', 'caissier', 'direction', 'responsable_tracabilite', 'comptable', 'responsable_logistique']) ids[r] = await id(r);
    const dm = (from, to, body) => call('POST', '/messages', { ...as(from), body: { idempotency_key: key('m'), to: ids[to], body } });
    await dm('direction', 'responsable_tracabilite', 'Bonjour Éric, merci de valider les achats restés en attente avant vendredi.');
    await dm('responsable_tracabilite', 'direction', 'C\'est noté, je m\'en occupe cet après-midi.');
    await dm('magasinier', 'caissier', 'Le convoi SC000000-2026-BRA-3 arrive demain matin, prévoir le règlement.');
    await dm('comptable', 'direction', 'Les écritures de la semaine sont passées, le rapprochement bancaire est à faire.');
    await dm('responsable_logistique', 'magasinier', 'Le camion CI-2210-AB passera au magasin à 14 h pour le chargement.');
    await call('POST', '/messages', { ...as('direction'), body: { idempotency_key: key('m'), body: 'Réunion de coordination jeudi à 16 h pour toute l\'équipe.' } });
    await call('POST', '/notifications/scan', { ...as(ADM), body: {} }).catch(() => null);
  });

  // ── Circuit exportateur : supervision, audit, livraisons pesées / analysées / réglées
  if (E) {
    await soft('supervision et audit', async () => {
      const orgs = await call('GET', '/organizations', as(ADM));
      const coopCode = (orgs.find((o) => o.id === C) ?? {}).code;
      const sp = await call('POST', '/supervisions', { ...asE('exp_admin'), body: { code: coopCode } });
      await call('POST', `/supervisions/${sp.id}/accept`, { ...as(ADM), body: {} });
      const au = await call('POST', '/audits', { ...asE('exp_admin'), body: { supervised_org_id: C, title: 'Audit traçabilité et pesées', scope: ['tracabilite', 'pesee'], starts_on: days(-10), ends_on: days(20) } });
      const au2 = await call('POST', '/audits', { ...asE('exp_admin'), body: { supervised_org_id: C, title: 'Audit caisse et comptabilité (programmé)', scope: ['caisse', 'comptabilite'], starts_on: days(15), ends_on: days(30) } });
      void au2;
      await call('POST', `/audits/${au.id}/start`, { ...asE('exp_admin'), body: {} });
      const cand = await call('GET', `/audits/${au.id}/candidates`, as(ADM));
      for (const c of cand.slice(0, 3)) await soft('participant', () => call('POST', `/audits/${au.id}/participants`, { ...as(ADM), body: { user_id: c.id ?? c.user_id } }));
      await soft('extrait partagé', () => call('POST', `/audits/${au.id}/shares`, { ...as(ADM), body: { kind: 'snapshot', title: 'Achats déclarés', view: 'declarations' } }));
      const f = new FormData(); f.append('file', new Blob([pdf('registre de pesée')], { type: 'application/pdf' }), 'registre.pdf'); f.append('title', 'Registre de pesée');
      await soft('document partagé', () => call('POST', `/audits/${au.id}/shares/document`, { ...as(ADM), form: f }));
      await call('POST', `/audits/${au.id}/shares`, { ...asE('exp_admin'), body: { kind: 'note', title: 'Documents attendus', body: 'Merci de fournir les registres de pesée de la campagne.' } });
      await call('POST', `/audits/${au.id}/findings`, { ...asE('exp_admin'), body: { area: 'pesee', result: 'minor', requirement: 'Registre de pesée tenu à jour', description: 'Deux pesées sans signature du magasinier.' } });
      await call('POST', `/audits/${au.id}/findings`, { ...asE('exp_admin'), body: { area: 'tracabilite', result: 'conform', requirement: 'Traçabilité des achats jusqu\'au producteur', description: 'Les achats contrôlés remontent bien aux producteurs.' } });
      await soft('publication des constats', () => call('POST', `/audits/${au.id}/issue`, { ...asE('exp_admin'), body: {} }));
    });

    await soft('livraisons à l\'exportateur', async () => {
      const convs = await call('GET', '/dispatch-sheets/convoys', as(ADM));
      const ids = convs.map((c) => c.id);
      if (!ids.length) throw new Error('aucun convoi réceptionné disponible');
      const sheet = async (cid, n) => {
        const sh = await any(['responsable_logistique', 'responsable_tracabilite', ADM], 'POST', '/dispatch-sheets', { convoy_ids: [cid], bl_no: 'BL-DEMO-' + n, lot_id_dse: 'DSE-DEMO-' + n, driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', departure_date: days(-2 + n) });
        return any(['responsable_logistique', 'responsable_tracabilite', ADM], 'POST', `/dispatch-sheets/${sh.id}/transmit`, { destination_org_id: E });
      };
      await sheet(ids[0], 1);
      if (ids[1]) await sheet(ids[1], 2);
      const dels = await call('GET', '/deliveries', asE('exp_admin'));
      const [d1, d2] = dels;
      if (d1) {
        const decl = Number(d1.declared_kg ?? d1.declared_net_kg ?? 1000);
        await call('POST', `/deliveries/${d1.id}/weigh-in`, { ...asE('pont_bascule'), body: { gross_kg: decl + 8000, origin: 'Hiré', transporter: 'Transafrik Logistique', bridge_in: 'PONT 1' } });
        await call('POST', `/deliveries/${d1.id}/weigh-out`, { ...asE('pont_bascule'), body: { tare_kg: 8000, bags_discharged: 40, bags_refused: 0, sack_tare_kg: 20, pallet_tare_kg: 0, bridge_out: 'PONT 2' } });
        await call('POST', `/deliveries/${d1.id}/analysis`, { ...asE('analyste'), body: { moisture_pct: 7.2, bean_count: 98, defects: { mouldy: 1, slaty: 2, insect: 0.5, residues: 2, crabots: 2 }, refaction_kg: 12, grade: 'GRADE 1', decision: 'accepted' } });
        await call('POST', `/deliveries/${d1.id}/settle`, { ...asE('exp_caissier'), body: { unit_price: 1500, payment_ref: 'VIR-EXP-001' } });
      }
      if (d2) {
        const decl = Number(d2.declared_kg ?? d2.declared_net_kg ?? 1000);
        await call('POST', `/deliveries/${d2.id}/weigh-in`, { ...asE('pont_bascule'), body: { gross_kg: decl + 8000, origin: 'Hiré', transporter: 'Transafrik Logistique', bridge_in: 'PONT 1' } });
        await call('POST', `/deliveries/${d2.id}/weigh-out`, { ...asE('pont_bascule'), body: { tare_kg: 8000, bags_discharged: 28, bags_refused: 2, sack_tare_kg: 14, pallet_tare_kg: 0, bridge_out: 'PONT 2' } });
      }
    });

    // Exportateur : comptes, campagne, produit, caisse, partenaires (écrans du caissier et de l'administrateur)
    await soft('configuration de l\'exportateur', async () => {
      const A = asE('exp_admin');
      const v = await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao' } });
      const camp = await call('POST', '/campaigns', { ...A, body: { value_chain_id: v.id, code: 'GT2627', name: 'Grande traite 2026-2027', traite: 'grande', starts_on: '2026-10-01', ends_on: '2027-03-31' } });
      await soft('produit exportateur', () => call('POST', '/products', { ...A, body: { name: 'Cacao (fèves)', buy_price_per_kg: '1500', sell_price_per_kg: '2200', campaign_id: camp.id } }));
      await soft('compte bancaire exportateur', async () => {
        const b = await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'Banque exportateur (fictif)' } });
        await call('POST', '/financial-transactions', { ...A, body: { idempotency_key: key('bank'), account_id: b.id, direction: 'in', amount: '50000000', reason: 'Approvisionnement du compte' } });
      });
      await soft('caisse exportateur', async () => {
        const reg = await call('POST', '/cash-registers', { ...A, body: { name: 'Caisse exportateur' } });
        await call('POST', `/cash-registers/${reg.id}/sessions`, { ...asE('exp_caissier'), body: { opening_amount: '2000000' } });
      });
      for (const [kind, name] of [['supplier', 'Fournitures Pont-bascule (fictif)'], ['client', 'Chocolaterie Exemple (fictif)']])
        await soft('partenaire exportateur', () => call('POST', '/partners', { ...A, body: { kind, name, notes: 'Donnée de démonstration' } }));
    });
  }

  console.log(`\nDonnées d'exemple ajoutées${warnings.length ? ` — ${warnings.length} étape(s) ignorée(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('enrichissement :', e.message); process.exit(1); });
