// Démonstration : certifications (Rainforest Alliance, Fairtrade, Fairtrade USA, cacao biologique) de la coopérative et de ses producteurs,
// TROIS exportateurs liés à la coopérative, et des audits portant sur les campagnes (anciennes et en cours), avec constats, réponses et vérifications.
// Lancé à la fin de seed-demo-complet.js, après les campagnes antérieures (ou seul : API=… ADMIN_EMAIL=… ADMIN_PASSWORD=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-certifications.js).
// Données FICTIVES : numéros, organismes et exportateurs inventés. Chaque étape est facultative.
const crypto = require('crypto');
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const DEMO_JSON = process.env.DEMO_JSON || '/tmp/demo-accounts.json';
const J = JSON.parse(fs.readFileSync(DEMO_JSON, 'utf8'));
const run = crypto.randomBytes(2).toString('hex').toUpperCase();
const CONC = Number(process.env.DEMO_CONCURRENCY || 6);
const PRODUCER_CERTS = Number(process.env.DEMO_PRODUCER_CERTS || 400); // nombre de producteurs dotés de certificats individuels
const warnings = [];
const days = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

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
async function pool(items, fn) { let i = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (i < items.length) { const it = items[i++]; await fn(it, i); } })); }
async function allProducers(ctx) { const out = []; for (let off = 0; ; off += 200) { const page = list(await call('GET', `/producers?limit=200&offset=${off}`, ctx)); out.push(...page); if (page.length < 200) return out; } }

const SCHEMES = [
  ['Rainforest Alliance', 'RA', 'Organisme de certification (démonstration)'],
  ['Fairtrade', 'FT', 'Organisme de certification Fairtrade (démonstration)'],
  ['Fairtrade USA', 'FTUSA', 'Organisme de certification Fairtrade USA (démonstration)'],
  ['Cacao biologique', 'BIO', 'Organisme de certification biologique (démonstration)'],
];
const EXPORTERS = [
  { name: 'Exportateur Démo Abidjan', dom: 'exportateur-abidjan.test', role: 'exp2_admin', person: 'Awa Traoré' },
  { name: 'Exportateur Démo San Pedro', dom: 'exportateur-sanpedro.test', role: 'exp3_admin', person: 'Marcel Kouamé' },
];

(async () => {
  const MOBILE = new Set(['agent_terrain', 'collecteur', 'coach']);
  const tok = {};
  for (const a of J.accounts) {
    try { tok[a.role] = (await call('POST', '/auth/login', { client: MOBILE.has(a.role) ? 'mobile' : 'web', body: { email: a.email, password: J.password } })).access_token; } catch { /* profil indisponible */ }
  }
  const C = J.org;
  const ADM = 'coop_admin';
  const as = (r) => ({ token: tok[r], org: C, client: MOBILE.has(r) ? 'mobile' : 'web' });
  const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: J.password } })).access_token;

  // ── 1. Certificats de la coopérative
  await soft('certificats de la coopérative (RA, FT, FTUSA, bio)', async () => {
    for (const [i, [scheme, abbr, issuer]] of SCHEMES.entries()) {
      await call('POST', '/certificates', { ...as(ADM), body: { holder_type: 'organization', scheme, number: `${abbr}-SOC-${String(2026 + i)}-${run}`, issuer, issued_on: days(-300 + i * 30), expires_on: days(abbr === 'BIO' ? 45 : 330 + i * 20) } });
    }
  });

  // ── 2. Certificats individuels : Rainforest Alliance pour tous, Fairtrade pour la plupart, Fairtrade USA et bio pour une partie
  await soft(`certificats individuels (${PRODUCER_CERTS} producteurs)`, async () => {
    const producers = (await allProducers(as(ADM))).slice(0, PRODUCER_CERTS);
    let made = 0;
    await pool(producers, async (pr, n) => {
      const have = [['Rainforest Alliance', 'RA']];
      if (n % 10 < 7) have.push(['Fairtrade', 'FT']);
      if (n % 4 === 0) have.push(['Fairtrade USA', 'FTUSA']);
      if (n % 7 === 0) have.push(['Cacao biologique', 'BIO']);
      for (const [scheme, abbr] of have) {
        try {
          await call('POST', '/certificates', { ...as(ADM), body: { holder_type: 'producer', holder_id: pr.id, scheme, number: `${abbr}-${pr.internal_code}-${run}`, issuer: SCHEMES.find((s) => s[1] === abbr)[2], issued_on: days(-250), expires_on: days(abbr === 'BIO' ? 60 + (n % 90) : 200 + (n % 160)) } });
          made++;
        } catch (e) { if (!made) throw e; }
      }
    });
    console.log(`    ${made} certificats`);
  });

  // ── 3. Trois exportateurs liés à la coopérative (le premier existe déjà)
  const exporters = [{ id: J.exporter?.id, name: J.exporter?.name, code: J.exporter?.code, role: 'exp_admin' }];
  const newAccounts = [];
  for (const x of EXPORTERS) {
    await soft(`exportateur « ${x.name} »`, async () => {
      const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).access_token;
      const code = 'EXP' + crypto.randomBytes(2).toString('hex').toUpperCase() + run;
      const ex = await call('POST', '/organizations', { token: adm, body: { code, name: x.name, kind: 'exporter' } });
      const email = `admin@${x.dom}`;
      await call('POST', `/organizations/${ex.id}/admins`, { token: adm, body: { email, full_name: `${x.person} (administrateur)`, password: J.password } });
      const EA = { token: await login(email), org: ex.id };
      const lk = await call('POST', '/org-links', { ...as(ADM), body: { code: ex.code ?? code, direction: 'supply_to' } });
      await call('POST', `/org-links/${lk.id}/accept`, EA);
      exporters.push({ id: ex.id, name: x.name, code: ex.code ?? code, role: x.role, token: EA.token });
      newAccounts.push({ role: x.role, label: 'Administrateur (exportateur)', name: x.person, email, org: ex.id });
    });
  }
  if (newAccounts.length) { J.accounts.push(...newAccounts); J.exporters = exporters.map(({ token, ...e }) => e); fs.writeFileSync(DEMO_JSON, JSON.stringify(J)); }
  for (const e of exporters) if (!e.token && e.id) e.token = tok[e.role] ?? null;

  // ── 4. Audits portant sur les campagnes : un exportateur par audit (clos, en réponse, en cours, programmé)
  const orgs = await call('GET', '/organizations', as(ADM)).catch(() => []);
  const coopCode = (orgs.find((o) => o.id === C) ?? {}).code;
  const AUDITS = [
    { ex: 0, title: 'Audit de la campagne 2024-2025 : traçabilité, pesées et stock', scope: ['tracabilite', 'pesee', 'stock'], from: -330, to: -300, state: 'closed',
      findings: [['tracabilite', 'conform', 'Traçabilité des achats jusqu\'au producteur', 'Les achats contrôlés remontent tous au producteur et à sa parcelle.'], ['pesee', 'minor', 'Registre de pesée signé par le magasinier', 'Quatre pesées sans signature du magasinier sur la campagne.'], ['stock', 'observation', 'Rapprochement du stock physique et du stock comptable', 'Écart de 0,4 % constaté à la clôture, dans la tolérance.']] },
    { ex: 1, title: 'Audit de la campagne 2025-2026 : caisse, comptabilité et financements des délégués', scope: ['caisse', 'comptabilite'], from: -120, to: -90, state: 'issued',
      findings: [['caisse', 'major', 'Justificatifs des sorties de caisse', 'Sept sorties de caisse sans pièce justificative jointe.'], ['comptabilite', 'minor', 'Report du solde des délégués d\'une campagne à la suivante', 'Un report sans note de l\'approbateur.'], ['comptabilite', 'conform', 'Clôture de la campagne et bilan figé', 'La campagne est clôturée et le bilan est figé.']] },
    { ex: 2, title: 'Audit de la campagne 2026-2027 (en cours) : social, environnement et certifications', scope: ['social', 'environnement', 'tracabilite'], from: -15, to: 30, state: 'in_progress',
      findings: [['social', 'observation', 'Suivi du travail des enfants', 'Visites de suivi réalisées dans 6 sections sur 9 à ce jour.'], ['environnement', 'minor', 'Parcelles proches des aires protégées', 'Deux parcelles à vérifier par rapport à la couche de référence.']] },
    { ex: 0, title: 'Audit programmé : préparation de la campagne 2027-2028', scope: ['tracabilite', 'stock'], from: 60, to: 75, state: 'planned', findings: [] },
  ];
  for (const a of AUDITS) {
    const e = exporters[a.ex];
    if (!e?.id || !e.token) continue;
    const EX = { token: e.token, org: e.id };
    await soft(`audit : ${a.title}`, async () => {
      if (coopCode) await call('POST', '/supervisions', { ...EX, body: { code: coopCode } }).then((sp) => call('POST', `/supervisions/${sp.id}/accept`, { ...as(ADM), body: {} })).catch(() => null); // lien de supervision (déjà créé : ignoré)
      const au = await call('POST', '/audits', { ...EX, body: { supervised_org_id: C, title: a.title, scope: a.scope, starts_on: days(a.from), ends_on: days(a.to) } });
      if (a.state === 'planned') return;
      await call('POST', `/audits/${au.id}/start`, { ...EX, body: {} });
      const cs = list(await call('GET', `/audits/${au.id}/candidates`, as(ADM)).catch(() => []));
      for (const c of cs.slice(0, 2)) await call('POST', `/audits/${au.id}/participants`, { ...as(ADM), body: { user_id: c.id ?? c.user_id } }).catch(() => null);
      const fs2 = [];
      for (const [area, result, requirement, description] of a.findings) fs2.push(await call('POST', `/audits/${au.id}/findings`, { ...EX, body: { area, result, requirement, description, ...(result === 'major' || result === 'minor' ? { due_on: days(a.to + 30) } : {}) } }));
      if (a.state === 'in_progress') return;
      await call('POST', `/audits/${au.id}/issue`, { ...EX, body: {} });
      for (const f of fs2.filter((x) => x.result !== 'conform')) {
        await call('POST', `/audits/${au.id}/findings/${f.id}/respond`, { ...as(ADM), body: { response: 'Constat accepté.', action_plan: 'Action corrective engagée et suivie par la direction.', action_due_on: days(a.to + 20) } }).catch(() => null);
        if (a.state === 'closed') await call('POST', `/audits/${au.id}/findings/${f.id}/verify`, { ...EX, body: { comment: 'Action vérifiée.' } }).catch(() => null);
      }
      if (a.state === 'closed') await call('POST', `/audits/${au.id}/close`, { ...EX, body: { summary: 'Audit clos : constats traités et vérifiés, aucune non-conformité majeure.' } });
    });
  }

  console.log(`\nCertifications, exportateurs et audits ajoutés${warnings.length ? ` — ${warnings.length} avertissement(s)` : ''}.`);
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error('certifications :', e.message); process.exit(1); });
