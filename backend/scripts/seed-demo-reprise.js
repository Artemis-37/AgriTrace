// Reprise de la démonstration : complète une coopérative DÉJÀ créée (producteurs et parcelles importés) avec toute la chaîne fictive :
// comptes de chaque profil, délégués, achats, pesées, reçus, convois, caisse, banque, prêts, qualité, ventes… puis les compléments
// (enrichi, supplement, chaine, activite). Peut être relancé sans danger : ce qui existe déjà est réutilisé.
// Usage : API=https://…/v1 DEMO_RESUME_ADMIN=admin@demo.agritrace.test node scripts/seed-demo-reprise.js
// Seul le compte de l'administrateur de la coopérative est nécessaire ; la partie « exportateur » (organisation à part) exige un administrateur de plateforme.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API = process.env.API || 'http://localhost:3000/v1';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo-AgriTrace-2026!';
const DOMAIN = process.env.DEMO_DOMAIN || 'demo.agritrace.test';
const ADMIN = process.env.DEMO_RESUME_ADMIN || `admin@${DOMAIN}`;
const run = crypto.randomBytes(2).toString('hex');
const OUT = process.env.DEMO_JSON || '/tmp/demo-accounts.json';

/** Les serveurs en ligne limitent le débit : sur « 429 » on attend puis on recommence (plus lent, mais complet). */
async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (![429, 502, 503, 504].includes(r.status) || i >= 30) return r;
    await new Promise((s) => setTimeout(s, (Number(r.headers.get('retry-after')) || 6) * 1000));
  }
}
async function call(method, p, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetchRetry(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${t.slice(0, 200)}`);
  return j;
}
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const warnings = [];
async function soft(label, fn) { try { return await fn(); } catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; } }
const step = (m) => console.log('•', m);

const PROFILS = [
  ['magasinier', 'Magasinier', 'Mamadou Coulibaly'], ['caissier', 'Caissier / caissière', 'Aya Kouamé'], ['comptable', 'Comptable', 'Salif Ouédraogo'],
  ['direction', 'Direction', 'Nathalie Boni'], ['responsable_tracabilite', 'Responsable traçabilité', 'Éric Tano'], ['responsable_cartographie', 'Responsable cartographie', 'Clarisse Ahoua'],
  ['cartographe', 'Cartographe', 'Jean-Marc Gnahoré'], ['agent_terrain', 'Agent de terrain', 'Rosine Yapi'], ['responsable_magasin', 'Responsable de magasin', 'Daouda Fofana'],
  ['responsable_financier', 'Responsable financier', 'Estelle Aké'], ['responsable_qualite', 'Responsable qualité', 'Hortense Zadi'], ['responsable_logistique', 'Responsable logistique', 'Lassina Cissé'],
  ['auditeur', 'Auditeur (lecture seule)', 'Patrick Dago'], ['acheteur', 'Acheteur / commercial', 'Fanta Kamara'], ['collecteur', 'Collecteur (application téléphone)', 'Brahima Sylla'],
  ['adg', 'Assistant de direction générale', 'Mireille Ouattara'], ['coach', 'Coach / conseiller agricole', 'Gilbert Koffi'], ['exportateur', 'Exportateur (partenaire)', 'Karim Diallo'],
];
const arr = (r) => (Array.isArray(r) ? r : r?.items ?? []);

(async () => {
  const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).access_token;
  const t0 = await login(ADMIN);
  const org = (await call('GET', '/organizations', { token: t0 }))[0];
  const A = { token: t0, org: org.id };
  console.log(`Reprise dans « ${org.name} » (${org.code})`);

  // Code CCC de la coopérative (fictif) : nécessaire à la numérotation automatique des convois
  await soft('profil de la coopérative', async () => {
    const cur = await call('GET', '/organization/profile', A);
    if (!cur?.ccc_code) await call('PUT', '/organization/profile', { ...A, body: { ccc_code: 'SC000000', currency: cur?.currency ?? 'XOF' } });
  });

  // ── Référentiels existants (créés au besoin)
  const vcs = arr(await call('GET', '/value-chains', A));
  const vc = vcs.find((x) => x.code === 'CACAO') ?? await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao' } });
  const cafe = vcs.find((x) => x.code === 'CAFE');
  await soft('conversion sac→kg', async () => { if (!arr(await call('GET', '/unit-conversions', A)).some((c) => c.from_unit === 'sac' && c.value_chain_id === vc.id)) await call('POST', '/unit-conversions', { ...A, body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } }); });
  let camps = arr(await call('GET', '/campaigns', A));
  let camp = camps.find((c) => c.value_chain_id === vc.id && c.traite === 'grande') ?? camps.find((c) => c.value_chain_id === vc.id);
  if (!camp) camp = await call('POST', '/campaigns', { ...A, body: { value_chain_id: vc.id, code: 'GT2627', name: 'Grande traite 2026-2027', traite: 'grande', starts_on: '2026-10-01', ends_on: '2027-03-31' } });
  await soft('prix de la traite', async () => {
    const s = await call('POST', '/price-schedules', { ...A, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } });
    await call('POST', `/price-schedules/${s.id}/versions`, { ...A, body: { unit_price: '1000', valid_from: '2026-10-01' } });
  });
  let wh = arr(await call('GET', '/warehouses', A))[0] ?? await call('POST', '/warehouses', { ...A, body: { code: 'MAG1', name: 'Magasin central' } });
  let cacao = arr(await call('GET', '/products', A)).find((p) => p.value_chain_id === vc.id || /cacao/i.test(p.name)) ?? await call('POST', '/products', { ...A, body: { name: 'Cacao (fèves)', buy_price_per_kg: '1000', sell_price_per_kg: '1500', campaign_id: camp.id } });
  step('référentiels prêts');

  // ── Un compte par profil (ceux qui existent déjà sont conservés)
  const existing = arr(await call('GET', '/users', A));
  const accounts = [{ role: 'coop_admin', label: 'Administrateur de la coopérative', name: 'Adjoua Konan', email: ADMIN }];
  const users = {};
  const mk = async (code, name, email) => {
    let u = existing.find((x) => x.email === email);
    if (!u) {
      const r = await call('POST', '/roles/standard', { ...A, body: { code } });
      u = await call('POST', '/users', { ...A, body: { email, full_name: name, password: PASSWORD, role_id: r.id } });
    }
    return { id: u.id, email, token: await login(email) };
  };
  for (const [code, label, name] of PROFILS) {
    const email = `${code.replace(/_/g, '.')}@${DOMAIN}`;
    users[code] = await mk(code, name, email);
    accounts.push({ role: code, label, name, email });
  }
  const U = (c) => ({ token: users[c].token, org: org.id });
  step(`${accounts.length} comptes`);
  const tr = accounts.find((x) => x.role === 'responsable_tracabilite');
  for (const code of ['responsable_cartographie', 'responsable_qualite', 'responsable_logistique']) {
    const rr = await call('POST', '/roles/standard', { ...A, body: { code } });
    await soft('rôle supplémentaire ' + code, () => call('POST', `/users/${users.responsable_tracabilite.id}/roles`, { ...A, body: { role_id: rr.id, reason: 'Démonstration : cumul de rôles' } }));
  }
  tr.label = 'Responsable traçabilité — **plusieurs rôles** : + responsable cartographie, responsable qualité, responsable logistique';

  // ── Délégués (collecteurs)
  const cols = arr(await call('GET', '/collectors', A));
  const email2 = `collecteur2@${DOMAIN}`;
  users.collecteur2 = await mk('collecteur', 'Yao Kouassi', email2);
  const mkCol = async (uid, origin, bank, acct, doc, no) => {
    let c = cols.find((x) => x.user_id === uid);
    if (!c) {
      c = await call('POST', '/collectors', { ...A, body: { user_id: uid } });
      await call('POST', `/collectors/${c.id}/assignments`, { ...A, body: { value_chain_id: vc.id } });
      await call('PUT', `/collectors/${c.id}/rates`, { ...A, body: { transport_per_kg: '15', retention_per_kg: '10' } });
      await soft('fiche du délégué', () => call('PUT', `/collectors/${c.id}/profile`, { ...A, body: { origin, bank_name: bank, bank_account: acct, id_doc_type: doc, id_doc_no: no } }));
    }
    return c;
  };
  const col = await mkCol(users.collecteur.id, 'Divo', 'Banque Exemple (fictive)', 'CI000 01234 56789 01', 'cni', 'C0012345678');
  const col2 = await mkCol(users.collecteur2.id, 'Hiré', 'Caisse d\'épargne exemple (fictive)', 'CI000 98765 43210 02', 'attestation', 'AT-2026-0456');
  if (cafe) await soft('délégué multi-filières', async () => {
    await call('POST', `/collectors/${col.id}/assignments`, { ...A, body: { value_chain_id: cafe.id } });
    await call('PUT', `/collectors/${col.id}/rates`, { ...A, body: { value_chain_id: cafe.id, transport_per_kg: '25', retention_per_kg: '8' } });
  });
  const delegate2 = { name: 'Yao Kouassi', email: email2, collector_id: col2.id };
  step('délégués');

  // ── Producteurs et parcelles fournis : on en prend un échantillon réparti sur toute la liste
  let all = [];
  for (let off = 0; off < 2000; off += 200) { const p = arr(await call('GET', `/producers?limit=200&offset=${off}&value_chain_id=${vc.id}`, A)); all = all.concat(p); if (p.length < 200) break; }
  const withParcel = all.filter((p) => p.parcels_count > 0);
  const pool = withParcel.length >= 24 ? withParcel : all;
  const stride = Math.max(1, Math.floor(pool.length / 40));
  const producers = pool.filter((_, i) => i % stride === 0).slice(0, 40);
  console.log(`  ${all.length} producteurs dans la coopérative, ${producers.length} retenus pour les opérations`);

  // ── Contrôle de quelques parcelles par la cartographie
  const parcels = arr(await call('GET', '/parcels', A));
  for (const pc of parcels.filter((x) => x.geometry_area_ha != null && x.verification_status !== 'verified' && Math.abs(Number(x.geometry_area_ha) - Number(x.declared_area_ha)) <= 0.15 * Number(x.declared_area_ha)).slice(0, 3))
    await soft('contrôle parcelle', () => call('POST', `/parcels/${pc.id}/control`, { ...U('responsable_cartographie'), body: {} }));

  // ── Achats : déclaration (délégué) → validation → pesée → reçu (magasinier)
  let lotId = null;
  const NB = 36;
  for (let i = 0; i < NB; i++) {
    const id = crypto.randomUUID(), q = 2 + (i % 4), pr = producers[i % producers.length];
    const ok = await soft('déclaration d\'achat', async () => {
      await call('POST', '/purchase-declarations', { ...U('collecteur'), body: { id, idempotency_key: key('decl'), producer_id: pr.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: days(Math.min(-20 + i, -1)), quantity: String(q), unit: 'sac', bags: q, purchase_receipt_no: 'ACH-' + String(1000 + i) } });
      await call('POST', `/purchase-declarations/${id}/submit`, U('collecteur'));
      return true;
    });
    if (!ok || i >= 24) continue; // les dernières restent « soumises » : à valider par le responsable traçabilité
    await soft('validation de l\'achat', async () => {
      await call('POST', `/purchase-declarations/${id}/transition`, { ...A, body: { to: 'in_review' } });
      await call('POST', `/purchase-declarations/${id}/transition`, { ...A, body: { to: 'accepted' } });
      const w = await call('POST', '/weighings', { ...A, body: { idempotency_key: key('w'), declaration_id: id, warehouse_id: wh.id, gross_kg: String(q * 65 + 5), tare_kg: '5' } });
      const r = await call('POST', '/receipts', { ...U('magasinier'), body: { weighing_id: w.id, ...(lotId ? { lot_id: lotId } : {}) } });
      lotId = lotId ?? r.lot_id;
    });
  }
  step('achats, pesées et reçus');

  // ── Convois, caisse, banque
  const avail = arr(await soft('achats à charger', () => call('GET', '/convoys/available-declarations', U('collecteur'))) ?? []);
  let at = 0; const take = (n) => { const r = avail.slice(at, at + n).map((d) => d.id); at += n; return r; };
  const cv = (kg, n) => call('POST', '/convoys', { ...U('collecteur'), body: { idempotency_key: key('cv'), driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', declared_bags: 40, declared_kg: kg, ...(n ? { declaration_ids: take(n) } : {}) } });
  const convoys = [];
  const reg = arr(await call('GET', '/cash-registers', A))[0] ?? await call('POST', '/cash-registers', { ...A, body: { name: 'Caisse principale' } });
  let sess = await soft('session de caisse', async () => {
    return call('POST', `/cash-registers/${reg.id}/sessions`, { ...U('caissier'), body: { opening_amount: '5000000' } });
  });
  const c1 = await soft('convoi 1', () => cv('2600', 4)); if (c1) convoys.push(c1.convoy_no);
  const rec = c1 && await soft('réception du convoi', () => call('POST', '/convoys/receive', { ...U('magasinier'), body: { idempotency_key: key('rc'), collector_id: col.id, convoy_no: c1.convoy_no, warehouse_id: wh.id, product_id: cacao.id, campaign_id: camp.id, total_kg: '2587.500', bags: 40 } }));
  if (rec) await soft('règlement du convoi', () => call('POST', `/convoy-receptions/${rec.id}/settle`, { ...U('caissier'), body: { idempotency_key: key('st') } }));
  await soft('compte bancaire', async () => {
    const bank = await call('POST', '/financial-accounts', { ...A, body: { owner_type: 'other', name: 'Banque (compte courant) — fictif' } });
    await call('POST', '/financial-transactions', { ...A, body: { idempotency_key: key('bank'), account_id: bank.id, direction: 'in', amount: '10000000', reason: 'Approvisionnement du compte bancaire' } });
  });
  const c2 = await soft('convoi 2', () => cv('1800', 3)); if (c2) convoys.push(c2.convoy_no);
  const rec2 = c2 && await soft('2e réception', () => call('POST', '/convoys/receive', { ...U('magasinier'), body: { idempotency_key: key('rc'), collector_id: col.id, convoy_no: c2.convoy_no, warehouse_id: wh.id, product_id: cacao.id, campaign_id: camp.id, total_kg: '1795', bags: 28 } }));
  const c3 = await soft('convoi 3', () => cv('2100', 3)); if (c3) convoys.push(c3.convoy_no);
  step('convois');

  if (sess) {
    const tx = (direction, amount, reason) => call('POST', '/financial-transactions', { ...U('caissier'), body: { idempotency_key: key('tx'), account_id: reg.account_id, cash_session_id: sess.id, direction, amount, reason } });
    await soft('opérations de caisse', async () => { await tx('in', '800000', 'Versement de l\'acheteur (avance)'); await tx('out', '45000', 'Achat de fournitures de bureau'); await tx('out', '120000', 'Frais de transport'); });
  }
  await soft('écritures comptables', async () => {
    const e = (label, lines, d) => call('POST', '/accounting/entries', { ...U('comptable'), body: { idempotency_key: key('ac'), journal: 'OD', entry_date: days(d), label, lines } });
    await e('Cotisations annuelles des membres', [{ code: '571', debit: '150000' }, { code: '758', credit: '150000' }], -10);
    await e('Entretien du magasin', [{ code: '605', debit: '60000' }, { code: '571', credit: '60000' }], -6);
  });
  await soft('prêt', () => call('POST', '/loans', { ...A, body: { idempotency_key: key('loan'), kind: 'prefinancing', borrower_type: 'producer', borrower_id: producers[0].id, amount: '90000', purpose: 'Intrants et main-d\'œuvre' } }));
  await soft('prêt approuvé', async () => {
    const l2 = await call('POST', '/loans', { ...A, body: { idempotency_key: key('loan'), kind: 'prefinancing', borrower_type: 'producer', borrower_id: producers[1].id, amount: '60000', purpose: 'Achat de sacs' } });
    await call('POST', `/loans/${l2.id}/approve`, { ...U('direction'), body: { installments: [{ due_date: days(60), amount: '30000' }, { due_date: days(120), amount: '30000' }] } });
  });
  if (lotId) await soft('qualité', async () => {
    const rule = await call('POST', '/quality-rules', { ...U('responsable_qualite'), body: { code: 'HUMIDITE', label: 'Humidité (%)', kind: 'numeric', max_value: '8', unit: '%', blocking: true, value_chain_id: vc.id } });
    const insp = await call('POST', '/inspections', { ...U('responsable_qualite'), body: { idempotency_key: key('insp'), subject_type: 'lot', subject_id: lotId, kind: 'quality' } });
    await call('POST', `/inspections/${insp.id}/start`, U('responsable_qualite'));
    await call('POST', `/inspections/${insp.id}/results`, { ...U('responsable_qualite'), body: { results: [{ rule_id: rule.id, value_num: '7.2' }] } });
    await call('POST', `/inspections/${insp.id}/complete`, { ...U('responsable_qualite'), body: { summary: 'Humidité conforme' } });
  });
  await soft('certificat', () => call('POST', '/certificates', { ...A, body: { holder_type: 'organization', scheme: 'Label durable (exemple fictif)', number: 'DEMO-001', issuer: 'Organisme fictif', issued_on: days(-340), expires_on: days(25) } }));
  await soft('ventes', async () => {
    const b = await call('POST', '/buyers', { ...A, body: { code: 'ACHETEUR1', name: 'Négoce Exemple SA (fictif)', country: 'FR', currency: 'XOF', payment_terms_days: 30 } });
    const ct = await call('POST', '/sales-contracts', { ...A, body: { number: 'CT-DEMO-001', buyer_id: b.id, value_chain_id: vc.id, starts_on: days(-30), ends_on: days(300), quantity_kg: '20000', unit_price: '1500' } });
    await call('POST', '/sales-orders', { ...A, body: { idempotency_key: key('o'), buyer_id: b.id, value_chain_id: vc.id, contract_id: ct.id, lines: [{ description: 'Cacao fèves', quantity_kg: '2000', unit_price: '1500' }] } });
  });
  await soft('tâches', async () => {
    for (const [titre, cat, prio, d, i] of [['Visite de la parcelle de ' + producers[0].first_names + ' ' + producers[0].last_name, 'visit', 'normal', 3, 0], ['Séance de formation taille et entretien', 'training', 'high', 8, 2], ['Contrôle des limites de la parcelle de ' + producers[8].last_name, 'control', 'normal', 5, 8]])
      await call('POST', '/tasks', { ...A, body: { idempotency_key: key('task'), title: titre, category: cat, priority: prio, due_date: days(d), producer_id: producers[i].id, assignee_id: users.agent_terrain.id, publish: true, expected_result: 'Compte rendu avec photos', validation_criteria: 'Rapport complet', instructions: 'Voir la fiche du producteur.' } });
  });
  if (rec2) await soft('demande d\'annulation', () => call('POST', '/cancellation-requests', { ...U('magasinier'), body: { entity_type: 'convoy_reception', entity_id: rec2.id, reason: 'Poids saisi par erreur (1 795 au lieu de 1 759)' } }));
  await soft('rapport programmé', () => call('POST', '/report-schedules', { ...A, body: { report: 'finance', frequency: 'weekly', weekday: 1, recipients: [users.direction.id] } }));

  // ── Fichier d'accès, puis les compléments (mêmes scripts que la démonstration complète ; l'exportateur est ignoré faute d'administrateur de plateforme)
  fs.writeFileSync(OUT, JSON.stringify({ org: org.id, exporter: null, password: PASSWORD, accounts, convoys, delegate2 }, null, 2));
  for (const f of ['seed-demo-enrichi.js', 'seed-demo-supplement.js', 'seed-demo-chaine.js', 'seed-demo-activite.js', 'seed-demo-modules.js']) {
    step(f);
    try { require('child_process').execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', env: { ...process.env, DEMO_JSON: OUT } }); }
    catch { warnings.push(f + ' : voir les messages ci-dessus'); }
  }
  console.log(`\nChaîne fictive chargée dans « ${org.name} » : ${accounts.length} comptes (mot de passe : ${PASSWORD}).`);
  if (warnings.length) console.log(`\n${warnings.length} étape(s) ignorée(s) :\n - ` + warnings.join('\n - '));
})().catch((e) => { console.error(e.message); process.exit(1); });
