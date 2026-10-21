// Bibliothèque de modules de formation : chargement par défaut, lecture par les coachs, conserver/modifier/supprimer par l'ADG.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mkOrg = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef', password: pw } });
    return { org, t0: await login(mail, pw) };
  };
  const A = await mkOrg('FA'), B = await mkOrg('FB');
  const J = (o, t) => ({ token: t, org: o.id });
  const person = async (o, code, tag) => {
    const r = (await call('POST', '/roles/standard', { ...J(o.org, o.t0), body: { code } })).body;
    const email = `${tag}.${run}@t.test`;
    await call('POST', '/users', { ...J(o.org, o.t0), body: { email, full_name: tag, password: pw, role_id: r.id } });
    return await login(email, pw);
  };
  const coach = await person(A, 'coach', 'coach'), adg = await person(A, 'adg', 'adg'), mag = await person(A, 'magasinier', 'mag');

  console.log('Chargement par défaut');
  const l = await call('GET', '/training-modules', J(A.org, coach));
  check('le coach lit la bibliothèque', l.status === 200 && Array.isArray(l.body) && l.body.length >= 20, l.status);
  const mods = l.body;
  const cacao = mods.filter((m) => m.crops.includes('cacao')).length, cafe = mods.filter((m) => m.crops.includes('cafe')).length;
  check('cacao en priorité, café aussi présent', cacao > cafe && cafe >= 3, { cacao, cafe });
  check('modules à relire par défaut', mods.every((m) => m.review_state === 'to_review'));
  check('contenu structuré (objectifs, sections, vérifications)', mods.every((m) => m.content.objectifs.length && m.content.sections.length && Array.isArray(m.content.verifier)));
  check('codes uniques', new Set(mods.map((m) => m.code)).size === mods.length);
  check('un second appel ne recharge pas', (await call('GET', '/training-modules', J(A.org, coach))).body.length === mods.length);
  check('filtre par culture', (await call('GET', '/training-modules?crop=cafe', J(A.org, coach))).body.every((m) => m.crops.includes('cafe')));
  check('filtre par certification', (await call('GET', '/training-modules?certification=EUDR', J(A.org, coach))).body.length >= 2);
  check('recherche texte', (await call('GET', '/training-modules?q=fermentation', J(A.org, coach))).body.some((m) => m.code === 'cacao-fermentation'));
  check('détail d\'un module', (await call('GET', `/training-modules/${mods[0].id}`, J(A.org, coach))).body.id === mods[0].id);
  check('un autre rôle sans droit est refusé', (await call('GET', '/training-modules', J(A.org, mag))).status === 403);
  check('coopérative voisine : sa propre bibliothèque', (await call('GET', '/training-modules', J(B.org, B.t0))).body.length === mods.length);

  console.log('Le coach ne modifie rien');
  const m0 = mods.find((m) => m.code === 'cacao-taille');
  const payload = (m, extra = {}) => ({ theme: m.theme, title: m.title, summary: m.summary, crops: m.crops, certifications: m.certifications, level: m.level, duration_min: m.duration_min, content: m.content, ...extra });
  check('modification refusée', (await call('PUT', `/training-modules/${m0.id}`, { ...J(A.org, coach), body: payload(m0, { title: 'Piraté' }) })).status === 403);
  check('suppression refusée', (await call('DELETE', `/training-modules/${m0.id}`, J(A.org, coach))).status === 403);
  check('« conserver » refusé', (await call('POST', `/training-modules/${m0.id}/keep`, J(A.org, coach))).status === 403);

  console.log('L\'ADG conserve, modifie, supprime');
  const k = await call('POST', `/training-modules/${m0.id}/keep`, J(A.org, adg));
  check('conserver : état « kept »', k.status === 201 && k.body.review_state === 'kept', k.body);
  const newContent = { ...m0.content, a_eviter: [...m0.content.a_eviter, 'Tailler pendant une période de fortes pluies'] };
  const e = await call('PUT', `/training-modules/${m0.id}`, { ...J(A.org, adg), body: payload(m0, { title: 'La taille du cacaoyer (version coopérative)', content: newContent }) });
  check('modifier : état « edited », version 2', e.status === 200 && e.body.review_state === 'edited' && e.body.version === 2 && e.body.title.includes('coopérative'), e.body);
  check('le coach voit la version modifiée', (await call('GET', `/training-modules/${m0.id}`, J(A.org, coach))).body.title.includes('coopérative'));
  check('contenu invalide refusé', (await call('PUT', `/training-modules/${m0.id}`, { ...J(A.org, adg), body: payload(m0, { content: { objectifs: [], sections: [] } }) })).status === 400);
  check('culture inconnue refusée', (await call('PUT', `/training-modules/${m0.id}`, { ...J(A.org, adg), body: payload(m0, { crops: ['mais'] }) })).status === 400);
  const c = await call('POST', '/training-modules', { ...J(A.org, adg), body: { theme: 'Diversification', title: 'Apiculture en cacaoyère', summary: 'Module propre à la coopérative', crops: ['cacao'], certifications: [], level: 'base', duration_min: 30, content: { objectifs: ['Installer une ruche'], sections: [{ titre: 'Installer', points: ['Choisir un endroit calme'] }] } } });
  check('créer un module propre', c.status === 201 && c.body.review_state === 'custom', c.body);
  const m1 = mods.find((m) => m.code === 'cafe-recolte-post-recolte');
  check('supprimer', (await call('DELETE', `/training-modules/${m1.id}`, J(A.org, adg))).status === 200 && (await call('GET', `/training-modules/${m1.id}`, J(A.org, coach))).status === 404);
  const after = (await call('GET', '/training-modules', J(A.org, coach))).body;
  check('le coach ne voit plus le module supprimé, voit le module créé', !after.some((m) => m.id === m1.id) && after.some((m) => m.id === c.body.id));
  check('la suppression n\'est pas annulée par une relecture de la liste', after.length === mods.length);
  const r = await call('POST', '/training-modules/restore-defaults', J(A.org, adg));
  check('restaurer : seul le module supprimé revient, le module modifié reste modifié', r.body.restored === 1 && (await call('GET', `/training-modules/${m0.id}`, J(A.org, coach))).body.version === 2, r.body);
  check('l\'autre coopérative n\'a rien subi', (await call('GET', '/training-modules', J(B.org, B.t0))).body.length === mods.length);
  const aud = await call('GET', '/audit-logs?limit=200', J(A.org, A.t0));
  check('actions tracées (journal d\'audit)', aud.status !== 200 || JSON.stringify(aud.body).includes('training_module.delete'), aud.status);

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
