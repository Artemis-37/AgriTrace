// Fonds de carte hors ligne : dépôt d'un paquet MBTiles, isolation entre coopératives, téléchargement avec reprise, retrait.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
async function call(method, path, { token, org, body, form, range } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  if (range) headers.range = range;
  let payload = form; if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: res.status, body: json, raw: buf, headers: res.headers };
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pack = (extra) => Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), crypto.randomBytes(4096), Buffer.from(extra)]);
const form = (buf, name, filename = 'hire.mbtiles') => { const f = new FormData(); f.append('file', new Blob([buf]), filename); if (name) f.append('name', name); return f; };

(async () => {
  const pw = 'MotDePasseSolide2026!';
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const mk = async (tag) => {
    const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
    await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: `${tag.toLowerCase()}.${run}@t.test`, full_name: 'Chef', password: pw } });
    return { org, token: await login(`${tag.toLowerCase()}.${run}@t.test`, pw) };
  };
  const A = await mk('FA'), B = await mk('FB');

  console.log('Dépôt');
  const bin = pack('v1');
  check('sans connexion : refusé', (await call('POST', '/map-packs', { form: form(bin, 'x') })).status === 401);
  check('fichier qui n\'est pas une base MBTiles refusé', (await call('POST', '/map-packs', { token: A.token, org: A.org.id, form: form(Buffer.from('%PDF-1.4 non'), 'x') })).status === 400);
  check('sans fichier : refusé', (await call('POST', '/map-packs', { token: A.token, org: A.org.id, form: new FormData() })).status === 400);
  const empty = await call('GET', '/map-packs/current', { token: A.token, org: A.org.id });
  check('aucun fond de carte au départ', empty.status === 200 && empty.body.available === false, empty.body);
  const up = await call('POST', '/map-packs', { token: A.token, org: A.org.id, form: form(bin, 'Hiré — imagerie 2026') });
  const sha = crypto.createHash('sha256').update(bin).digest('hex');
  check('paquet déposé, empreinte calculée', up.status === 201 && up.body.sha256 === sha && up.body.size_bytes == bin.length, up);

  console.log('Disponibilité');
  const cur = await call('GET', '/map-packs/current', { token: A.token, org: A.org.id });
  check('le téléphone voit le paquet (nom, taille, empreinte)', cur.body.available && cur.body.id === up.body.id && cur.body.sha256 === sha && cur.body.size_bytes === bin.length && cur.body.name.startsWith('Hiré'), cur.body);
  const other = await call('GET', '/map-packs/current', { token: B.token, org: B.org.id });
  check('une autre coopérative ne voit rien', other.body.available === false, other.body);
  check('une autre coopérative ne peut pas télécharger le fichier', (await call('GET', `/map-packs/${up.body.id}/file`, { token: B.token, org: B.org.id })).status === 404);
  check('une autre coopérative ne peut pas le retirer', (await call('DELETE', `/map-packs/${up.body.id}`, { token: B.token, org: B.org.id })).status === 404);
  check('sans connexion : téléchargement refusé', (await call('GET', `/map-packs/${up.body.id}/file`, { org: A.org.id })).status === 401);

  console.log('Téléchargement');
  const dl = await call('GET', `/map-packs/${up.body.id}/file`, { token: A.token, org: A.org.id });
  check('fichier identique octet pour octet', dl.status === 200 && crypto.createHash('sha256').update(dl.raw).digest('hex') === sha && dl.headers.get('accept-ranges') === 'bytes');
  const mid = 1000;
  const part = await call('GET', `/map-packs/${up.body.id}/file`, { token: A.token, org: A.org.id, range: `bytes=${mid}-` });
  check('reprise à partir d\'un octet : 206 et suite exacte', part.status === 206 && Buffer.compare(part.raw, bin.subarray(mid)) === 0 && part.headers.get('content-range') === `bytes ${mid}-${bin.length - 1}/${bin.length}`, [part.status, part.headers.get('content-range')]);
  const slice = await call('GET', `/map-packs/${up.body.id}/file`, { token: A.token, org: A.org.id, range: 'bytes=10-19' });
  check('tranche bornée', slice.status === 206 && Buffer.compare(slice.raw, bin.subarray(10, 20)) === 0);
  check('début après la fin du fichier : 416', (await call('GET', `/map-packs/${up.body.id}/file`, { token: A.token, org: A.org.id, range: `bytes=${bin.length + 5}-` })).status === 416);
  check('identifiant mal formé : 400', (await call('GET', '/map-packs/pas-un-uuid/file', { token: A.token, org: A.org.id })).status === 400);

  console.log('Remplacement et retrait');
  const bin2 = pack('v2');
  const up2 = await call('POST', '/map-packs', { token: A.token, org: A.org.id, form: form(bin2, '', 'zone-nord.mbtiles') });
  check('nom par défaut tiré du fichier', up2.status === 201 && up2.body.name === 'zone-nord', up2.body);
  check('le plus récent devient le fond de carte courant', (await call('GET', '/map-packs/current', { token: A.token, org: A.org.id })).body.id === up2.body.id);
  check('liste réservée aux administrateurs : 2 paquets', (await call('GET', '/map-packs', { token: A.token, org: A.org.id })).body.length === 2);
  check('retrait : 204', (await call('DELETE', `/map-packs/${up2.body.id}`, { token: A.token, org: A.org.id })).status === 204);
  check('après retrait, l\'ancien redevient courant', (await call('GET', '/map-packs/current', { token: A.token, org: A.org.id })).body.id === up.body.id);
  check('fichier retiré introuvable', (await call('GET', `/map-packs/${up2.body.id}/file`, { token: A.token, org: A.org.id })).status === 404);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
