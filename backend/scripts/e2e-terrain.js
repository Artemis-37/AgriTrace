// Test de bout en bout : enregistrements de terrain (producteur enrichi, infrastructure sociale, formation, distribution).
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const uuid = () => crypto.randomUUID();

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mk = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    const mail = `${tag.toLowerCase()}.${run}@t.test`;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
    return { org, t: await login(mail, pw) };
  };
  const A = await mk('FA'), B = await mk('FB');
  const J = (X, tok) => ({ token: tok ?? X.t, org: X.org.id });
  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(A), body: { code, name: code, permissions } })).body;
  const user = async (tag, r) => {
    const email = `${tag}.${run}@t.test`;
    const u = (await call('POST', '/users', { ...J(A), body: { email, full_name: tag, password: pw, role_id: r.id } })).body;
    return { id: u.id, t: await login(email, pw) };
  };
  const rCoach = await role('coach', ['producers:read', 'producers:create', 'field_records:create', 'field_records:read', 'sync:use']);
  const rLect = await role('lecteur', ['producers:read', 'sync:use']);
  const coach = await user('coach1', rCoach), lect = await user('lect', rLect);
  check('mise en place', !!(coach.id && lect.t));

  const batch = (tok, ops) => call('POST', '/sync/batch', { ...J(A, tok), body: { operations: ops } });
  const op = (type, payload) => ({ idempotency_key: `${type}-${crypto.randomBytes(6).toString('hex')}`, type, payload });

  console.log('Producteur créé hors connexion');
  const pid = uuid();
  const pOp = op('producer.create', { id: pid, last_name: 'ADJUE', first_names: 'Dadie', gender: 'male', birth_date: '1985-03-02', id_doc_type: 'CNI', id_doc_number: 'CI005771931', phone: '+2250700000001', village: 'Hiré', section: 'Kagbé', consent: true });
  const r1 = await batch(coach.t, [pOp]);
  check('création acceptée', r1.body.results?.[0]?.status === 'accepted' || r1.body.results?.[0]?.status === 'processed' || r1.body.results?.[0]?.status === 'applied', r1.body);
  const got = await call('GET', `/producers/${pid}`, { ...J(A, coach.t) });
  check("l'identifiant fourni par l'appareil est conservé", got.body.id === pid && /./.test(got.body.internal_code ?? ''), got.body);
  check('sexe, naissance et consentement enregistrés', got.body.gender === 'male' && String(got.body.birth_date).startsWith('1985-03-02') && !!got.body.consent_at, got.body);
  check("numéro de pièce d'identité masqué sans droit sensible", got.body.id_doc_number === undefined, got.body);
  const r1b = await batch(coach.t, [pOp]);
  check('renvoi de la même opération : pas de doublon', r1b.body.results?.[0]?.status === r1.body.results?.[0]?.status);
  check('lecteur ne crée pas de producteur', (await batch(lect.t, [op('producer.create', { id: uuid(), last_name: 'X', first_names: 'Y' })])).body.results?.[0]?.status === 'rejected');
  { const x = (await batch(coach.t, [op('producer.create', { id: uuid(), last_name: 'X', first_names: 'Y', gender: 'autre' })])).body.results?.[0]; check('sexe invalide refusé', x?.status !== 'accepted' && x?.status !== 'processed' && x?.status !== 'applied', x); }

  console.log('Infrastructure sociale, formation, distribution');
  const fid = uuid();
  const school = op('field_record.create', { id: fid, idempotency_key: 'school-' + run + 'aaaa', kind: 'social_infrastructure', title: 'École de Hiré', latitude: 6.1889859, longitude: -5.2903245, data: { type: 'Ecole', classes: 6, inscrits: 210 } });
  const r2 = await batch(coach.t, [school]);
  check('infrastructure enregistrée', ['accepted', 'processed', 'applied'].includes(r2.body.results?.[0]?.status), r2.body);
  const training = op('field_record.create', { id: uuid(), idempotency_key: 'train-' + run + 'bbbb', kind: 'training', title: 'Agriculture régénératrice', data: { theme: 'Agriculture régénératrice', participants: [{ producer_id: pid, role: 'principal', score: 80 }] } });
  const dist = op('field_record.create', { id: uuid(), idempotency_key: 'dist-' + run + 'cccc', kind: 'distribution', title: 'Engrais', data: { category: 'Intrants et Outils', group: 'Engrais', article: 'NPK', quantity: 2, producer_id: pid } });
  const r3 = await batch(coach.t, [training, dist]);
  check('formation et distribution enregistrées', r3.body.results?.every((x) => ['accepted', 'processed', 'applied'].includes(x.status)), r3.body);
  const list = await call('GET', '/field-records?kind=training', { ...J(A, coach.t) });
  check('liste des formations', list.status === 200 && list.body.length === 1 && list.body[0].data.participants[0].score === 80, list.body);
  check('type inconnu refusé', (await call('GET', '/field-records?kind=zzz', { ...J(A, coach.t) })).status === 400);
  { const x = (await batch(coach.t, [op('field_record.create', { id: uuid(), idempotency_key: 'bad-' + run + 'dddd', kind: 'autre', title: 'x', data: {} })])).body.results?.[0]; check('type de dossier invalide refusé', !!x && !['accepted', 'processed', 'applied'].includes(x.status), x); }
  check('lecteur ne consulte pas les dossiers de terrain', (await call('GET', '/field-records', { ...J(A, lect.t) })).status === 403);
  check("l'autre coopérative ne voit rien", ((await call('GET', '/field-records', { ...J(B) })).body ?? []).length === 0);

  console.log('Catalogue des articles');
  check('coach ne gère pas le catalogue', (await call('POST', '/distribution-articles', { ...J(A, coach.t), body: { category: 'Intrants et Outils', group_name: 'Engrais', name: 'NPK' } })).status === 403);
  const art = await call('POST', '/distribution-articles', { ...J(A), body: { category: 'Intrants et Outils', group_name: 'Engrais', name: 'NPK 0-23-19', unit: 'sac' } });
  check("l'administrateur ajoute un article", art.status === 201, art.body);
  const arts = await call('GET', '/distribution-articles?category=Intrants%20et%20Outils&group=Engrais', { ...J(A, coach.t) });
  check('le coach voit les articles du groupe', arts.body.length === 1 && arts.body[0].name === 'NPK 0-23-19', arts.body);
  check('le coach ne retire pas un article', (await call('POST', `/distribution-articles/${art.body.id}/retirer`, { ...J(A, coach.t) })).status === 403);
  check("l'administrateur retire l'article", (await call('POST', `/distribution-articles/${art.body.id}/retirer`, { ...J(A) })).status === 201);
  check('article retiré absent du catalogue', (await call('GET', '/distribution-articles?category=Intrants%20et%20Outils&group=Engrais', { ...J(A, coach.t) })).body.length === 0);
  check("identifiant d'article inconnu : 404", (await call('POST', '/distribution-articles/00000000-0000-0000-0000-000000000000/retirer', { ...J(A) })).status === 404);
  const lst = await call('GET', '/field-records', { ...J(A) });
  check("la liste indique l'auteur", lst.body.length > 0 && lst.body.every((r) => 'created_by_name' in r), lst.body[0]);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})();
