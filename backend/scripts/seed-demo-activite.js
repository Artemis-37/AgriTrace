// Donne à chaque compte de démonstration plus de 20 opérations ou tâches à son nom (ce que son profil a le droit de faire),
// pour que chaque écran soit réellement rempli. Données FICTIVES. Chaque étape est facultative : un échec est signalé sans tout arrêter.
// Les profils en lecture seule (auditeur, acheteur, exportateur partenaire) ne font pas d'opérations : ils reçoivent 22 messages d'équipe.
// Lancé à la fin de seed-demo-chaine.js (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-activite.js).
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const warnings = [];
const N = Number(process.env.DEMO_OPS || 22);

/** Les serveurs en ligne limitent le débit : sur « 429 », on attend puis on recommence (le chargement est simplement plus lent). */
async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || i >= 20) return r;
    await new Promise((s) => setTimeout(s, (Number(r.headers.get('retry-after')) || 8) * 1000));
  }
}

async function call(method, p, { token, org, body, client } = {}) {
  const headers = { 'x-client': client || 'web' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetchRetry(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${String(t).slice(0, 180)}`);
  return j;
}
const list = (r) => (Array.isArray(r) ? r : r.items ?? r.rows ?? []);
async function soft(label, fn) {
  try { const r = await fn(); console.log('  ✓', label); return r; }
  catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; }
}
/** Répète une opération `n` fois ; garde ce qui a réussi et signale le premier échec. */
async function times(label, n, fn) {
  let ok = 0, first = null;
  for (let i = 0; i < n; i++) { try { await fn(i); ok++; } catch (e) { first ??= e; } }
  if (ok >= n) console.log(`  ✓ ${label} (${ok})`);
  else { warnings.push(`${label} : ${ok}/${n} — ${first?.message}`); console.warn(`  ⚠ ${label} : ${ok}/${n} — ${first?.message}`); }
  return ok;
}

(async () => {
  const email = Object.fromEntries(J.accounts.map((a) => [a.role, a.email]));
  const MOBILE = new Set(['agent_terrain', 'collecteur', 'coach']);
  const C = J.org, E = J.exporter?.id;
  const tok = {};
  for (const a of J.accounts) {
    try { tok[a.role] = (await call('POST', '/auth/login', { client: MOBILE.has(a.role) ? 'mobile' : 'web', body: { email: a.email, password: J.password } })).access_token; } catch { /* profil indisponible */ }
  }
  const as = (r) => ({ token: tok[r], org: C, client: MOBILE.has(r) ? 'mobile' : 'web' });
  const asE = (r) => ({ token: tok[r], org: E });
  const ADM = 'coop_admin';
  const me = async (r, org) => (list(await call('GET', '/users', { token: tok[ADM], org: C })).find((u) => u.email === email[r]) ?? {}).id;

  const chains = await call('GET', '/value-chains', as(ADM));
  const cacao = chains.find((v) => /cacao/i.test(v.name)) ?? chains[0];
  const producers = list(await call('GET', '/producers', as(ADM)));
  const campaigns = await call('GET', '/campaigns', as(ADM));
  const camp = campaigns.find((c) => c.status === 'open' || c.active) ?? campaigns[0];
  const accts = await call('GET', '/financial-accounts', as(ADM));
  const bank = accts.find((a) => /Banque/.test(a.name)) ?? accts[0];
  const wh = (await call('GET', '/warehouses', as(ADM)))[0];
  const lot = (await call('GET', '/lots', as(ADM)))[0];
  const collectors = await call('GET', '/collectors', as(ADM));
  const col1 = collectors.find((c) => c.email === email.collecteur) ?? collectors[0];
  const products = await call('GET', '/products', as(ADM));
  const prod = products.find((p) => /cacao/i.test(p.name)) ?? products[0];

  // ── Comptable : écritures
  await soft('comptable : écritures', () => times('écritures', N, (i) => call('POST', '/accounting/entries', { ...as('comptable'), body: { idempotency_key: key('ac'), journal: 'OD', entry_date: days(-(i % 25)), label: `Charge d'exploitation n° ${i + 1} (fictive)`, lines: [{ code: '605', debit: String(20000 + i * 1500) }, { code: '571', credit: String(20000 + i * 1500) }] } })));

  // ── Responsable financier : mouvements de la banque
  await soft('responsable financier : écritures et décaissements', () => times('écritures', N, (i) => call('POST', '/accounting/entries', { ...as('responsable_financier'), body: { idempotency_key: key('acf'), journal: 'OD', entry_date: days(-(i % 28)), label: `Décaissement ${i + 1} — ${['intrants', 'sacs', 'carburant', 'salaires journaliers', 'entretien'][i % 5]} (fictif)`, lines: [{ code: '605', debit: String(30000 + i * 2000) }, { code: '571', credit: String(30000 + i * 2000) }] } })));

  // ── Responsable logistique : transporteurs, véhicules, conducteurs
  await soft('responsable logistique : transporteurs, véhicules, conducteurs', async () => {
    const L = as('responsable_logistique');
    const cars = [];
    await times('transporteurs', 5, async (i) => cars.push(await call('POST', '/carriers', { ...L, body: { code: `TR${run}${i}`, name: `Transporteur ${['Gôh', 'Haut-Sassandra', 'Lôh-Djiboua', 'Marahoué', 'Nawa'][i]} (fictif)`, phone: `+22507000${String(300 + i)}` } })));
    const car = cars[0];
    if (!car) throw new Error('aucun transporteur créé');
    await times('véhicules', 9, (i) => call('POST', '/vehicles', { ...L, body: { plate: `CI-${run}-${i}`, carrier_id: cars[i % cars.length].id, kind: i % 2 ? 'Camionnette' : 'Camion 10 t', capacity_kg: i % 2 ? '2500' : '10000' } }));
    await times('conducteurs', 9, (i) => call('POST', '/drivers', { ...L, body: { full_name: `Conducteur ${i + 1} (fictif)`, carrier_id: cars[i % cars.length].id, phone: `+22507001${String(100 + i)}`, licence_no: `PC-${run}-${i}` } }));
  });

  // ── Responsable magasin : mouvements de stock
  if (lot) await soft('responsable magasin : mouvements de stock', () => times('mouvements', N, (i) => call('POST', '/warehouse-movements', { ...as('responsable_magasin'), body: { idempotency_key: key('mv'), warehouse_id: wh.id, lot_id: lot.id, type: i % 4 ? 'entry' : 'exit', quantity_kg: String(10 + i), reason: i % 4 ? `Entrée de régularisation ${i + 1}` : `Sortie pour échantillon ${i + 1}` } })));

  // ── Responsable cartographie : contrôle puis vérification des parcelles
  await soft('responsable cartographie : contrôles et vérifications', async () => {
    const ps = list(await call('GET', '/parcels', as(ADM)));
    let n = 0;
    for (const p of ps) {
      if (n >= N + 4) break;
      try { await call('POST', `/parcels/${p.id}/control`, { ...as('responsable_cartographie'), body: {} }); n++; } catch { /* déjà contrôlée */ }
    }
    if (n < N) throw new Error(`${n} opérations seulement`);
  });

  // ── Responsable qualité : inspections et règles
  await soft('responsable qualité : inspections', () => times('inspections', N, (i) => call('POST', '/inspections', { ...as('responsable_qualite'), body: { idempotency_key: key('insp'), subject_type: 'producer', subject_id: producers[i % producers.length].id, kind: 'quality', scheduled_for: days(-(i % 20)) } })));

  // ── ADG : missions (tâches) confiées aux agents de terrain
  await soft('ADG : missions', async () => {
    const agent = await me('agent_terrain');
    const coach = await me('coach');
    const cats = ['visit', 'training', 'survey'];
    await times('missions', N, (i) => call('POST', '/tasks', { ...as('adg'), body: { idempotency_key: key('task'), title: `Mission ${i + 1} — ${['visite de plantation', 'suivi de la taille', 'contrôle du séchage', 'enquête parcellaire'][i % 4]}`, category: cats[i % 3] === 'survey' ? 'visit' : cats[i % 3], priority: i % 5 === 0 ? 'urgent' : 'normal', due_date: days(3 + (i % 20)), producer_id: producers[i % producers.length].id, assignee_id: i % 2 ? agent : (coach ?? agent), publish: true, expected_result: 'Compte rendu avec photos', validation_criteria: 'Rapport complet', instructions: 'Voir le producteur et renseigner le relevé.' } }));
  });

  // ── Coach : relevés de terrain (mobile)
  await soft('coach : relevés de terrain', async () => {
    const op = (i) => ({ idempotency_key: key('fr'), type: 'field_record.create', payload: { id: crypto.randomUUID(), idempotency_key: key('frp'), kind: i % 3 ? 'training' : 'distribution', title: i % 3 ? `Séance de coaching ${i + 1}` : `Distribution ${i + 1}`, ...(i % 3 ? { data: { theme: ['Taille', 'Fermentation', 'Séchage', 'Carnet de récolte'][i % 4], participants: [{ producer_id: producers[i % producers.length].id, role: 'principal', score: 60 + (i % 35) }] } } : { data: { category: 'Intrants et Outils', group: 'Plants', article: 'Cacaoyer', quantity: 5 + i, producer_id: producers[i % producers.length].id } }) } });
    const r = await call('POST', '/sync/batch', { ...as('coach'), body: { operations: Array.from({ length: N }, (_, i) => op(i)) } });
    const ok = (r.results ?? []).filter((x) => ['accepted', 'processed', 'applied'].includes(x.status)).length;
    if (ok < N) throw new Error(`${ok}/${N} relevés acceptés`);
  });

  // ── Direction : décisions sur des prêts (demandés par l'administrateur)
  await soft('direction : approbations de prêts', async () => {
    const free = producers.slice(10, 10 + N);
    let n = 0;
    for (const [i, p] of free.entries()) {
      try {
        const loan = await call('POST', '/loans', { ...as(ADM), body: { idempotency_key: key('loan'), kind: 'prefinancing', borrower_type: 'producer', borrower_id: p.id, amount: '60000', purpose: `Intrants — demande ${i + 1}` } });
        await call('POST', `/loans/${loan.id}/approve`, { ...as('direction'), body: { installments: [{ due_date: days(60), amount: '30000' }, { due_date: days(120), amount: '30000' }] } });
        n++;
      } catch (e) { if (!n && i > 2) throw e; }
    }
    if (n < N / 2) throw new Error(`${n} prêts approuvés`);
  });

  // ── Chaîne de livraison : achats du délégué → convois → magasin → expéditions → exportateur (alimente traçabilité, pont-bascule, analyste, caissier)
  const cycles = N;
  const sheets = [];
  await soft('achats, convois, expéditions (22 cycles)', async () => {
    let ok = 0;
    for (let i = 0; i < cycles; i++) {
      try {
        const id = crypto.randomUUID();
        await call('POST', '/purchase-declarations', { ...as('collecteur'), body: { id, idempotency_key: key('decl'), producer_id: producers[(i * 3) % producers.length].id, value_chain_id: cacao.id, campaign_id: camp?.id, operation_date: days(-(i % 10)), quantity: String(8 + (i % 5)), unit: 'sac', bags: 8 + (i % 5), purchase_receipt_no: `ACT-${run}-${i}` } });
        await call('POST', `/purchase-declarations/${id}/submit`, as('collecteur'));
        // La validation est faite par le responsable traçabilité (deux opérations par achat).
        await call('POST', `/purchase-declarations/${id}/transition`, { ...as('responsable_tracabilite'), body: { to: 'in_review' } });
        await call('POST', `/purchase-declarations/${id}/transition`, { ...as('responsable_tracabilite'), body: { to: 'accepted' } });
        const kg = (8 + (i % 5)) * 65;
        const cv = await call('POST', '/convoys', { ...as('collecteur'), body: { idempotency_key: key('cv'), driver_name: 'Traoré Moussa', truck_no: `AB ${100 + i} CI`, declared_bags: 8 + (i % 5), declared_kg: String(kg), declaration_ids: [id] } });
        await call('POST', '/convoys/receive', { ...as('magasinier'), body: { idempotency_key: key('rc'), collector_id: col1.id, convoy_no: cv.convoy_no, warehouse_id: wh.id, ...(prod && { product_id: prod.id }), ...(camp && { campaign_id: camp.id }), total_kg: String(kg), bags: 8 + (i % 5) } });
        ok++;
      } catch (e) { if (!ok && i > 1) throw e; }
    }
    if (ok < cycles / 2) throw new Error(`${ok} cycles réussis`);
  });
  if (E) await soft('expéditions transmises à l\'exportateur', async () => {
    const convs = await call('GET', '/dispatch-sheets/convoys', as(ADM));
    let n = 0;
    for (const [i, cv] of convs.entries()) {
      try {
        const sh = await call('POST', '/dispatch-sheets', { ...as(ADM), body: { convoy_ids: [cv.id], bl_no: `BL-ACT-${run}-${i + 1}`, lot_id_dse: `DSE-ACT-${run}-${i + 1}`, driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', departure_date: days(-2) } });
        await call('POST', `/dispatch-sheets/${sh.id}/transmit`, { ...as(ADM), body: { destination_org_id: E } });
        n++;
      } catch { /* déjà expédié */ }
    }
    if (!n) throw new Error('aucune expédition');
  });
  if (E) await soft('exportateur : pesées, analyses, règlements', async () => {
    const dels = list(await call('GET', '/deliveries', asE('exp_admin'))).filter((d) => ['arrived', 'announced', 'in_transit'].includes(d.status));
    let n = 0;
    for (const [i, d] of dels.entries()) {
      try {
        const kg = Number(d.declared_kg ?? 1000);
        await call('POST', `/deliveries/${d.id}/weigh-in`, { ...asE('pont_bascule'), body: { gross_kg: kg + 8000, origin: 'Hiré', transporter: 'Transafrik Logistique (fictif)', bridge_in: 'PONT 1' } });
        await call('POST', `/deliveries/${d.id}/weigh-out`, { ...asE('pont_bascule'), body: { tare_kg: 8000, bags_discharged: Math.max(1, Math.round(kg / 65)), bags_refused: 0, sack_tare_kg: 20, pallet_tare_kg: 0, bridge_out: 'PONT 2' } });
        await call('POST', `/deliveries/${d.id}/analysis`, { ...asE('analyste'), body: { moisture_pct: 7 + (i % 5) * 0.2, bean_count: 92 + (i % 8), defects: { mouldy: 1, slaty: 2, insect: 0.5, residues: 1.5, crabots: 2 }, refaction_kg: 6, grade: i % 2 ? 'GRADE 2' : 'GRADE 1', decision: 'accepted' } });
        await call('POST', `/deliveries/${d.id}/settle`, { ...asE('exp_caissier'), body: { unit_price: 1480 + (i % 4) * 15, payment_ref: `VIR-ACT-${run}-${i + 1}` } });
        n++;
      } catch (e) { if (!n && i > 1) throw e; }
    }
    if (!n) throw new Error('aucune livraison traitée');
  });
  if (E) await soft('exportateur : opérations de caisse', async () => {
    const r = (await call('GET', '/cash-registers', asE('exp_caissier')))[0];
    let sess = r.open_session_id;
    if (!sess) sess = (await call('POST', `/cash-registers/${r.id}/sessions`, { ...asE('exp_caissier'), body: { opening_amount: '2000000' } })).id;
    await times('opérations de caisse', N, (i) => call('POST', '/financial-transactions', { ...asE('exp_caissier'), body: { idempotency_key: key('etx'), account_id: r.account_id, cash_session_id: sess, direction: i % 4 ? 'out' : 'in', amount: String(15000 + i * 1000), reason: i % 4 ? `Dépense de réception ${i + 1}` : `Approvisionnement ${i + 1}` } }));
  });

  // ── Profils en lecture seule : 22 messages d'équipe chacun
  await soft('profils en lecture seule : messages reçus', async () => {
    for (const role of ['auditeur', 'acheteur', 'exportateur']) {
      const to = await me(role);
      if (!to) continue;
      await times(`messages pour ${role}`, N, (i) => call('POST', '/messages', { ...as(ADM), body: { idempotency_key: key('m'), to, body: `Information n° ${i + 1} : ${['point sur la campagne', 'nouveau lot disponible', 'rapport hebdomadaire publié', 'rappel de réunion', 'état des livraisons'][i % 5]} (message de démonstration).` } }));
    }
  });

  console.log(`\nActivité de démonstration ajoutée${warnings.length ? ` — ${warnings.length} avertissement(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('activité :', e.message); process.exit(1); });
