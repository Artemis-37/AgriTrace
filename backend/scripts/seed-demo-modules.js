// Modules de distribution et de services : l'ADG envoie des modèles préchargés à des groupes de producteurs, et le catalogue des articles est complété.
// Données FICTIVES. Peut être relancé : un module déjà envoyé (même intitulé) n'est pas recréé.
// Usage : API=… DEMO_JSON=/tmp/demo-accounts.json node scripts/seed-demo-modules.js
const fs = require('fs');

const API = process.env.API || 'http://localhost:3000/v1';
const J = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const warnings = [];

async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (![429, 502, 503, 504].includes(r.status) || i >= 20) return r;
    await new Promise((s) => setTimeout(s, (Number(r.headers.get('retry-after')) || 8) * 1000));
  }
}
async function call(method, p, { token, body } = {}) {
  const headers = { 'x-client': 'web', 'x-organization-id': J.org };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetchRetry(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${String(t).slice(0, 160)}`);
  return j;
}
async function soft(label, fn) { try { const r = await fn(); console.log('  ✓', label); return r; } catch (e) { warnings.push(`${label} : ${e.message}`); console.warn('  ⚠', label, '—', e.message); return null; } }
const email = (role) => J.accounts.find((a) => a.role === role)?.email;
const login = async (role) => (await call('POST', '/auth/login', { body: { email: email(role), password: J.password } })).access_token;

(async () => {
  const adg = await login('adg'), adm = await login('coop_admin');
  // Catalogue des articles distribuables (catégorie, groupe, article, unité)
  const ART = [
    ['Plants', 'Cacaoyers', 'Plants de cacaoyers améliorés', 'plant'], ['Plants', 'Arbres', 'Plants d\'arbres d\'ombrage', 'plant'], ['Plants', 'Arbres', 'Plants d\'essences locales', 'plant'],
    ['Intrants', 'Engrais', 'Engrais (sac de 50 kg)', 'sac'], ['Intrants', 'Engrais', 'Compost', 'sac'], ['Intrants', 'Produits phytosanitaires', 'Fongicide homologué', 'litre'], ['Intrants', 'Produits phytosanitaires', 'Insecticide homologué', 'litre'],
    ['Équipements', 'Protection (EPI)', 'Gants', 'paire'], ['Équipements', 'Protection (EPI)', 'Bottes', 'paire'], ['Équipements', 'Protection (EPI)', 'Masque', 'pièce'], ['Équipements', 'Protection (EPI)', 'Lunettes', 'pièce'], ['Équipements', 'Protection (EPI)', 'Combinaison', 'pièce'],
    ['Équipements', 'Outils', 'Sécateur', 'pièce'], ['Équipements', 'Outils', 'Scie de taille', 'pièce'], ['Équipements', 'Outils', 'Échenilloir', 'pièce'], ['Équipements', 'Outils', 'Pulvérisateur', 'pièce'],
    ['Conditionnement', 'Séchage et sacs', 'Sacs de jute', 'pièce'], ['Conditionnement', 'Séchage et sacs', 'Bâche de séchage', 'pièce'], ['Conditionnement', 'Fermentation', 'Caisse de fermentation', 'pièce'], ['Conditionnement', 'Fermentation', 'Claie de séchage', 'pièce'],
  ];
  let added = 0;
  for (const [category, group_name, name, unit] of ART) { try { await call('POST', '/distribution-articles', { token: adm, body: { category, group_name, name, unit } }); added++; } catch (e) { warnings.push('article ' + name + ' : ' + e.message); } }
  console.log(`  ✓ catalogue des articles (${added})`);

  const tpl = await call('GET', '/producer-assignments/templates', { token: adg });
  const have = new Set((await call('GET', '/producer-assignments', { token: adg })).map((a) => a.title));
  // Producteurs : un échantillon réparti sur la liste
  let all = [];
  for (let off = 0; off < 2000; off += 200) { const p = await call('GET', `/producers?limit=200&offset=${off}`, { token: adg }); all = all.concat(p); if (p.length < 200) break; }
  const pick = (n, shift) => all.filter((_, i) => (i + shift) % Math.max(1, Math.floor(all.length / n)) === 0).slice(0, n).map((p) => p.id);
  if (!all.length) { console.log('  ⚠ aucun producteur : rien à envoyer'); return; }
  let i = 0;
  for (const t of tpl) {
    if (have.has(t.title)) { console.log('  · déjà envoyé :', t.title); continue; }
    const scope = t.code === 'dist-plants-cacao' || t.code === 'serv-assistance-technique' ? 'all' : 'selected';
    await soft(`${t.kind === 'service' ? 'service' : 'distribution'} : ${t.title}`, () => call('POST', '/producer-assignments', { token: adg, body: {
      kind: t.kind, scope, ...(scope === 'selected' ? { producer_ids: pick(25 + (i % 4) * 10, i) } : {}), title: t.title, instructions: t.instructions, due_date: days(10 + i * 7) } }));
    i++;
  }
  console.log(warnings.length ? `\nModules de distribution et de services ajoutés — ${warnings.length} avertissement(s).` : '\nModules de distribution et de services ajoutés.');
  if (warnings.length) console.log(' - ' + warnings.join('\n - '));
})().catch((e) => { console.error(e.message); process.exit(1); });
