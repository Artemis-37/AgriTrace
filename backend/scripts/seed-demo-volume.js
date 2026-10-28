// Démonstration : porte le nombre de producteurs à 70 (producteurs réels de la coopérative, noms inventés) avec leurs vraies parcelles tracées (1 à 4).
// Lancé par seed-demo-complet.js avant la chaîne complète et l'activité des profils (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-volume.js).
// Données FICTIVES. Chaque étape est facultative : un échec est signalé sans tout arrêter.
const crypto = require('crypto');
const { REAL, producerBody, parcelBody, byCode } = require('./lib-socahi');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const TOTAL = Number(process.env.DEMO_PRODUCERS || REAL.length);
const CONC = Number(process.env.DEMO_CONCURRENCY || 6);
/** Exécute fn sur chaque élément, CONC à la fois. */
async function pool(items, fn) { let i = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }
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
/** Tous les producteurs de la coopérative (l'API en renvoie 200 au plus par page). */
async function allProducers(ctx) { const out = []; for (let off = 0; ; off += 200) { const page = list(await call('GET', `/producers?limit=200&offset=${off}`, ctx)); out.push(...page); if (page.length < 200) return out; } }
async function soft(label, fn) {
  try { const r = await fn(); console.log('  ✓', label); return r; }
  catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; }
}

(async () => {
  const MOBILE = new Set(['agent_terrain', 'collecteur', 'coach']);
  const tok = {};
  for (const a of J.accounts) {
    try { tok[a.role] = (await call('POST', '/auth/login', { client: MOBILE.has(a.role) ? 'mobile' : 'web', body: { email: a.email, password: J.password } })).access_token; } catch { /* profil indisponible */ }
  }
  const C = J.org;
  const as = (r) => ({ token: tok[r], org: C, client: MOBILE.has(r) ? 'mobile' : 'web' });
  const ADM = 'coop_admin';
  const chains = await call('GET', '/value-chains', as(ADM));
  const cacao = chains.find((v) => /cacao/i.test(v.name)) ?? chains[0];

  // ── 1. Producteurs réels (noms inventés) : on complète jusqu'à TOTAL, sans doublon (le code SOCAHI identifie le producteur)
  await soft(`producteurs réels portés à ${TOTAL}`, async () => {
    const have = new Set((await allProducers(as(ADM)).catch(() => [])).map((p) => p.internal_code));
    let fail = null, made = 0;
    await pool(REAL.slice(0, TOTAL).filter((rp) => !have.has(rp.code)), async (rp) => {
      try { await call('POST', '/producers', { ...as(ADM), body: producerBody(rp, { estimated_kg: String(Math.round(rp.area_ha * 450)), value_chain_ids: [cacao.id] }) }); made++; }
      catch (e) { fail = e; }
    });
    console.log(`    ${made} producteurs ajoutés`);
    if (!made && fail) throw fail;
  });

  // ── 2. Parcelles : les vrais tracés (1 à 4 par producteur)
  await soft('parcelles réelles (1 à 4 par producteur)', async () => {
    const producers = await allProducers(as(ADM));
    const parcels = list(await call('GET', '/parcels', as(ADM)));
    const traced = new Map();
    for (const p of parcels) if (p.geometry_area_ha != null || p.geometry) traced.set(p.producer_id, (traced.get(p.producer_id) ?? 0) + 1);
    let made = 0, fail = null;
    const jobs = [];
    for (const pr of producers) {
      const rp = byCode.get(pr.internal_code);
      if (rp) for (let j = traced.get(pr.id) ?? 0; j < rp.parcels.length; j++) jobs.push([pr, rp.parcels[j]]);
    }
    await pool(jobs, async ([pr, parcel]) => {
      try { await call('POST', '/parcels', { ...as('cartographe'), body: { idempotency_key: key('parcel'), producer_id: pr.id, ...parcelBody(parcel, cacao.id) } }); made++; }
      catch (e) { fail = e; }
    });
    console.log(`    ${made} parcelles ajoutées`);
    if (!made && fail) throw fail;
  });

  // ── 3. Inspections internes : quelques fiches renseignées (certaines à 100 %, d'autres à reprendre)
  await soft('inspections internes (fiches renseignées)', async () => {
    await call('POST', '/questionnaires/defaults', as(ADM)).catch(() => null);
    const qs = list(await call('GET', '/questionnaires', as(ADM)));
    const tpl = qs.find((q) => q.template_code === 'ii-ra');
    if (!tpl) throw new Error('modèle d\'inspection introuvable');
    const producers = list(await call('GET', '/producers', as(ADM))).slice(20, 32);
    await call('POST', '/producer-assignments', { ...as(ADM), body: { kind: 'inspection', scope: 'selected', producer_ids: producers.map((p) => p.id), questionnaire_id: tpl.id, title: 'Inspection interne — campagne en cours (démonstration)' } });
    const full = await call('GET', `/questionnaires/${tpl.id}`, as(ADM));
    const targets = list((await call('GET', '/producer-assignments?mine=1&compact=1', as(ADM))).assignments ?? []).filter((a) => a.questionnaire_id === tpl.id || a.title?.startsWith('Inspection interne — campagne'));
    const base = {};
    for (const x of full.questions) {
      if (x.type === 'choice' && x.options.includes('Conforme')) base[x.id] = 'Conforme';
      else if (x.type === 'date') base[x.id] = new Date().toISOString().slice(0, 10);
      else if (x.type === 'yesno') base[x.id] = 'oui';
      else if (x.type === 'number') base[x.id] = 1;
      else if (x.type === 'choice') base[x.id] = x.options[0];
      else if (x.required) base[x.id] = 'Renseigné (démonstration)';
    }
    const ev = full.questions.filter((x) => x.type === 'choice' && x.options.includes('Conforme'));
    let n = 0;
    for (const [i, t] of targets.entries()) {
      if (n >= 9) break;
      const a = { ...base };
      if (i % 3 === 1) a[ev[(i * 5) % ev.length].id] = 'Non conforme'; // à reprendre
      try { await call('POST', `/questionnaires/targets/${t.target_id}/answers`, { ...as('coach'), body: { answers: a } }); n++; } catch { /* ignoré */ }
    }
    console.log(`    ${n} fiches renseignées`);
    if (!n) throw new Error('aucune fiche renseignée');
  });

  console.log(`\nVolume de démonstration ajouté${warnings.length ? ` — ${warnings.length} avertissement(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('volume :', e.message); process.exit(1); });
