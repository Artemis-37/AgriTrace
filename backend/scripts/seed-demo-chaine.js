// Complète la démonstration sur toute la chaîne, du champ à l'exportateur : parcelles tracées pour tous les producteurs, relevés de terrain,
// banques / mobile money / trésorerie / caisse (coopérative ET exportateur), rapprochements bancaires, écritures, paiements, ventes,
// livraisons réglées. Données FICTIVES. Chaque étape est facultative : un échec est signalé sans interrompre les autres.
// Lancé à la fin de seed-demo-supplement.js (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-chaine.js).
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const frDate = (n) => days(n).split('-').reverse().join('/');
const warnings = [];

/** Les serveurs en ligne limitent le débit : sur « 429 », on attend puis on recommence (le chargement est simplement plus lent). */
async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || i >= 20) return r;
    await new Promise((s) => setTimeout(s, (Number(r.headers.get('retry-after')) || 8) * 1000));
  }
}

async function call(method, p, { token, org, body, form, client } = {}) {
  const headers = { 'x-client': client || 'web' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetchRetry(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${String(t).slice(0, 200)}`);
  return j;
}
async function soft(label, fn) {
  try { const r = await fn(); console.log('  ✓', label); return r; }
  catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; }
}
const list = (r) => (Array.isArray(r) ? r : r.items ?? r.rows ?? []);

(async () => {
  const email = Object.fromEntries(J.accounts.map((a) => [a.role, a.email]));
  const MOBILE = new Set(['agent_terrain', 'collecteur', 'coach']);
  const login = async (role) => (await call('POST', '/auth/login', { client: MOBILE.has(role) ? 'mobile' : 'web', body: { email: email[role], password: J.password } })).access_token;
  const C = J.org, E = J.exporter?.id;
  const tk = {};
  for (const r of ['coop_admin', 'caissier', 'comptable', 'responsable_financier', 'cartographe', 'agent_terrain', 'acheteur']) tk[r] = await login(r).catch(() => null);
  const as = (r) => ({ token: tk[r], org: C, client: MOBILE.has(r) ? 'mobile' : 'web' });
  const ex = {};
  if (E) for (const r of ['exp_admin', 'exp_caissier', 'pont_bascule', 'analyste']) ex[r] = await login(r).catch(() => null);
  const asE = (r) => ({ token: ex[r], org: E });
  const ADM = 'coop_admin';
  const any = async (roles, method, p, body, form) => {
    let last;
    for (const r of roles) { if (!tk[r]) continue; try { return await call(method, p, { ...as(r), body, form }); } catch (e) { last = e; if (!/→ 40[13]/.test(e.message)) throw e; } }
    throw last ?? new Error('aucun profil disponible');
  };

  const chains = await call('GET', '/value-chains', as(ADM));
  const cacao = chains.find((v) => /cacao/i.test(v.name)) ?? chains[0];
  const producers = list(await call('GET', '/producers', as(ADM)));

  // ── 1. LE CHAMP : une parcelle tracée (polygone) pour chaque producteur qui n'en a pas encore
  await soft('parcelles tracées pour tous les producteurs', async () => {
    const parcels = list(await call('GET', '/parcels', as(ADM)).catch(() => []));
    const has = new Set(parcels.map((p) => p.producer_id));
    const sq = (lon, lat, s) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s * 0.8], [lon, lat + s * 0.8], [lon, lat]]] });
    let n = 0, i = 0, fail = null;
    for (const pr of producers) {
      i++;
      if (has.has(pr.id)) continue;
      // Grille de parcelles autour de Hiré (fictif), espacées pour ne jamais se chevaucher ni toucher la zone protégée d'exemple.
      const col = i % 8, row = Math.floor(i / 8);
      const lon = -5.32 + col * 0.006, lat = 6.16 + row * 0.005;
      const s = 0.0018 + (i % 4) * 0.0003;
      try {
        await any(['cartographe', ADM], 'POST', '/parcels', { idempotency_key: key('parcel'), producer_id: pr.id, value_chain_id: cacao.id, declared_area_ha: (s * s * 0.8 * 110700 * 110574 / 1e4).toFixed(1), geometry: sq(lon, lat, s), confirm_not_duplicate: true });
        n++;
      } catch (e) { fail = e; }
    }
    if (!n && fail) throw fail;
  });

  // ── 2. LE CHAMP : relevés (formations, distributions, infrastructures, visites) par l'agent de terrain
  await soft('relevés de terrain supplémentaires', async () => {
    const op = (kind, title, data, lat, lon) => ({ idempotency_key: key('fr'), type: 'field_record.create', payload: { id: crypto.randomUUID(), idempotency_key: key('frp'), kind, title, latitude: lat, longitude: lon, data } });
    const slice = (a, b) => producers.slice(a, b).map((x, i) => ({ producer_id: x.id, role: i ? 'participant' : 'principal', score: 65 + ((i * 7) % 30) }));
    const r = await call('POST', '/sync/batch', { ...as('agent_terrain'), body: { operations: [
      op('training', 'Séance sur la fermentation et le séchage', { theme: 'Qualité du cacao', participants: slice(8, 16) }, 6.17, -5.3),
      op('training', 'Gestion des produits phytosanitaires', { theme: 'Sécurité et santé', participants: slice(16, 24) }, 6.18, -5.31),
      op('training', 'Tenue du carnet de récolte', { theme: 'Traçabilité', participants: slice(24, 32) }, 6.19, -5.28),
      op('distribution', 'Distribution de sacs de jute', { category: 'Intrants et Outils', group: 'Emballages', article: 'Sac de jute', quantity: 20, producer_id: producers[2]?.id }),
      op('distribution', 'Distribution de plants', { category: 'Intrants et Outils', group: 'Plants', article: 'Cacaoyer', quantity: 15, producer_id: producers[3]?.id }),
      op('distribution', 'Distribution d\'engrais', { category: 'Intrants et Outils', group: 'Engrais', article: 'NPK', quantity: 3, producer_id: producers[4]?.id }),
      op('social_infrastructure', 'Dispensaire de Bamoro', { type: 'Sante', lits: 4 }, 6.21, -5.27),
      op('social_infrastructure', 'Forage de Kouassidjo', { type: 'Eau', profondeur_m: 48 }, 6.15, -5.33),
    ] } });
    const bad = (r.results ?? []).filter((x) => !['accepted', 'processed', 'applied'].includes(x.status));
    if (bad.length === (r.results ?? []).length && bad.length) throw new Error(`relevés refusés : ${bad[0].error ?? bad[0].status}`);
  });

  // ── 3. LA COOPÉRATIVE : banque, mobile money, trésorerie, caisse
  const accts = await call('GET', '/financial-accounts', as(ADM));
  const bank = accts.find((a) => /Banque/.test(a.name)) ?? accts[0];
  const reg = (await call('GET', '/cash-registers', as(ADM)))[0];
  const cashAcc = accts.find((a) => a.owner_type === 'cash_register');
  const mk = (name, opening, bank_name, account_number) => call('POST', '/financial-accounts', { ...as(ADM), body: { owner_type: 'other', name, bank_name, account_number, opening_balance: opening } });
  const wallet = await soft('compte mobile money de la coopérative', () => mk('Mobile Money coopérative (fictif)', '1500000', 'Opérateur mobile (fictif)', '0700000000'));
  const treasury = await soft('compte de trésorerie / épargne', () => mk('Trésorerie — épargne de la coopérative (fictif)', '8000000', 'Caisse d\'épargne exemple (fictive)', 'CI00 0000 0000 7788'));
  const tx = (token, org, account_id, direction, amount, reason, session) => call('POST', '/financial-transactions', { token, org, body: { idempotency_key: key('tx'), account_id, direction, amount, reason, ...(session && { cash_session_id: session }) } });
  await soft('mouvements de la banque et du mobile money', async () => {
    const A = as(ADM);
    await tx(A.token, C, bank.id, 'in', '4200000', 'Règlement de l\'acheteur — contrat CT-DEMO-001');
    await tx(A.token, C, bank.id, 'in', '1800000', 'Subvention de campagne (fictive)');
    await tx(A.token, C, bank.id, 'out', '650000', 'Paiement du loyer du magasin');
    await tx(A.token, C, bank.id, 'out', '320000', 'Frais de transport des convois');
    await tx(A.token, C, bank.id, 'out', '18500', 'Frais bancaires du mois');
    if (wallet) {
      await tx(A.token, C, wallet.id, 'out', '250000', 'Paiement mobile des producteurs — lot 1');
      await tx(A.token, C, wallet.id, 'out', '180000', 'Paiement mobile des producteurs — lot 2');
      await tx(A.token, C, wallet.id, 'in', '600000', 'Rechargement du compte mobile depuis la banque');
      await tx(A.token, C, bank.id, 'out', '600000', 'Rechargement du compte mobile money');
    }
    if (treasury) {
      await tx(A.token, C, bank.id, 'out', '1000000', 'Placement en trésorerie / épargne');
      await tx(A.token, C, treasury.id, 'in', '1000000', 'Placement reçu de la banque');
      await tx(A.token, C, treasury.id, 'in', '42000', 'Intérêts de l\'épargne (fictifs)');
    }
  });
  await soft('opérations de la caisse (entrées et sorties)', async () => {
    const reg2 = (await call('GET', '/cash-registers', as('caissier')))[0];
    let sess = reg2.open_session_id;
    if (!sess) sess = (await call('POST', `/cash-registers/${reg2.id}/sessions`, { ...as('caissier'), body: {} })).id;
    const A = as('caissier');
    await tx(A.token, C, reg2.account_id, 'in', '1500000', 'Retrait bancaire pour la caisse', sess);
    await tx(A.token, C, reg2.account_id, 'out', '75000', 'Carburant du camion', sess);
    await tx(A.token, C, reg2.account_id, 'out', '32000', 'Entretien de la balance', sess);
    await tx(A.token, C, reg2.account_id, 'out', '56000', 'Repas des chargeurs', sess);
    await tx(A.token, C, reg2.account_id, 'in', '120000', 'Cotisations des membres encaissées', sess);
    if (bank) await tx(as(ADM).token, C, bank.id, 'out', '1500000', 'Retrait pour la caisse principale');
  });
  await soft('paiements aux producteurs (mobile money, virement)', async () => {
    const fin = ['responsable_financier', 'comptable', ADM];
    const src = wallet ?? bank;
    for (const [i, m, amt] of [[3, 'mobile_money', '95000'], [4, 'mobile_money', '60000'], [5, 'bank_transfer', '210000'], [6, 'bank_transfer', '175000'], [7, 'mobile_money', '48000'], [8, 'cash', '30000']]) {
      if (!producers[i]) continue;
      const pay = await any(fin, 'POST', '/payments', { idempotency_key: key('pay'), source_account_id: m === 'cash' ? cashAcc.id : src.id, payee_type: 'producer', payee_id: producers[i].id, amount: amt, method: m });
      if (m === 'cash') continue;
      await soft(`paiement ${i}`, async () => {
        await any(fin, 'POST', `/payments/${pay.id}/transition`, { to: 'initiated', note: 'Ordre transmis' });
        if (i < 7) await any(['direction', 'responsable_financier', ADM], 'POST', `/payments/${pay.id}/confirm`, { confirmation_source: 'manual', note: 'Fonds remis au bénéficiaire' });
      });
    }
  });
  await soft('relevé bancaire de la banque (rapprochement)', async () => {
    const csv = `Date;Libellé;Débit;Crédit;Réf\n${frDate(-9)};VIREMENT NEGOCE EXEMPLE CT-DEMO-001;;4 200 000,00;B1\n${frDate(-8)};SUBVENTION CAMPAGNE;;1 800 000,00;B2\n${frDate(-7)};LOYER MAGASIN;650 000,00;;B3\n${frDate(-5)};TRANSPORT CONVOIS;320 000,00;;B4\n${frDate(-3)};FRAIS BANCAIRES;18 500,00;;B5\n${frDate(-2)};PRELEVEMENT ASSURANCE;27 000,00;;B6\n`;
    const f = new FormData();
    f.append('account_id', bank.id);
    f.append('mapping', JSON.stringify({ date: 'Date', label: 'Libellé', debit: 'Débit', credit: 'Crédit', reference: 'Réf' }));
    f.append('file', new Blob([csv]), 'releve-banque-demo.csv');
    const st = await call('POST', '/bank-statements/import', { ...as(ADM), form: f });
    const det = await call('GET', `/bank-statements/${st.id ?? st.statement_id}`, as(ADM)).catch(() => null);
    for (const l of (det?.lines ?? []).slice(0, 4)) {
      const cand = await call('GET', `/bank-statement-lines/${l.id}/candidates`, as(ADM)).catch(() => []);
      const c = list(cand)[0];
      if (c) await soft('rapprochement', () => call('POST', `/bank-statement-lines/${l.id}/match`, { ...as(ADM), body: { tx_id: c.id ?? c.tx_id ?? c.transaction_id } }));
    }
  });
  await soft('écritures comptables supplémentaires', async () => {
    const e = (label, lines, d, journal = 'OD') => any(['comptable', ADM], 'POST', '/accounting/entries', { idempotency_key: key('ac'), journal, entry_date: days(d), label, lines });
    await e('Loyer du magasin', [{ code: '605', debit: '650000' }, { code: '521', credit: '650000' }], -7).catch(() => e('Loyer du magasin', [{ code: '605', debit: '650000' }, { code: '571', credit: '650000' }], -7));
    await e('Frais de transport des convois', [{ code: '605', debit: '320000' }, { code: '571', credit: '320000' }], -5);
    await e('Subvention de campagne', [{ code: '571', debit: '1800000' }, { code: '758', credit: '1800000' }], -8);
    await e('Carburant du camion', [{ code: '605', debit: '75000' }, { code: '571', credit: '75000' }], -2);
  });

  // ── 4. LA VENTE : un second acheteur, un contrat et une commande confirmée
  await soft('second acheteur, contrat et commande', async () => {
    const com = ['acheteur', ADM];
    const b = await any(com, 'POST', '/buyers', { code: 'ACHETEUR2', name: 'Chocolaterie du Nord SARL (fictive)', country: 'BE', currency: 'XOF', payment_terms_days: 45 });
    const ct = await any(com, 'POST', '/sales-contracts', { number: 'CT-DEMO-002', buyer_id: b.id, value_chain_id: cacao.id, starts_on: days(-10), ends_on: days(200), quantity_kg: '15000', unit_price: '1550' });
    const o = await any(com, 'POST', '/sales-orders', { idempotency_key: key('o'), buyer_id: b.id, value_chain_id: cacao.id, contract_id: ct.id, lines: [{ description: 'Cacao fèves — grade 1', quantity_kg: '3000', unit_price: '1550' }] });
    await soft('confirmation de la commande', () => any(com, 'POST', `/sales-orders/${o.id}/confirm`, {}));
  });

  // ── 5. L'EXPORTATEUR : livraisons réglées, banques, caisse, trésorerie, acheteurs, écritures
  if (E) {
    await soft('livraisons de l\'exportateur : toutes pesées, analysées et réglées', async () => {
      const dels = list(await call('GET', '/deliveries', asE('exp_admin')));
      const kgOf = (d) => Number(d.declared_kg ?? 1000);
      let n = 0;
      for (const d of dels) {
        if (['settled', 'refused', 'paid'].includes(d.status)) continue;
        try {
          if (['arrived', 'announced', 'in_transit'].includes(d.status)) await call('POST', `/deliveries/${d.id}/weigh-in`, { ...asE('pont_bascule'), body: { gross_kg: kgOf(d) + 8000, origin: 'Hiré', transporter: 'Transafrik Logistique (fictif)', bridge_in: 'PONT 1' } });
          if (['arrived', 'announced', 'in_transit', 'weighing_in'].includes(d.status)) await call('POST', `/deliveries/${d.id}/weigh-out`, { ...asE('pont_bascule'), body: { tare_kg: 8000, bags_discharged: Math.max(1, Math.round(kgOf(d) / 65)), bags_refused: 0, sack_tare_kg: 20, pallet_tare_kg: 0, bridge_out: 'PONT 2' } });
          if (['arrived', 'announced', 'in_transit', 'weighing_in', 'weighed', 'weighing_out', 'to_analyse'].includes(d.status)) await call('POST', `/deliveries/${d.id}/analysis`, { ...asE('analyste'), body: { moisture_pct: 7.2 + (n % 3) * 0.2, bean_count: 94 + n, defects: { mouldy: 1, slaty: 2, insect: 0.5, residues: 1.5, crabots: 2 }, refaction_kg: 8, grade: n % 2 ? 'GRADE 2' : 'GRADE 1', decision: 'accepted' } });
          const cur = await call('GET', `/deliveries/${d.id}`, asE('exp_admin'));
          if (cur.status === 'accepted' && n % 3 !== 2) await call('POST', `/deliveries/${d.id}/settle`, { ...asE('exp_caissier'), body: { unit_price: 1480 + (n % 3) * 20, payment_ref: `VIR-EXP-${run}-${n + 1}` } });
          n++;
        } catch (e) { warnings.push(`livraison ${d.number} : ${e.message}`); }
      }
      if (!n) throw new Error('aucune livraison à faire avancer');
    });
    const eacc = list(await call('GET', '/financial-accounts', asE('exp_admin')));
    const ebank = eacc.find((a) => /Banque/.test(a.name)) ?? eacc[0];
    const ecash = eacc.find((a) => a.owner_type === 'cash_register');
    const emk = (name, opening, bank_name, account_number) => call('POST', '/financial-accounts', { ...asE('exp_admin'), body: { owner_type: 'other', name, bank_name, account_number, opening_balance: opening } });
    const ebank2 = await soft('2e compte bancaire de l\'exportateur (devises)', () => emk('Banque exportateur — compte devises (fictif)', '25000000', 'Banque Exemple (fictive)', 'CI00 0000 0000 9911'));
    const etres = await soft('compte de trésorerie de l\'exportateur', () => emk('Trésorerie exportateur — placements (fictif)', '12000000', 'Établissement exemple (fictif)', 'CI00 0000 0000 3344'));
    const etx = (account_id, direction, amount, reason, sess) => call('POST', '/financial-transactions', { ...asE('exp_admin'), body: { idempotency_key: key('etx'), account_id, direction, amount, reason, ...(sess && { cash_session_id: sess }) } });
    await soft('mouvements bancaires de l\'exportateur', async () => {
      await etx(ebank.id, 'in', '38000000', 'Encaissement de la vente à Chocolaterie Exemple (fictive)');
      await etx(ebank.id, 'out', '9500000', 'Règlement des coopératives — livraisons de la semaine');
      await etx(ebank.id, 'out', '1250000', 'Frais de transport et de manutention');
      await etx(ebank.id, 'out', '85000', 'Frais bancaires');
      if (ebank2) { await etx(ebank2.id, 'in', '6000000', 'Encaissement en devises converti'); await etx(ebank2.id, 'out', '2400000', 'Frais de transit et de douane'); }
      if (etres) { await etx(ebank.id, 'out', '3000000', 'Placement en trésorerie'); await etx(etres.id, 'in', '3000000', 'Placement reçu'); await etx(etres.id, 'in', '95000', 'Intérêts des placements (fictifs)'); }
    });
    await soft('caisse de l\'exportateur', async () => {
      const r = (await call('GET', '/cash-registers', asE('exp_caissier')))[0];
      let sess = r.open_session_id;
      if (!sess) sess = (await call('POST', `/cash-registers/${r.id}/sessions`, { ...asE('exp_caissier'), body: { opening_amount: '2000000' } })).id;
      for (const [d, a, why] of [['in', '1000000', 'Retrait bancaire pour la caisse'], ['out', '120000', 'Manutention — déchargement du camion'], ['out', '45000', 'Fournitures du pont-bascule'], ['out', '80000', 'Repas du personnel de réception']])
        await call('POST', '/financial-transactions', { ...asE('exp_caissier'), body: { idempotency_key: key('etx'), account_id: r.account_id, cash_session_id: sess, direction: d, amount: a, reason: why } });
    });
    await soft('relevé bancaire de l\'exportateur', async () => {
      const csv = `Date;Libellé;Débit;Crédit;Réf\n${frDate(-6)};VIREMENT CHOCOLATERIE EXEMPLE;;38 000 000,00;X1\n${frDate(-5)};REGLEMENT COOPERATIVES;9 500 000,00;;X2\n${frDate(-4)};TRANSPORT MANUTENTION;1 250 000,00;;X3\n${frDate(-1)};FRAIS BANCAIRES;85 000,00;;X4\n`;
      const f = new FormData();
      f.append('account_id', ebank.id);
      f.append('mapping', JSON.stringify({ date: 'Date', label: 'Libellé', debit: 'Débit', credit: 'Crédit', reference: 'Réf' }));
      f.append('file', new Blob([csv]), 'releve-exportateur.csv');
      await call('POST', '/bank-statements/import', { ...asE('exp_admin'), form: f });
    });
    await soft('acheteurs de l\'exportateur (chocolatiers)', async () => {
      const A = asE('exp_admin');
      const chain = (await call('GET', '/value-chains', A))[0];
      const b = await call('POST', '/buyers', { ...A, body: { code: 'CHOCO1', name: 'Chocolaterie Exemple (fictive)', country: 'FR', currency: 'XOF', payment_terms_days: 30 } });
      const b2 = await call('POST', '/buyers', { ...A, body: { code: 'CHOCO2', name: 'Broyeur Atlantique SA (fictif)', country: 'NL', currency: 'XOF', payment_terms_days: 60 } });
      for (const [buyer, no, kg, price] of [[b, 'EXP-CT-001', '60000', '2150'], [b2, 'EXP-CT-002', '40000', '2200']]) {
        const ct = await call('POST', '/sales-contracts', { ...A, body: { number: no, buyer_id: buyer.id, value_chain_id: chain.id, starts_on: days(-20), ends_on: days(250), quantity_kg: kg, unit_price: price } });
        const o = await call('POST', '/sales-orders', { ...A, body: { idempotency_key: key('eo'), buyer_id: buyer.id, value_chain_id: chain.id, contract_id: ct.id, lines: [{ description: 'Cacao fèves — export', quantity_kg: String(Number(kg) / 4), unit_price: price }] } });
        await soft('commande exportateur confirmée', () => call('POST', `/sales-orders/${o.id}/confirm`, { ...A, body: {} }));
      }
    });
    await soft('écritures comptables de l\'exportateur', async () => {
      const e = (label, lines, d) => call('POST', '/accounting/entries', { ...asE('exp_admin'), body: { idempotency_key: key('eac'), journal: 'OD', entry_date: days(d), label, lines } });
      await e('Frais de transport et de manutention', [{ code: '605', debit: '1250000' }, { code: '571', credit: '1250000' }], -4);
      await e('Intérêts des placements', [{ code: '571', debit: '95000' }, { code: '758', credit: '95000' }], -2);
    });
  }

  console.log(`\nChaîne complète ajoutée (du champ à l'exportateur)${warnings.length ? ` — ${warnings.length} avertissement(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('chaîne complète :', e.message); process.exit(1); });
