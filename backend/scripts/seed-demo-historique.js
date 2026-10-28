// Démonstration : deux campagnes antérieures (grandes traites 2024-2025 et 2025-2026) avec leurs achats, pesées, reçus et financements des délégués,
// puis le REPORT du solde de chaque délégué d'une campagne à la suivante (« Solde de la campagne précédente », sans mouvement de caisse).
// Les campagnes sont clôturées à la fin (bilan figé). Données FICTIVES.
// Limite : l'API date les pesées, reçus et règlements du jour de leur saisie ; seuls les achats déclarés et les financements portent la date historique.
// Lancé à la fin de seed-demo-complet.js (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-historique.js).
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const N = Number(process.env.DEMO_HIST_PURCHASES || 40);
const warnings = [];

async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (![429, 502, 503, 504].includes(r.status) || i >= 20) return r;
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

// Les deux campagnes antérieures : [code, nom, début, fin, prix d'achat au kg, prix de vente au kg, préfixe des reçus d'achat]
const CAMPAIGNS = [
  ['GT2425', 'Grande traite 2024-2025', '2024-10-01', '2025-09-30', '1000', '1450', 'A24'],
  ['GT2526', 'Grande traite 2025-2026', '2025-10-01', '2026-09-30', '1100', '1550', 'A25'],
];

(async () => {
  const MOBILE = new Set(['agent_terrain', 'collecteur', 'coach']);
  const tok = {};
  for (const a of J.accounts) {
    try { tok[a.role] = (await call('POST', '/auth/login', { client: MOBILE.has(a.role) ? 'mobile' : 'web', body: { email: a.email, password: J.password } })).access_token; } catch { /* profil indisponible */ }
  }
  const C = J.org;
  const as = (r) => ({ token: tok[r], org: C, client: MOBILE.has(r) ? 'mobile' : 'web' });
  const ADM = 'coop_admin';
  const email = Object.fromEntries(J.accounts.map((a) => [a.role, a.email]));

  const chains = await call('GET', '/value-chains', as(ADM));
  const cacao = chains.find((v) => /cacao/i.test(v.name)) ?? chains[0];
  const products = await call('GET', '/products', as(ADM));
  const prod = products.find((p) => /cacao/i.test(p.name)) ?? products[0];
  const wh = (await call('GET', '/warehouses', as(ADM)))[0];
  const producers = list(await call('GET', '/producers', as(ADM)));
  const collectors = await call('GET', '/collectors', as(ADM));
  const col1 = collectors.find((c) => c.email === email.collecteur) ?? collectors[0];
  const col2 = collectors.find((c) => c.id !== col1.id);
  const delegates = [col1, col2].filter(Boolean);
  const bank = (await call('GET', '/financial-accounts', as(ADM))).find((a) => a.owner_type === 'other');
  const motives = await call('GET', '/convoys/advance-motives', as('caissier')).catch(() => []);
  const codes = list(motives).map((m) => m.code ?? m).filter((c) => c !== 'autre');

  const made = [];
  for (const [ci, [code, name, from, to, buy, sell, pre]] of CAMPAIGNS.entries()) {
    const camp = await soft(`campagne ${name}`, () => call('POST', '/campaigns', { ...as(ADM), body: { value_chain_id: cacao.id, code, name, traite: 'grande', starts_on: from, ends_on: to, status: 'open' } }));
    if (!camp) continue;
    made.push(camp);
    await soft(`prix de ${name}`, async () => {
      const sched = await call('POST', '/price-schedules', { ...as(ADM), body: { value_chain_id: cacao.id, campaign_id: camp.id, unit: 'kg' } });
      await call('POST', `/price-schedules/${sched.id}/versions`, { ...as(ADM), body: { unit_price: buy, valid_from: from } });
      if (prod) {
        await call('POST', `/campaigns/${camp.id}/products/${prod.id}`, as(ADM)).catch(() => null);
        await call('POST', `/products/${prod.id}/prices`, { ...as(ADM), body: { campaign_id: camp.id, buy_price_per_kg: buy, sell_price_per_kg: sell } });
      }
    });

    // Achats : déclarés à des dates réparties sur la campagne, validés, pesés, reçus au magasin
    const start = new Date(from).getTime(), span = 150 * 86400000; // les achats se concentrent sur les six premiers mois
    let ok = 0, lotId = null;
    await soft(`${N} achats de ${name}`, async () => {
      let first = null;
      for (let i = 0; i < N; i++) {
        try {
          const id = crypto.randomUUID();
          const q = 3 + ((i * 5) % 9);
          const day = new Date(start + Math.floor((i / N) * span)).toISOString().slice(0, 10);
          await call('POST', '/purchase-declarations', { ...as('collecteur'), body: { id, idempotency_key: key('decl'), producer_id: producers[(i * 7 + ci * 3) % producers.length].id, value_chain_id: cacao.id, campaign_id: camp.id, operation_date: day, quantity: String(q), unit: 'sac', bags: q, purchase_receipt_no: `${pre}-${String(i + 1).padStart(4, '0')}` } });
          await call('POST', `/purchase-declarations/${id}/submit`, as('collecteur'));
          await call('POST', `/purchase-declarations/${id}/transition`, { ...as('responsable_tracabilite'), body: { to: 'in_review' } });
          await call('POST', `/purchase-declarations/${id}/transition`, { ...as('responsable_tracabilite'), body: { to: 'accepted' } });
          const w = await call('POST', '/weighings', { ...as(ADM), body: { idempotency_key: key('w'), declaration_id: id, warehouse_id: wh.id, gross_kg: String(q * 65 + 5), tare_kg: '5' } });
          const r = await call('POST', '/receipts', { ...as('magasinier'), body: { weighing_id: w.id, ...(lotId ? { lot_id: lotId } : {}) } });
          lotId = lotId ?? r.lot_id; ok++;
        } catch (e) { first ??= e; }
      }
      if (ok < N / 2) throw first ?? new Error(`${ok} achats seulement`);
    });

    // Financements des délégués pendant la campagne (chèque, sinon espèces), datés dans la campagne
    await soft(`financements des délégués — ${name}`, async () => {
      let n = 0, first = null;
      for (const [di, d] of delegates.entries()) {
        for (let i = 0; i < 4; i++) {
          const operation_date = new Date(start + (20 + di * 9 + i * 30) * 86400000).toISOString().slice(0, 10);
          const base = { idempotency_key: key('ad'), collector_id: d.id, kind: 'advance', amount: String(400000 + i * 150000 + di * 100000), slip_no: `BRD-${pre}-${di}${i}`, motive: codes[(i + di) % Math.max(codes.length, 1)] ?? undefined, operation_date };
          try {
            await call('POST', '/convoys/advances', { ...as('caissier'), body: bank ? { ...base, payment_mode: 'cheque', cheque_no: `CHQ-${pre}-${di}${i}`, bank_account_id: bank.id } : { ...base, payment_mode: 'cash' } });
            n++;
          } catch (e) { first ??= e; }
        }
      }
      if (!n) throw first ?? new Error('aucun financement');
    });

    // REPORT : le solde de la campagne précédente est reporté sans mouvement de caisse, à la date d'ouverture de la campagne suivante.
    const next = CAMPAIGNS[ci + 1]?.[2] ?? '2026-10-01';
    const nextName = CAMPAIGNS[ci + 1]?.[1] ?? 'Grande traite 2026-2027';
    await soft(`report du solde de ${name} vers ${nextName}`, async () => {
      let n = 0, first = null;
      for (const [di, d] of delegates.entries()) {
        let solde = 0;
        try {
          const st = await call('GET', `/convoys/statement?collector_id=${d.id}&from=${from}&to=${to}`, as('comptable'));
          solde = Math.abs(Number(st.advance_outstanding ?? 0)) || Math.abs(Number(st.solde ?? 0));
        } catch { /* repli ci-dessous */ }
        if (!(solde > 0)) solde = 650000 + di * 320000 + ci * 180000; // repli : solde d'exemple si le relevé n'est pas lisible
        try {
          await call('POST', '/convoys/advances', { ...as('comptable'), body: { idempotency_key: key('cf'), collector_id: d.id, kind: 'carry_forward', amount: String(Math.round(solde)), label: `Solde de la campagne précédente (${name})`, operation_date: next } });
          n++;
        } catch (e) { first ??= e; }
      }
      if (!n) throw first ?? new Error('aucun report');
    });

    // Clôture : le bilan de la traite est figé
    await soft(`clôture de ${name}`, () => call('PUT', `/campaigns/${camp.id}`, { ...as(ADM), body: { status: 'closed' } }));
  }

  console.log(`\nHistorique des campagnes antérieures ajouté${warnings.length ? ` — ${warnings.length} avertissement(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('historique :', e.message); process.exit(1); });
