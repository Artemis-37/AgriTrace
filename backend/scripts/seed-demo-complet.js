// Version de démonstration complète : coopérative FICTIVE, un compte par profil, données d'exemple.
// NE PAS exécuter en production. Les noms, montants et coordonnées sont inventés.
//
// Usage :
//   API=http://localhost:3000/v1 ADMIN_EMAIL=<admin plateforme> ADMIN_PASSWORD=<...> node scripts/seed-demo-complet.js
// Variables facultatives : DEMO_PASSWORD (défaut ci-dessous), DEMO_DOMAIN (défaut demo.agritrace.test), DEMO_CODE (défaut DEMO).
// Écrit docs/COMPTES_DEMO.md (liste des accès) sauf si DEMO_NO_DOC=1.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API = process.env.API || 'http://localhost:3000/v1';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo-AgriTrace-2026!';
const DOMAIN = process.env.DEMO_DOMAIN || 'demo.agritrace.test';
const CODE = process.env.DEMO_CODE || 'DEMO';
const run = crypto.randomBytes(2).toString('hex');
if (PASSWORD.length < 12) { console.error('DEMO_PASSWORD : 12 caractères minimum'); process.exit(1); }

async function call(method, p, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${t.slice(0, 220)}`);
  return j;
}
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const warnings = [];
async function soft(label, fn) { try { return await fn(); } catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; } }

// Profils : code du modèle de rôle → [libellé du compte, nom affiché]
const PROFILS = [
  ['magasinier', 'Magasinier', 'Mamadou Coulibaly'],
  ['caissier', 'Caissier / caissière', 'Aya Kouamé'],
  ['comptable', 'Comptable', 'Salif Ouédraogo'],
  ['direction', 'Direction', 'Nathalie Boni'],
  ['responsable_tracabilite', 'Responsable traçabilité', 'Éric Tano'],
  ['responsable_cartographie', 'Responsable cartographie', 'Clarisse Ahoua'],
  ['cartographe', 'Cartographe', 'Jean-Marc Gnahoré'],
  ['agent_terrain', 'Agent de terrain', 'Rosine Yapi'],
  ['responsable_magasin', 'Responsable de magasin', 'Daouda Fofana'],
  ['responsable_financier', 'Responsable financier', 'Estelle Aké'],
  ['responsable_qualite', 'Responsable qualité', 'Hortense Zadi'],
  ['responsable_logistique', 'Responsable logistique', 'Lassina Cissé'],
  ['auditeur', 'Auditeur (lecture seule)', 'Patrick Dago'],
  ['acheteur', 'Acheteur / commercial', 'Fanta Kamara'],
  ['collecteur', 'Collecteur (application téléphone)', 'Brahima Sylla'],
  ['adg', 'Assistant de direction générale', 'Mireille Ouattara'],
  ['coach', 'Coach / conseiller agricole', 'Gilbert Koffi'],
  ['exportateur', 'Exportateur (partenaire)', 'Karim Diallo'],
];

(async () => {
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).access_token;
  const org = await call('POST', '/organizations', { token: adm, body: { code: CODE + run.toUpperCase(), name: 'Coopérative Agricole de Démonstration' } });
  const adminEmail = `admin@${DOMAIN}`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: adminEmail, full_name: 'Adjoua Konan (administratrice)', password: PASSWORD } });
  const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).access_token;
  const t0 = await login(adminEmail);
  const A = { token: t0, org: org.id };

  // ── Profil de la coopérative
  await soft('profil', () => call('PUT', '/organization/profile', { ...A, body: { phone: '+225 27 00 00 00 00', email: `contact@${DOMAIN}`, address: 'Zone industrielle, Hiré (fictif)', currency: 'XOF', ccc_code: 'SC000000' } }));

  await soft('logo', async () => {
    const f = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'brand', 'logo-cooperative-demo.png'));
    const form = new FormData(); form.append('file', new Blob([f]), 'logo.png');
    const r = await fetch(API + '/organization/logo', { method: 'PUT', headers: { authorization: 'Bearer ' + t0, 'x-organization-id': org.id }, body: form });
    if (!r.ok) throw new Error('logo ' + r.status);
  });

  // ── Filière, campagne, prix
  const vc = await call('POST', '/value-chains', { ...A, body: { code: 'CACAO', name: 'Cacao' } });
  await call('POST', '/unit-conversions', { ...A, body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = await call('POST', '/campaigns', { ...A, body: { value_chain_id: vc.id, code: 'C2627', name: 'Campagne 2026-2027', starts_on: '2026-10-01', ends_on: '2027-09-30' } });
  const sched = await call('POST', '/price-schedules', { ...A, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } });
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...A, body: { unit_price: '1000', valid_from: '2026-10-01' } });
  const wh = await call('POST', '/warehouses', { ...A, body: { code: 'MAG1', name: 'Magasin central' } });

  // ── Comptes : un par profil
  const accounts = [{ role: 'coop_admin', label: 'Administrateur de la coopérative', name: 'Adjoua Konan', email: adminEmail }];
  const users = {};
  for (const [code, label, name] of PROFILS) {
    const r = await call('POST', '/roles/standard', { ...A, body: { code } });
    const email = `${code.replace(/_/g, '.')}@${DOMAIN}`;
    const u = await call('POST', '/users', { ...A, body: { email, full_name: name, password: PASSWORD, role_id: r.id } });
    users[code] = { id: u.id, email, token: await login(email) };
    accounts.push({ role: code, label, name, email });
  }
  const U = (c) => ({ token: users[c].token, org: org.id });

  // ── Collecteurs (le compte « collecteur » + un second pour les rapprochements)
  const col = await call('POST', '/collectors', { ...A, body: { user_id: users.collecteur.id } });
  await call('POST', `/collectors/${col.id}/assignments`, { ...A, body: { value_chain_id: vc.id } });

  // ── Producteurs et parcelles (coordonnées fictives)
  const noms = [['KONE', 'Awa', 'Hiré'], ['TRAORE', 'Moussa', 'Zoukougbeu'], ['YAO', 'Kouadio', 'Hiré'], ['KOUASSI', 'Adjoua', 'Tiassalé'], ['BAMBA', 'Seydou', 'Hiré'],
    ['DIALLO', 'Fatoumata', 'Zoukougbeu'], ['N\'GUESSAN', 'Affoué', 'Hiré'], ['OUATTARA', 'Ibrahim', 'Tiassalé'], ['KOFFI', 'Yves', 'Hiré'], ['SANGARE', 'Mariam', 'Zoukougbeu'],
    ['ADJE', 'Sylvain', 'Hiré'], ['TAPE', 'Joséphine', 'Tiassalé'], ['GOUE', 'Arsène', 'Zoukougbeu'], ['BEUGRE', 'Colette', 'Hiré'], ['DJEDJE', 'Anselme', 'Tiassalé']];
  const producers = [];
  let n = 0;
  for (const [l, f, v] of noms) {
    n++;
    producers.push((await call('POST', '/producers', { ...U('agent_terrain'), body: { last_name: l, first_names: f, village: v, section: v === 'Hiré' ? 'S1' : v === 'Tiassalé' ? 'S3' : 'S2', phone: '+2250700' + String(10000 + n * 137).slice(0, 5) + String(n).padStart(1, '0'), value_chain_ids: [vc.id] } })).producer);
  }
  const centres = [[-5.9, 7.0], [-5.89, 7.01], [-5.91, 7.02], [-5.88, 7.0], [-5.92, 7.03], [-5.87, 7.02], [-5.93, 7.01], [-5.86, 7.03], [-5.9, 7.04], [-5.88, 7.05]];
  const parcels = [];
  for (let i = 0; i < centres.length; i++) {
    const [lon, lat] = centres[i], s = 0.0009 + (i % 3) * 0.0002;
    parcels.push(await call('POST', '/parcels', { ...U('cartographe'), body: { idempotency_key: key('parcel'), producer_id: producers[i].id, value_chain_id: vc.id, declared_area_ha: String(1 + (i % 4) * 0.5),
      geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] } } }));
  }
  await soft('parcelle sans tracé', () => call('POST', '/parcels', { ...U('agent_terrain'), body: { idempotency_key: key('parcel'), producer_id: producers[10].id, value_chain_id: vc.id, declared_area_ha: '2.5' } }));
  await soft('contrôle parcelle', () => call('POST', `/parcels/${parcels[0].id}/control`, { ...U('responsable_cartographie'), body: {} }));

  // ── Achats : déclarations (collecteur) → validation → pesées (admin) → reçus (magasinier)
  let lotId = null;
  for (let i = 0; i < 12; i++) {
    const id = crypto.randomUUID();
    const q = 2 + (i % 4);
    await call('POST', '/purchase-declarations', { ...U('collecteur'), body: { id, idempotency_key: key('decl'), producer_id: producers[i % producers.length].id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: days(-14 + i), quantity: String(q), unit: 'sac', bags: q, purchase_receipt_no: 'ACH-' + String(i + 1).padStart(4, '0') } });
    await call('POST', `/purchase-declarations/${id}/submit`, U('collecteur'));
    if (i >= 9) continue; // les dernières restent « soumises » : à valider par le responsable traçabilité
    await call('POST', `/purchase-declarations/${id}/transition`, { ...A, body: { to: 'in_review' } });
    await call('POST', `/purchase-declarations/${id}/transition`, { ...A, body: { to: 'accepted' } });
    const w = await call('POST', '/weighings', { ...A, body: { idempotency_key: key('w'), declaration_id: id, warehouse_id: wh.id, gross_kg: String(q * 65 + 5), tare_kg: '5' } });
    const r = await soft('reçu d\'achat', () => call('POST', '/receipts', { ...U('magasinier'), body: { weighing_id: w.id, ...(lotId ? { lot_id: lotId } : {}) } }));
    if (r) lotId = lotId ?? r.lot_id;
  }

  // ── Convois : l'un réceptionné et réglé, l'autre seulement en route
  const cv = (kg) => call('POST', '/convoys', { ...U('collecteur'), body: { idempotency_key: key('cv'), driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', declared_bags: 40, declared_kg: kg } });
  const cv1 = (await cv('2600')).convoy_no; // numéro généré : SC000000-<année>-BRA-1
  const rec = await call('POST', '/convoys/receive', { ...U('magasinier'), body: { idempotency_key: key('rc'), collector_id: col.id, convoy_no: cv1, warehouse_id: wh.id, total_kg: '2587.500', bags: 40 } });
  const reg = await call('POST', '/cash-registers', { ...A, body: { name: 'Caisse principale' } });
  const sess = await call('POST', `/cash-registers/${reg.id}/sessions`, { ...U('caissier'), body: { opening_amount: '5000000' } });
  await soft('règlement du convoi', () => call('POST', `/convoy-receptions/${rec.id}/settle`, { ...U('caissier'), body: { idempotency_key: key('st'), unit_price: '1000' } }));
  const cv2 = (await cv('1800')).convoy_no;
  const rec2 = await soft('2e réception', () => call('POST', '/convoys/receive', { ...U('magasinier'), body: { idempotency_key: key('rc'), collector_id: col.id, convoy_no: cv2, warehouse_id: wh.id, total_kg: '1795', bags: 28 } }));
  const cv3 = (await cv('2100')).convoy_no; // reste « en route » : visible dans les convois attendus du magasin

  // ── Caisse, comptabilité
  const tx = (direction, amount, reason) => call('POST', '/financial-transactions', { ...U('caissier'), body: { idempotency_key: key('tx'), account_id: reg.account_id, cash_session_id: sess.id, direction, amount, reason } });
  await soft('opérations de caisse', async () => { await tx('in', '800000', 'Versement de l\'acheteur (avance)'); await tx('out', '45000', 'Achat de fournitures de bureau'); await tx('out', '120000', 'Frais de transport'); });
  await soft('écritures comptables', async () => {
    const e = (label, lines, d) => call('POST', '/accounting/entries', { ...U('comptable'), body: { idempotency_key: key('ac'), journal: 'OD', entry_date: days(d), label, lines } });
    await e('Cotisations annuelles des membres', [{ code: '571', debit: '150000' }, { code: '758', credit: '150000' }], -10);
    await e('Entretien du magasin', [{ code: '605', debit: '60000' }, { code: '571', credit: '60000' }], -6);
  });
  const loan = await soft('prêt', () => call('POST', '/loans', { ...A, body: { idempotency_key: key('loan'), kind: 'prefinancing', borrower_type: 'producer', borrower_id: producers[0].id, amount: '90000', purpose: 'Intrants et main-d\'œuvre' } }));
  await soft('prêt approuvé', async () => {
    const l2 = await call('POST', '/loans', { ...A, body: { idempotency_key: key('loan'), kind: 'prefinancing', borrower_type: 'producer', borrower_id: producers[1].id, amount: '60000', purpose: 'Achat de sacs' } });
    await call('POST', `/loans/${l2.id}/approve`, { ...U('direction'), body: { installments: [{ due_date: days(60), amount: '30000' }, { due_date: days(120), amount: '30000' }] } });
  });

  // ── Qualité, certificats
  await soft('qualité', async () => {
    const rule = await call('POST', '/quality-rules', { ...U('responsable_qualite'), body: { code: 'HUMIDITE', label: 'Humidité (%)', kind: 'numeric', max_value: '8', unit: '%', blocking: true, value_chain_id: vc.id } });
    const insp = await call('POST', '/inspections', { ...U('responsable_qualite'), body: { idempotency_key: key('insp'), subject_type: 'lot', subject_id: lotId, kind: 'quality' } });
    await call('POST', `/inspections/${insp.id}/start`, U('responsable_qualite'));
    await call('POST', `/inspections/${insp.id}/results`, { ...U('responsable_qualite'), body: { results: [{ rule_id: rule.id, value_num: '7.2' }] } });
    await call('POST', `/inspections/${insp.id}/complete`, { ...U('responsable_qualite'), body: { summary: 'Humidité conforme' } });
  });
  await soft('certificat', () => call('POST', '/certificates', { ...A, body: { holder_type: 'organization', scheme: 'Label durable (exemple fictif)', number: 'DEMO-001', issuer: 'Organisme fictif', issued_on: days(-340), expires_on: days(25) } }));

  // ── Ventes
  await soft('ventes', async () => {
    const b = await call('POST', '/buyers', { ...A, body: { code: 'ACHETEUR1', name: 'Négoce Exemple SA (fictif)', country: 'FR', currency: 'XOF', payment_terms_days: 30 } });
    const ct = await call('POST', '/sales-contracts', { ...A, body: { number: 'CT-DEMO-001', buyer_id: b.id, value_chain_id: vc.id, starts_on: days(-30), ends_on: days(300), quantity_kg: '20000', unit_price: '1500' } });
    await call('POST', '/sales-orders', { ...A, body: { idempotency_key: key('o'), buyer_id: b.id, value_chain_id: vc.id, contract_id: ct.id, lines: [{ description: 'Cacao fèves', quantity_kg: '2000', unit_price: '1500' }] } });
  });

  // ── Tâches de terrain et relevés
  await soft('tâches', async () => {
    for (const [titre, cat, prio, d, i] of [['Visite de la parcelle de Awa KONE', 'visit', 'normal', 3, 0], ['Séance de formation taille et entretien', 'training', 'high', 8, 2], ['Contrôle des limites de la parcelle de Yves KOFFI', 'control', 'normal', 5, 8]]) {
      await call('POST', '/tasks', { ...A, body: { idempotency_key: key('task'), title: titre, category: cat, priority: prio, due_date: days(d), producer_id: producers[i].id, assignee_id: users.agent_terrain.id, publish: true, expected_result: 'Compte rendu avec photos', validation_criteria: 'Rapport complet', instructions: 'Voir le guide de formation' } });
    }
  });

  // ── Circuit exportateur : un module transmis avec un résultat transmis, un module en attente, un résultat en attente
  await soft('modules des exportateurs', async () => {
    const mod = (title, theme) => ({ theme, title, summary: 'Module proposé par l\'exportateur de démonstration (fictif).', crops: ['cacao'], certifications: ['EUDR'], level: 'base', duration_min: 60,
      content: { objectifs: ['Tenir un carnet de récolte à jour'], sections: [{ titre: 'Le carnet de récolte', points: ['Noter la date de chaque récolte', 'Noter le poids de fèves fraîches', 'Conserver le carnet à l\'abri'] }], a_eviter: ['Mélanger les récoltes de deux parcelles'], verifier: ['Que note-t-on à chaque récolte ?'] } });
    const s1 = await call('POST', '/training-submissions', { ...U('exportateur'), body: mod('Carnet de récolte et traçabilité (exportateur)', 'Collecte de documents et tenue de registres') });
    const f1 = await call('POST', `/training-submissions/${s1.id}/forward`, { ...U('adg'), body: { kind: 'formation', scope: 'selected', producer_ids: producers.slice(0, 4).map((x) => x.id), instructions: 'À dispenser avant la fin de la campagne.' } });
    const r1 = await call('POST', '/training-results', { ...U('coach'), body: { module_id: f1.module_id, session_date: days(-6), village: 'Hiré', participants: 22, avg_score: 78, notes: 'Séance suivie avec attention ; carnets distribués.' } });
    await call('POST', `/training-results/${r1.id}/forward`, U('adg'));
    await call('POST', '/training-results', { ...U('coach'), body: { module_id: f1.module_id, session_date: days(-2), village: 'Zégban', participants: 15, avg_score: 71, notes: 'À transmettre par l\'ADG.' } });
    const lib = await call('GET', '/training-modules', U('adg'));
    const m0 = lib.find((x) => x.review_state !== 'exporter');
    if (m0) await call('POST', '/producer-assignments', { ...U('adg'), body: { kind: 'formation', scope: 'all', module_id: m0.id, instructions: 'Module de base pour toute la campagne.' } });
    await call('POST', '/producer-assignments', { ...U('adg'), body: { kind: 'distribution', scope: 'selected', producer_ids: producers.slice(0, 6).map((x) => x.id), title: 'Distribution de plants de cacaoyers', due_date: days(20), instructions: 'Retrait au magasin de la section.' } });
    await call('POST', '/producer-assignments', { ...U('adg'), body: { kind: 'tache', scope: 'selected', producer_ids: producers.slice(0, 2).map((x) => x.id), title: 'Mettre à jour le carnet de récolte', due_date: days(10) } });
    await call('POST', '/training-submissions', { ...U('exportateur'), body: mod('Séchage et stockage des fèves (exportateur)', 'Gestion des récoltes et des produits') });
  });
  await soft('relevés de terrain', () => call('POST', '/sync/batch', { ...U('agent_terrain'), body: { operations: [
    { idempotency_key: key('fr'), type: 'field_record.create', payload: { kind: 'training', title: 'Formation bonnes pratiques de séchage', held_on: days(-4), participants: 18, location: 'Hiré' } },
    { idempotency_key: key('fr'), type: 'field_record.create', payload: { kind: 'social_infrastructure', title: 'Puits villageois réhabilité', location: 'Zoukougbeu', occurred_on: days(-20) } },
  ] } }));

  // ── Annulation en attente (visible par l'administrateur dans « Mes opérations »)
  if (rec2) await soft('demande d\'annulation', () => call('POST', '/cancellation-requests', { ...U('magasinier'), body: { entity_type: 'convoy_reception', entity_id: rec2.id, reason: 'Poids saisi par erreur (1 795 au lieu de 1 759)' } }));

  // ── Relevé bancaire importé (CSV fictif) + rapport programmé
  await soft('relevé bancaire', async () => {
    const d = (x) => days(x).split('-').reverse().join('/');
    const csv = `Date;Libellé;Débit;Crédit;Réf\n${d(-2)};VIREMENT NEGOCE EXEMPLE;;800 000,00;R1\n${d(-2)};FOURNITURES BUREAU;45 000,00;;R2\n${d(-1)};FRAIS BANCAIRES;1 500,00;;R3\n`;
    const f = new FormData();
    f.append('account_id', reg.account_id);
    f.append('mapping', JSON.stringify({ date: 'Date', label: 'Libellé', debit: 'Débit', credit: 'Crédit', reference: 'Réf' }));
    f.append('file', new Blob([csv]), 'releve-demo.csv');
    await call('POST', '/bank-statements/import', { ...A, form: f });
  });
  await soft('rapport programmé', () => call('POST', '/report-schedules', { ...A, body: { report: 'finance', frequency: 'weekly', weekday: 1, recipients: [users.direction.id] } }));

  // ── Écriture du fichier d'accès
  const MOBILE_ONLY = new Set(['collecteur', 'agent_terrain', 'coach']);
  const rows = accounts.map((a) => `| ${a.label}${MOBILE_ONLY.has(a.role) ? ' — **application mobile uniquement**' : ''} | ${a.name} | \`${a.email}\` |`).join('\n');
  const doc = `# Comptes de la version de démonstration\n\n> Données **entièrement fictives**. Ne jamais utiliser en production.\n\n- Mot de passe commun : \`${PASSWORD}\`\n- Coopérative : « ${org.name} » (code ${org.code ?? CODE})\n\n| Profil | Utilisateur fictif | Identifiant |\n|---|---|---|\n${rows}\n`;
  if (!process.env.DEMO_NO_DOC) {
    const out = path.join(__dirname, '..', '..', 'docs', 'COMPTES_DEMO.md');
    fs.writeFileSync(out, doc);
  }
  fs.writeFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', JSON.stringify({ org: org.id, password: PASSWORD, accounts, convoys: [cv1, cv2, cv3] }, null, 2));
  console.log(`\nCoopérative de démonstration prête : ${org.name}\n  ${accounts.length} comptes (mot de passe : ${PASSWORD})`);
  if (warnings.length) console.log(`\n${warnings.length} étape(s) facultative(s) ignorée(s) :\n - ` + warnings.join('\n - '));
})().catch((e) => { console.error(e.message); process.exit(1); });
