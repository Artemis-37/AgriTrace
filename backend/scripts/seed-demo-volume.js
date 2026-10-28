// Démonstration : porte le nombre de producteurs à 70 et donne à chacun de 1 à 5 parcelles tracées (polygones fictifs autour de Hiré).
// Lancé par seed-demo-complet.js avant la chaîne complète et l'activité des profils (ou seul : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-volume.js).
// Données FICTIVES. Chaque étape est facultative : un échec est signalé sans tout arrêter.
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const TOTAL = Number(process.env.DEMO_PRODUCERS || 70);
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

// Nombre de parcelles visé selon le rang du producteur : la plupart en ont 1 ou 2, quelques-uns de 3 à 5.
const PATTERN = [1, 2, 1, 3, 1, 2, 4, 1, 2, 5, 1, 2, 3, 1];
const VILLAGES = [['Hiré', 'S1'], ['Bamoro', 'S2'], ['Kouassidjo', 'S2'], ['Zikisso', 'S3'], ['Ahouanou', 'S3'], ['Dougroupalégnoa', 'S1'], ['Zégban', 'S2'], ['Zoukougbeu', 'S3']];
const NOMS = ['KOUADIO', 'YAO', 'KONAN', 'TRAORE', 'COULIBALY', 'BAMBA', 'GNAGNE', 'OUATTARA', 'KOFFI', 'DOSSO', 'TOURE', 'AKA', 'BROU', 'DIABATE', 'N\'DRI', 'ZAHUI', 'GBAGBO', 'LOUKOU', 'ASSI', 'SORO'];
const PRENOMS = ['Adjoua', 'Kouamé', 'Aya', 'Moussa', 'Aminata', 'Yves', 'Fatou', 'Jean', 'Affoué', 'Ibrahim', 'Marie', 'Paul', 'Salimata', 'Désiré', 'Odette', 'Hervé', 'Nanan', 'Léa', 'Rodrigue', 'Mariam'];

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

  // ── 1. Producteurs : on complète jusqu'à TOTAL
  await soft(`producteurs portés à ${TOTAL}`, async () => {
    const have = list(await call('GET', '/producers', as(ADM))).length;
    let fail = null, made = 0;
    for (let i = have; i < TOTAL; i++) {
      const [village, section] = VILLAGES[i % VILLAGES.length];
      try {
        await call('POST', '/producers', { ...as(ADM), body: { last_name: NOMS[(i * 7) % NOMS.length], first_names: `${PRENOMS[(i * 3) % PRENOMS.length]} ${i + 1}`, gender: i % 3 ? 'male' : 'female', village, section, region: 'Gôh', department: 'Divo', phone: '+22507' + String(20000000 + i * 1371).slice(0, 8), area_ha: String((1.5 + (i % 9) * 0.7).toFixed(1)), estimated_kg: String(900 + i * 95), consent: true, value_chain_ids: [cacao.id] } });
        made++;
      } catch (e) { fail = e; }
    }
    if (!made && have < TOTAL && fail) throw fail;
  });

  // ── 2. Parcelles : de 1 à 5 par producteur, polygones espacés (jamais de chevauchement)
  await soft('parcelles (1 à 5 par producteur)', async () => {
    const producers = list(await call('GET', '/producers', as(ADM)));
    const parcels = list(await call('GET', '/parcels', as(ADM)));
    const count = new Map();
    for (const p of parcels) count.set(p.producer_id, (count.get(p.producer_id) ?? 0) + 1);
    const sq = (lon, lat, s) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s * 0.8], [lon, lat + s * 0.8], [lon, lat]]] });
    let k = 0, made = 0, fail = null;
    for (const [i, pr] of producers.entries()) {
      const target = PATTERN[i % PATTERN.length];
      for (let j = count.get(pr.id) ?? 0; j < target; j++, k++) {
        // Grille à l'est de Hiré (fictif), distincte de celle de la chaîne complète : 20 colonnes, 0,006° d'écart, 0,004° entre les rangées.
        const lon = -5.25 + (k % 20) * 0.006, lat = 6.05 + Math.floor(k / 20) * 0.004;
        const s = 0.0016 + ((k * 7) % 5) * 0.0002;
        try {
          await call('POST', '/parcels', { ...as('cartographe'), body: { idempotency_key: key('parcel'), producer_id: pr.id, value_chain_id: cacao.id, declared_area_ha: (s * s * 0.8 * 110700 * 110574 / 1e4).toFixed(1), geometry: sq(lon, lat, s), confirm_not_duplicate: true } });
          made++;
        } catch (e) { fail = e; }
      }
    }
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
