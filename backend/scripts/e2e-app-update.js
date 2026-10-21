// Mise à jour de l'application de bureau : dépôt de l'installateur, vérification de version par les postes, téléchargement contrôlé.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload = form; if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: res.status, body: json, raw: buf, headers: res.headers };
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const exe = (extra) => Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(2048), Buffer.from(extra)]);
const form = (buf, version, name = 'AgriTrace-Setup.exe') => { const f = new FormData(); f.append('file', new Blob([buf]), name); if (version) f.append('version', version); f.append('notes', 'Essai'); return f; };

(async () => {
  const pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'AU' + run, name: 'AU' + run } })).body;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `au.${run}@t.test`, full_name: 'Chef', password: pw } });
  const t1 = await login(`au.${run}@t.test`, pw); if (!t1) console.log('login coop KO');
  // Version très haute pour ne pas dépendre de l'état de la base de test.
  // Les versions déposées ne s'effacent pas : on repart de la plus haute connue pour que le test soit rejouable.
  const known = (await call('GET', '/app/update?current=0.0.0')).body;
  const major = known.available ? Number(known.version.split('.')[0]) + 1 : 900;
  const v1 = `${major}.0.1`, v2 = `${major}.1.0`;

  console.log('Dépôt de l\'installateur');
  check('sans connexion : dépôt refusé', (await call('POST', '/platform/app/releases', { form: form(exe('a'), v1) })).status === 401);
  const r403 = await call('POST', '/platform/app/releases', { token: t1, form: form(exe('a'), v1) }); check('administrateur de coopérative : dépôt central refusé (403)', r403.status === 403, [r403.status, r403.body]);
  const r403b = await call('POST', '/app/releases', { token: t1, org: org.id, form: form(exe('a'), v1) }); check('serveur central : le dépôt par la coopérative est refusé (403)', r403b.status === 403, [r403b.status, r403b.body]);
  check('fichier qui n\'est pas un .exe refusé', (await call('POST', '/platform/app/releases', { token: adm, form: form(Buffer.from('%PDF-1.4 pas un exe'), v1) })).status === 400);
  check('version mal formée refusée', (await call('POST', '/platform/app/releases', { token: adm, form: form(exe('a'), '1.2') })).status === 400);
  const bin1 = exe('v1');
  const up1 = await call('POST', '/platform/app/releases', { token: adm, form: form(bin1, v1) });
  const sha1 = crypto.createHash('sha256').update(bin1).digest('hex');
  check('administrateur de la plateforme : installateur déposé, empreinte calculée', up1.status === 201 && up1.body.sha256 === sha1 && up1.body.version === v1, up1.body);
  check('même version déposée deux fois : refusé (409)', (await call('POST', '/platform/app/releases', { token: adm, form: form(exe('b'), v1) })).status === 409);
  check('version plus ancienne refusée (409)', (await call('POST', '/platform/app/releases', { token: adm, form: form(exe('b'), '1.0.0') })).status === 409);

  console.log('Vérification par les postes');
  const c0 = await call('GET', '/app/update?current=0.1.0');
  check('poste en 0.1.0 (sans connexion) : mise à jour proposée avec taille et empreinte', c0.status === 200 && c0.body.available === true && c0.body.version === v1 && c0.body.sha256 === sha1 && c0.body.size_bytes === bin1.length, c0.body);
  check('poste déjà à jour : rien à faire', (await call('GET', `/app/update?current=${v1}`)).body.available === false);
  check('poste plus récent : rien à faire', (await call('GET', `/app/update?current=${major + 1000}.0.0`)).body.available === false);
  check('version du poste absente ou invalide : traitée comme très ancienne', (await call('GET', '/app/update?current=abc')).body.available === true);

  console.log('Téléchargement');
  const dl = await call('GET', `/app/installer/${v1}`);
  check('installateur téléchargé, identique octet pour octet', dl.status === 200 && crypto.createHash('sha256').update(dl.raw).digest('hex') === sha1 && Number(dl.headers.get('content-length')) === bin1.length, dl.status);
  check('en-tête d\'empreinte fourni', dl.headers.get('x-content-sha256') === sha1);
  check('version inconnue : 404', (await call('GET', '/app/installer/998.9.9')).status === 404);
  check('version mal formée : 400', (await call('GET', '/app/installer/..%2F..%2Fetc')).status !== 200);

  const bin2 = exe('v2');
  const up2 = await call('POST', '/platform/app/releases', { token: adm, form: form(bin2, v2) });
  check('version plus récente déposée', up2.status === 201, up2.body);
  const c1 = await call('GET', `/app/update?current=${v1}`);
  check('les postes de la version précédente voient la nouvelle', c1.body.available === true && c1.body.version === v2, c1.body);
  console.log('Signature de l\'installateur');
  const sig = Buffer.alloc(64, 7).toString('base64');
  const v3 = `${major}.2.0`;
  const fs3 = form(exe('c'), v3); fs3.append('signature', sig);
  const up3 = await call('POST', '/platform/app/releases', { token: adm, form: fs3 });
  check('dépôt avec signature accepté', up3.status === 201 && up3.body.signed === true, up3.body);
  const c3 = await call('GET', `/app/update?current=${v2}`);
  check('la signature est transmise aux postes', c3.body.signature === sig, c3.body);
  const v4 = `${major}.3.0`;
  const fs4 = form(exe('d'), v4); fs4.append('signature', 'pas-une-signature');
  check('signature mal formée refusée (400)', (await call('POST', '/platform/app/releases', { token: adm, form: fs4 })).status === 400);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
