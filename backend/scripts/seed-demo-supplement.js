// Remplit davantage la démonstration, côté coopérative ET côté exportateur : délégués, producteurs, financements (espèces / chèque),
// convois pesés par traite, règlements, expéditions vers l'exportateur, livraisons à différents stades. Données FICTIVES.
// Lancé à la fin de seed-demo-enrichi.js (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-supplement.js).
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const warnings = [];

async function call(method, p, { token, org, body, client } = {}) {
  const headers = { 'x-client': client || 'web' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${String(t).slice(0, 200)}`);
  return j;
}
async function soft(label, fn) {
  try { const r = await fn(); console.log('  ✓', label); return r; }
  catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; }
}

(async () => {
  const email = Object.fromEntries(J.accounts.map((a) => [a.role, a.email]));
  const login = async (e, client) => (await call('POST', '/auth/login', { client, body: { email: e, password: J.password } })).access_token;
  const C = J.org, E = J.exporter?.id;
  const t = { adm: await login(email.coop_admin), mag: await login(email.magasinier), cai: await login(email.caissier), c1: await login(email.collecteur, 'mobile'), c2: await login(J.delegate2.email, 'mobile') };
  const as = (r, client) => ({ token: t[r], org: C, client });
  const ex = E ? { adm: await login(email.exp_admin), pb: await login(email.pont_bascule), an: await login(email.analyste), cai: await login(email.exp_caissier) } : null;
  const asE = (r) => ({ token: ex[r], org: E });

  const chains = await call('GET', '/value-chains', as('adm'));
  const cacao = chains.find((v) => /cacao/i.test(v.name)) ?? chains[0];
  const wh = (await call('GET', '/warehouses', as('adm')))[0];
  const collectors = await call('GET', '/collectors', as('adm'));
  const c1 = collectors.find((c) => c.email === email.collecteur) ?? collectors[0];
  const c2 = collectors.find((c) => c.id === J.delegate2.collector_id) ?? collectors[1];

  // ── Nouveaux délégués, sans accès à l'application (seuls Nom, Prénoms et Code sont obligatoires)
  const newCols = [];
  await soft('4 délégués supplémentaires', async () => {
    const role = await call('POST', '/roles/standard', { ...as('adm'), body: { code: 'collecteur' } });
    const people = [['Koffi Yao', 'KYAO', 'Daloa'], ['Awa Traoré', 'ATRA', 'Hiré'], ['Séraphin Gnagne', 'SGNA', 'Divo'], ['Mariam Sylla', 'MSYL', 'Gagnoa']];
    for (const [name, code, origin] of people) {
      const u = await call('POST', '/users', { ...as('adm'), body: { full_name: name, role_id: role.id, member_code: `DEL-${code}` } }).catch(() => null);
      if (!u) continue;
      const c = await call('POST', '/collectors', { ...as('adm'), body: { user_id: u.id, origin } });
      await call('PUT', `/collectors/${c.id}/profile`, { ...as('adm'), body: { bank_name: 'Banque Exemple (fictive)', bank_account: 'CI00 0000 0000 ' + code } }).catch(() => {});
      await call('POST', `/collectors/${c.id}/assignments`, { ...as('adm'), body: { value_chain_id: cacao.id } }).catch(() => {});
      newCols.push(c);
    }
    if (!newCols.length && !collectors.some((c) => c.full_name === 'Awa Traoré')) throw new Error('aucun délégué créé');
    for (const c of collectors) if (['Koffi Yao', 'Awa Traoré', 'Séraphin Gnagne', 'Mariam Sylla'].includes(c.full_name)) newCols.push(c);
  });

  // ── Producteurs supplémentaires
  await soft('24 producteurs supplémentaires', async () => {
    const villages = ['Hiré', 'Bamoro', 'Kouassidjo', 'Zikisso', 'Ahouanou', 'Dougroupalégnoa'];
    const noms = ['Kouadio', 'Yao', 'Konan', 'Traoré', 'Coulibaly', 'Bamba', 'Gnagne', 'Ouattara'];
    const prenoms = ['Adjoua', 'Kouamé', 'Aya', 'Moussa', 'Aminata', 'Yves', 'Fatou', 'Jean'];
    let n = 0;
    const have = await call('GET', '/producers', as('adm')).then((r) => (Array.isArray(r) ? r : r.items ?? r.rows ?? []).length);
    if (have >= 30) return;
    for (let i = 0; i < 24; i++) {
      try {
        await call('POST', '/producers', { ...as('adm'), body: { last_name: noms[i % 8], first_names: prenoms[(i * 3) % 8] + ' ' + (i + 1), gender: i % 3 ? 'male' : 'female', village: villages[i % 6], region: 'Gôh', department: 'Divo', area_ha: String(1 + (i % 7) * 0.8), estimated_kg: String(800 + i * 120), phone: '+22507' + String(10000000 + i * 137).slice(0, 8), consent: true, value_chain_ids: [cacao.id] } });
        n++;
      } catch (e) { if (!n) throw e; }
    }
  });

  // La caisse est réapprovisionnée (fictif) avant les financements en espèces.
  await soft('réapprovisionnement de la caisse', async () => {
    const cash = (await call('GET', '/financial-accounts', as('cai'))).find((a) => a.owner_type === 'cash_register');
    const reg = (await call('GET', '/cash-registers', as('cai'))).find((r) => r.open_session_id);
    if (!cash || !reg) throw new Error('aucune session de caisse ouverte');
    await call('POST', '/financial-transactions', { ...as('cai'), body: { idempotency_key: key('cashin'), account_id: cash.id, direction: 'in', amount: '30000000', reason: 'Approvisionnement de la caisse (démonstration)', cash_session_id: reg.open_session_id } });
  });

  // ── Financements des délégués : espèces et chèque, avec motif codé
  const bank = (await call('GET', '/financial-accounts', as('cai'))).find((a) => a.owner_type === 'other');
  await soft('financements des délégués (espèces / chèque)', async () => {
    const motives = await call('GET', '/convoys/advance-motives', as('cai')).catch(() => []);
    const codes = (Array.isArray(motives) ? motives : motives.items ?? []).map((m) => m.code ?? m).filter((c) => c !== 'autre');
    const m = (i) => codes[i % Math.max(codes.length, 1)] ?? undefined;
    const targets = [c1, c2, ...newCols].filter(Boolean);
    let i = 0;
    for (const c of targets) {
      await call('POST', '/convoys/advances', { ...as('cai'), body: { idempotency_key: key('ad'), collector_id: c.id, kind: 'advance', amount: String(500000 + i * 250000), payment_mode: 'cash', slip_no: 'BRD-' + (100 + i), motive: m(i), operation_date: days(-12 + i) } });
      if (bank && i % 2 === 0) await call('POST', '/convoys/advances', { ...as('cai'), body: { idempotency_key: key('ad'), collector_id: c.id, kind: 'advance', amount: String(1000000 + i * 500000), payment_mode: 'cheque', cheque_no: 'CHQ-' + (7000 + i), slip_no: 'BRD-' + (200 + i), motive: m(i + 1), bank_account_id: bank.id, operation_date: days(-8 + i) } });
      i++;
    }
  });

  // ── Achats des délégués (déclarés, validés), puis convois chargés de ces achats, pesés au magasin ; certains réglés
  const campaigns = await call('GET', '/campaigns', as('adm'));
  const products = await call('GET', '/products', as('adm'));
  const camp = campaigns.find((c) => c.status === 'open' || c.active) ?? campaigns[0];
  const prod = products.find((p) => /cacao/i.test(p.name)) ?? products[0];
  const allProducers = await call('GET', '/producers', as('adm')).then((r) => (Array.isArray(r) ? r : r.items ?? r.rows ?? []));
  await soft('achats, convois, pesées et règlements', async () => {
    const buy = async (tk, n, offset) => {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const id = crypto.randomUUID(), q = 3 + (i % 4);
        await call('POST', '/purchase-declarations', { ...as(tk, 'mobile'), body: { id, idempotency_key: key('decl'), producer_id: allProducers[(offset + i) % allProducers.length].id, value_chain_id: cacao.id, campaign_id: camp?.id, operation_date: days(-6 + (i % 5)), quantity: String(q), unit: 'sac', bags: q, purchase_receipt_no: `SUP-${run}-${tk}${offset + i}` } });
        await call('POST', `/purchase-declarations/${id}/submit`, as(tk, 'mobile'));
        await call('POST', `/purchase-declarations/${id}/transition`, { ...as('adm'), body: { to: 'in_review' } });
        await call('POST', `/purchase-declarations/${id}/transition`, { ...as('adm'), body: { to: 'accepted' } });
        ids.push(id);
      }
      return ids;
    };
    const plan = [['c1', c1, 5, 'settle', 5], ['c1', c1, 4, 'settle', 40], ['c1', c1, 4, 'weighed', 70], ['c2', c2, 5, 'settle', 100], ['c2', c2, 4, 'weighed', 130], ['c2', c2, 3, 'transit', 160]];
    for (const [tk, col, count, state, off] of plan) {
      const ids = await buy(tk, count, off);
      const kg = ids.length * 4 * 65;
      const cv = await call('POST', '/convoys', { ...as(tk, 'mobile'), body: { idempotency_key: key('cv'), driver_name: 'Traoré Moussa', truck_no: 'AB 1' + (off % 9) + '4 CI', declared_bags: ids.length * 4, declared_kg: String(kg), declaration_ids: ids } });
      if (state === 'transit') continue;
      const r = await call('POST', '/convoys/receive', { ...as('mag'), body: { idempotency_key: key('rc'), collector_id: col.id, convoy_no: cv.convoy_no, warehouse_id: wh.id, ...(prod && { product_id: prod.id }), ...(camp && { campaign_id: camp.id }), total_kg: String(kg - 12), bags: ids.length * 4 } });
      if (state === 'settle') await call('POST', `/convoy-receptions/${r.id}/settle`, { ...as('cai'), body: { idempotency_key: key('st') } }).catch((e) => warnings.push('règlement ' + cv.convoy_no + ' : ' + e.message));
    }
  });

  // ── Lien coopérative ↔ exportateur : proposé puis accepté s'il n'existe pas encore (les deux deviennent partenaires)
  if (ex) await soft('lien avec l\'exportateur', async () => {
    const links = await call('GET', '/org-links', as('adm'));
    const mine = links.find((l) => l.other_id === E);
    if (mine?.status === 'active') return;
    if (mine?.status === 'pending') { await call('POST', `/org-links/${mine.id}/accept`, { ...(mine.requested_by_me ? asE('adm') : as('adm')), body: {} }); return; }
    const exCode = J.exporter.code;
    if (!exCode) throw new Error('code exportateur inconnu');
    await call('POST', '/org-links', { ...as('adm'), body: { code: exCode } });
    const pending = (await call('GET', '/org-links', asE('adm'))).find((l) => l.status === 'pending');
    if (pending) await call('POST', `/org-links/${pending.id}/accept`, { ...asE('adm'), body: {} });
  });

  // ── Côté exportateur : expéditions de la coopérative, livraisons à différents stades
  if (ex) await soft('livraisons à l\'exportateur à différents stades', async () => {
    const convs = await call('GET', '/dispatch-sheets/convoys', as('adm'));
    if (convs.length < 3) throw new Error('pas assez de convois réceptionnés à expédier');
    const log = (m, p, b) => call(m, p, { ...as('adm'), body: b });
    for (const [i, cv] of convs.slice(0, 5).entries()) {
      const sh = await log('POST', '/dispatch-sheets', { convoy_ids: [cv.id], bl_no: `BL-SUP-${run}-${i + 1}`, lot_id_dse: `DSE-SUP-${run}-${i + 1}`, driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', departure_date: days(-3 + i) });
      await log('POST', `/dispatch-sheets/${sh.id}/transmit`, { destination_org_id: E });
    }
    const dels = (await call('GET', '/deliveries', asE('adm'))).filter((d) => d.status === 'announced' || d.status === 'in_transit' || !d.gross_kg);
    const kgOf = (d) => Number(d.declared_kg ?? d.declared_net_kg ?? 1000);
    // 1) pesée à l'entrée seulement ; 2) pesée complète ; 3) analysée acceptée ; 4) analysée et réglée ; le reste : annoncé
    const [d1, d2, d3, d4] = dels;
    if (d1) await call('POST', `/deliveries/${d1.id}/weigh-in`, { ...asE('pb'), body: { gross_kg: kgOf(d1) + 8000, origin: 'Hiré', transporter: 'Transafrik Logistique (fictif)', bridge_in: 'PONT 1' } });
    for (const [d, bags, refused] of [[d2, 40, 0], [d3, 38, 2], [d4, 30, 0]]) {
      if (!d) continue;
      await call('POST', `/deliveries/${d.id}/weigh-in`, { ...asE('pb'), body: { gross_kg: kgOf(d) + 8000, origin: 'Hiré', transporter: 'Transafrik Logistique (fictif)', bridge_in: 'PONT 1' } });
      await call('POST', `/deliveries/${d.id}/weigh-out`, { ...asE('pb'), body: { tare_kg: 8000, bags_discharged: bags, bags_refused: refused, sack_tare_kg: 20, pallet_tare_kg: 0, bridge_out: 'PONT 2' } });
    }
    for (const [d, m, g] of [[d3, 7.4, 'GRADE 1'], [d4, 7.8, 'GRADE 2']]) {
      if (!d) continue;
      await call('POST', `/deliveries/${d.id}/analysis`, { ...asE('an'), body: { moisture_pct: m, bean_count: 96, defects: { mouldy: 1, slaty: 2, insect: 0.5, residues: 2, crabots: 2 }, refaction_kg: 10, grade: g, decision: 'accepted' } });
    }
    if (d4) await call('POST', `/deliveries/${d4.id}/settle`, { ...asE('cai'), body: { unit_price: 1480, payment_ref: 'VIR-EXP-SUP-1' } });
  });

  console.log(`\nDonnées supplémentaires ajoutées${warnings.length ? ` — ${warnings.length} avertissement(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('compléments :', e.message); process.exit(1); });
