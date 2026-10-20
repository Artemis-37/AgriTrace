// Test de bout en bout : serveur central + serveurs locaux, réplication à sens unique (local → central).
// Crée ses propres bases (OWNER_URL = propriétaire/super-utilisateur, DATABASE_URL = rôle applicatif), lance 1 central et 2 serveurs locaux.
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWNER_URL = process.env.OWNER_URL, APP_URL = process.env.DATABASE_URL;
if (!OWNER_URL || !APP_URL) { console.error('OWNER_URL et DATABASE_URL requis'); process.exit(1); }
const run = crypto.randomBytes(3).toString('hex');
const withDb = (url, name) => url.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agr-repl-'));
const pw = 'MotDePasseSolide2026!', ADMIN_PW = 'MotDePasseAdmin2026!';
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

async function call(base, method, p, { token, org, body, form, headers: h } = {}) {
  const headers = { ...(h || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(base + p, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function mkInstance(tag, mode, port) {
  const db = `agr_${tag}_${run}`;
  const admin = new Client({ connectionString: OWNER_URL }); await admin.connect();
  await admin.query(`CREATE DATABASE ${db}`); await admin.end();
  const ownerUrl = withDb(OWNER_URL, db), appUrl = withDb(APP_URL, db);
  const m = spawnSync('node', ['scripts/migrate.js'], { env: { ...process.env, DATABASE_URL: ownerUrl }, encoding: 'utf8' });
  if (m.status !== 0) throw new Error('migration : ' + m.stderr);
  const o = new Client({ connectionString: ownerUrl }); o.on('error', () => {}); await o.connect();
  await o.query(`GRANT USAGE ON SCHEMA public TO agritrace_app; GRANT ALL ON ALL TABLES IN SCHEMA public TO agritrace_app; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO agritrace_app; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO agritrace_app`);
  const docs = path.join(tmp, tag);
  const env = { ...process.env, DATABASE_URL: appUrl, JWT_SECRET: 'testsecret-testsecret-testsecret', PORT: String(port), AGRITRACE_MODE: mode, DOCUMENTS_DIR: docs, THROTTLE_LIMIT: '100000', REPLICATION_INTERVAL_MS: '0' };
  const child = spawn('node', ['dist/main'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  procs.push(child);
  const base = `http://localhost:${port}/v1`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/ready')).ok) break; } catch {} await sleep(500); }
  return { tag, db, base, owner: o, docs, log: () => log, ownerUrl };
}

(async () => {
  const C = await mkInstance('c', 'central', 3121);
  const L1 = await mkInstance('l1', 'local', 3122);
  const L2 = await mkInstance('l2', 'local', 3123);
  await new Promise((r) => { const s = spawn('node', ['scripts/create-platform-admin.js', 'admin@central.test', 'Admin'], { env: { ...process.env, DATABASE_URL: C.ownerUrl, ADMIN_PASSWORD: ADMIN_PW } }); s.on('close', r); });

  console.log('Modes');
  const mc = (await call(C.base, 'GET', '/mode')).body, ml = (await call(L1.base, 'GET', '/mode')).body;
  check('central annonce son mode', mc.mode === 'central' && /^01\d_/.test(mc.schema_version), mc);
  check('serveur local vierge : non initialisé', ml.mode === 'local' && ml.initialized === false, ml);
  check('le central refuse le bootstrap local', (await call(C.base, 'POST', '/bootstrap/local', { body: { admin_name: 'Xx', admin_email: 'x@x.test', admin_password: pw, organization_code: 'X1', organization_name: 'Xx' } })).status === 403);

  const cadm = (await call(C.base, 'POST', '/auth/login', { body: { email: 'admin@central.test', password: ADMIN_PW } })).body.access_token;
  check('connexion administrateur central', !!cadm);

  // ---------- Serveur local 1 : installé seul, puis relié au central ----------
  console.log('Local 1 : installation autonome puis jumelage tardif');
  const b1 = await call(L1.base, 'POST', '/bootstrap/local', { body: { admin_name: 'Admin Un', admin_email: `un.${run}@t.test`, admin_password: pw, organization_code: 'SOC' + run.toUpperCase(), organization_name: 'Coopérative Un' } });
  check('bootstrap autonome', b1.status === 201 && b1.body.organization_id && !b1.body.linked, b1.body);
  check('second bootstrap refusé', (await call(L1.base, 'POST', '/bootstrap/local', { body: { admin_name: 'Yy', admin_email: 'y@y.test', admin_password: pw, organization_code: 'YY', organization_name: 'Yy' } })).status === 409);
  const org1 = b1.body.organization_id;
  const t1 = (await call(L1.base, 'POST', '/auth/login', { body: { email: `un.${run}@t.test`, password: pw } })).body.access_token;
  const J1 = { token: t1, org: org1 };
  const vc = (await call(L1.base, 'POST', '/value-chains', { ...J1, body: { code: 'CACAO', name: 'Cacao' } })).body;
  const prods = [];
  for (let i = 0; i < 3; i++) prods.push((await call(L1.base, 'POST', '/producers', { ...J1, body: { last_name: 'Kone' + i, first_names: 'Awa', village: 'Hiré', value_chain_ids: [vc.id] } })).body.producer);
  check('données créées en local sans central', prods.every((p) => p?.id));
  const st0 = (await call(L1.base, 'GET', '/replication/status', J1)).body;
  check('statut local : non jumelé', st0.mode === 'local' && st0.linked === false && st0.organization.id === org1, st0);
  const pdf = Buffer.from('%PDF-1.4\n% justificatif ' + run + '\n%%EOF\n');
  const fd = new FormData(); fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'piece.pdf'); fd.append('subject_type', 'producer'); fd.append('subject_id', prods[0].id); fd.append('kind', 'identity');
  const doc = await call(L1.base, 'POST', '/documents', { ...J1, form: fd });
  check('pièce jointe locale', doc.status === 201, doc.body);
  check('changement de statut local (historique)', (await call(L1.base, 'POST', `/producers/${prods[1].id}/status`, { ...J1, body: { status: 'to_verify', reason: 'Contrôle de routine' } })).status === 201);

  console.log('Central : création du site et sécurité du jeton');
  const bad = await call(C.base, 'POST', '/replication/sites', { token: cadm, body: { organization_code: 'S1' + run.toUpperCase(), organization_name: 'Coopérative Un', organization_id: org1 } });
  check('site créé pour l\'organisation locale', bad.status === 201 && bad.body.pairing_code?.startsWith('AGT1-'), bad.body);
  const pair1 = bad.body.pairing_code;
  check('un administrateur de coopérative ne crée pas de site', (await call(C.base, 'POST', '/replication/sites', { token: t1, body: { organization_code: 'ZZ', organization_name: 'ZZ' } })).status === 401);
  const wrong = await call(L1.base, 'POST', '/replication/link', { ...J1, body: { pairing_code: 'AGT1-' + Buffer.from('{"u":"x"}').toString('base64url') } });
  check('code de jumelage illisible → 400', wrong.status === 400, wrong.body);
  const hello = await fetch(C.base + '/replication/hello', { headers: { 'x-site-token': 'n.importe' } });
  check('jeton invalide → 401', hello.status === 401);

  console.log('Local 1 : jumelage, envoi initial');
  const lk = await call(L1.base, 'POST', '/replication/link', { ...J1, body: { pairing_code: pair1 } });
  check('jumelage accepté, état mis en file', lk.status === 201 && lk.body.linked && lk.body.queued > 10, lk.body);
  const sy = await call(L1.base, 'POST', '/replication/sync-now', J1);
  check('envoi initial réussi', sy.status === 200 && !sy.body.error && sy.body.sent > 10 && sy.body.status.pending_rows === 0, sy.body);

  const TABLES = ['value_chains', 'producers', 'producer_value_chains', 'documents', 'producer_status_history', 'roles', 'role_permissions', 'user_organizations', 'audit_logs'];
  const count = async (inst, t, org) => {
    const q = t === 'role_permissions' ? `SELECT count(*)::int n FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id=$1)` : `SELECT count(*)::int n FROM ${t} WHERE organization_id=$1`;
    return (await inst.owner.query(q, [org])).rows[0].n;
  };
  const compare = async (label, a, b, org) => {
    for (const t of TABLES) {
      const x = await count(a, t, org), y = await count(b, t, org);
      check(`${label} : ${t} (${x})`, x === y && (x > 0 || label === 'local 2' || t === 'audit_logs'), { local: x, central: y });
    }
  };
  await compare('après envoi initial', L1, C, org1);
  const cp = (await C.owner.query(`SELECT id, last_name, status, version FROM producers WHERE organization_id=$1 ORDER BY last_name`, [org1])).rows;
  const lp = (await L1.owner.query(`SELECT id, last_name, status, version FROM producers WHERE organization_id=$1 ORDER BY last_name`, [org1])).rows;
  check('producteurs identiques (identifiants et statuts)', JSON.stringify(cp) === JSON.stringify(lp), { cp, lp });
  const cdoc = (await C.owner.query(`SELECT storage_key, sha256 FROM documents WHERE organization_id=$1`, [org1])).rows[0];
  const blob = cdoc && path.join(C.docs, org1, cdoc.storage_key);
  check('pièce jointe copiée sur le central, empreinte exacte', blob && fs.existsSync(blob) && crypto.createHash('sha256').update(fs.readFileSync(blob)).digest('hex') === cdoc.sha256);
  const stub = (await C.owner.query(`SELECT password_hash, is_platform_admin FROM users WHERE email=$1`, [`un.${run}@t.test`])).rows[0];
  check('compte copié sans mot de passe ni droits de plateforme', stub && stub.password_hash === '!replica' && stub.is_platform_admin === false, stub);
  check('connexion impossible au central avec ce compte', (await call(C.base, 'POST', '/auth/login', { body: { email: `un.${run}@t.test`, password: pw } })).status === 401);

  console.log('Local 1 : changements suivants (modification, nouvelle ligne, historique)');
  await call(L1.base, 'PUT', `/producers/${prods[2].id}`, { ...J1, body: { village: 'Daloa', version: 1 } });
  await call(L1.base, 'POST', '/producers', { ...J1, body: { last_name: 'Nouveau', first_names: 'Producteur', village: 'Hiré', value_chain_ids: [vc.id] } });
  await call(L1.base, 'POST', `/producers/${prods[1].id}/status`, { ...J1, body: { status: 'active', reason: 'Contrôle terminé' } });
  const pend = (await call(L1.base, 'GET', '/replication/status', J1)).body;
  check('changements en attente visibles', pend.pending_rows > 3, pend);
  const sy2 = await call(L1.base, 'POST', '/replication/sync-now', J1);
  check('envoi incrémental', sy2.status === 200 && !sy2.body.error && sy2.body.sent >= 3 && sy2.body.status.pending_rows === 0, sy2.body);
  await compare('après envoi incrémental', L1, C, org1);
  const v = (await C.owner.query(`SELECT village FROM producers WHERE id=$1`, [prods[2].id])).rows[0];
  const lv = (await L1.owner.query(`SELECT village FROM producers WHERE id=$1`, [prods[2].id])).rows[0];
  check('modification arrivée au central', v.village === lv.village, { v, lv });
  const sy3 = await call(L1.base, 'POST', '/replication/sync-now', J1);
  check('envoi sans changement : rien n\'est renvoyé', sy3.body.sent === 0 && !sy3.body.error, sy3.body);

  console.log('Idempotence et sécurité côté central');
  const p1 = JSON.parse(Buffer.from(pair1.slice(5), 'base64url').toString());
  const tok = `${p1.s}.${p1.t}`;
  const push = (body, t = tok) => call(C.base, 'POST', '/replication/push', { body, headers: { 'x-site-token': t } });
  const ver = (await call(C.base, 'GET', '/mode')).body.schema_version;
  const before = (await C.owner.query(`SELECT count(*)::int n FROM producers WHERE organization_id=$1`, [org1])).rows[0].n;
  const rp = await push({ schema_version: ver, last_txid: 1, rows: [{ txid: 1, tbl: 'producers', op: 'D', pk: { id: prods[0].id } }] });
  check('lot déjà vu ignoré', rp.status === 200 && rp.body.skipped === 1 && rp.body.applied === 0, rp.body);
  const after = (await C.owner.query(`SELECT count(*)::int n FROM producers WHERE organization_id=$1`, [org1])).rows[0].n;
  check('rien n\'a été supprimé', before === after);
  check('schéma différent → 409', (await push({ schema_version: '001_x.sql', last_txid: 9e15, rows: [] })).status === 409);
  const hi = 9e15;
  const foreign = await push({ schema_version: ver, last_txid: hi, rows: [{ txid: hi, tbl: 'producers', op: 'U', pk: { id: crypto.randomUUID() }, row: { id: crypto.randomUUID(), organization_id: crypto.randomUUID(), last_name: 'Intrus' } }] });
  check('ligne d\'une autre organisation refusée', foreign.status === 400, foreign.body);
  check('table non répliquée refusée', (await push({ schema_version: ver, last_txid: hi, rows: [{ txid: hi, tbl: 'users', op: 'U', pk: {}, row: {} }] })).status === 400);
  check('injection dans le nom de table refusée', (await push({ schema_version: ver, last_txid: hi, rows: [{ txid: hi, tbl: 'producers; drop table users', op: 'U', pk: {}, row: {} }] })).status === 400);
  const intr = (await C.owner.query(`SELECT 1 FROM producers WHERE last_name='Intrus'`)).rowCount;
  check('aucune ligne intruse', intr === 0);
  const fakeDoc = await push({ schema_version: ver, last_txid: hi, rows: [], blobs: { [crypto.randomUUID()]: 'AAAA' } });
  check('pièce sans ligne correspondante ignorée', fakeDoc.status === 200);

  console.log('Lecture seule du central pour une coopérative gérée en local');
  const roleC = (await C.owner.query(`SELECT id FROM roles WHERE organization_id=$1 AND code='coop_admin'`, [org1])).rows[0];
  check('le rôle a été répliqué', !!roleC);
  const argon2 = require('argon2');
  const hsh = await argon2.hash(pw, { type: argon2.argon2id });
  const cu = (await C.owner.query(`INSERT INTO users(email, full_name, password_hash) VALUES ($1,'Superviseur central',$2) RETURNING id`, [`sup.${run}@t.test`, hsh])).rows[0];
  await C.owner.query(`INSERT INTO user_organizations(user_id, organization_id, role_id) VALUES ($1,$2,$3)`, [cu.id, org1, roleC.id]);
  const ct = (await call(C.base, 'POST', '/auth/login', { body: { email: `sup.${run}@t.test`, password: pw } })).body.access_token;
  const rd = await call(C.base, 'GET', '/producers', { token: ct, org: org1 });
  check('le superviseur central lit les producteurs répliqués', rd.status === 200 && JSON.stringify(rd.body).includes('Kone0'), rd.status);
  const wr = await call(C.base, 'POST', '/producers', { token: ct, org: org1, body: { last_name: 'X', first_names: 'Y', village: 'Z', value_chain_ids: [vc.id] } });
  check('écriture refusée au central pour cette coopérative', wr.status === 403 && /serveur local/.test(JSON.stringify(wr.body)), wr.body);

  console.log('Panne et reprise');
  const sid = p1.s;
  check('suspension du site', (await call(C.base, 'POST', `/replication/sites/${sid}/status`, { token: cadm, body: { status: 'suspended' } })).status === 201);
  await call(L1.base, 'POST', '/producers', { ...J1, body: { last_name: 'Pendant', first_names: 'Panne', village: 'Hiré', value_chain_ids: [vc.id] } });
  const down = await call(L1.base, 'POST', '/replication/sync-now', J1);
  check('échec signalé, rien n\'est perdu', down.body.error && down.body.status.pending_rows > 0 && down.body.status.last_error, down.body);
  check('le central n\'a pas la ligne', (await C.owner.query(`SELECT 1 FROM producers WHERE last_name='Pendant'`)).rowCount === 0);
  await call(C.base, 'POST', `/replication/sites/${sid}/status`, { token: cadm, body: { status: 'active' } });
  const up = await call(L1.base, 'POST', '/replication/sync-now', J1);
  check('reprise : tout est rattrapé', !up.body.error && up.body.status.pending_rows === 0 && up.body.status.last_error === null, up.body);
  check('le central a la ligne', (await C.owner.query(`SELECT 1 FROM producers WHERE last_name='Pendant'`)).rowCount === 1);

  console.log('Local 2 : installation directement jumelée');
  const s2 = await call(C.base, 'POST', '/replication/sites', { token: cadm, body: { organization_code: 'S2' + run.toUpperCase(), organization_name: 'Coopérative Deux' } });
  check('site créé (organisation vide au central)', s2.status === 201, s2.body);
  const org2 = s2.body.organization_id;
  check('aucun rôle au central avant le jumelage', (await C.owner.query(`SELECT 1 FROM roles WHERE organization_id=$1`, [org2])).rowCount === 0);
  const badB = await call(L2.base, 'POST', '/bootstrap/local', { body: { admin_name: 'Deux', admin_email: `deux.${run}@t.test`, admin_password: pw, pairing_code: s2.body.pairing_code.slice(0, -4) + 'AAAA' } });
  check('code altéré refusé', badB.status === 400, badB.body);
  const b2 = await call(L2.base, 'POST', '/bootstrap/local', { body: { admin_name: 'Deux', admin_email: `deux.${run}@t.test`, admin_password: pw, pairing_code: s2.body.pairing_code } });
  check('bootstrap jumelé : même identifiant de coopérative', b2.status === 201 && b2.body.organization_id === org2 && b2.body.linked, b2.body);
  const t2 = (await call(L2.base, 'POST', '/auth/login', { body: { email: `deux.${run}@t.test`, password: pw } })).body.access_token;
  const J2 = { token: t2, org: org2 };
  const vc2 = (await call(L2.base, 'POST', '/value-chains', { ...J2, body: { code: 'CAFE', name: 'Café' } })).body;
  await call(L2.base, 'POST', '/producers', { ...J2, body: { last_name: 'Traore', first_names: 'Moussa', village: 'Soubré', value_chain_ids: [vc2.id] } });
  const s2s = await call(L2.base, 'POST', '/replication/sync-now', J2);
  check('envoi du local 2', !s2s.body.error && s2s.body.sent > 10, s2s.body);
  await compare('local 2', L2, C, org2);

  console.log('Consolidation');
  const cons = await call(C.base, 'GET', '/replication/consolidation', { token: cadm });
  check('deux coopératives consolidées', cons.status === 200 && cons.body.sites.length === 2, cons.body);
  const c1 = cons.body.sites?.find((s) => s.organization_id === org1);
  check('chiffres de la coopérative 1', c1 && c1.producers >= 4, c1);
  check('les producteurs ne se mélangent pas entre coopératives', (await C.owner.query(`SELECT count(*)::int n FROM producers WHERE organization_id=$1 AND last_name='Traore'`, [org1])).rows[0].n === 0);
  const sites = await call(C.base, 'GET', '/replication/sites', { token: cadm });
  check('liste des sites avec dernier envoi', sites.body.length === 2 && sites.body.every((s) => s.last_push_at && s.schema_version), sites.body);

  console.log('Dissociation');
  const ul = await call(L2.base, 'POST', '/replication/unlink', J2);
  check('dissociation', ul.status === 201 && ul.body.linked === false);
  await call(L2.base, 'POST', '/producers', { ...J2, body: { last_name: 'Local seul', first_names: 'A', village: 'B', value_chain_ids: [vc2.id] } });
  check('après dissociation rien ne se met en file', (await call(L2.base, 'GET', '/replication/status', J2)).body.pending_rows === 0);

  for (const i of [C, L1, L2]) { await i.owner.end(); }
  console.log(`\n${ok} vérifications réussies, ${ko} échec(s)`);
  if (ko) for (const i of [C, L1, L2]) console.log(`--- journal ${i.tag}\n` + i.log().split('\n').filter((l) => /error|Error/.test(l)).slice(-8).join('\n'));
  cleanup(ko ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(1); });

function cleanup(code) {
  for (const p of procs) p.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  const done = async () => {
    const admin = new Client({ connectionString: OWNER_URL }); await admin.connect();
    for (const t of ['c', 'l1', 'l2']) await admin.query(`DROP DATABASE IF EXISTS agr_${t}_${run} WITH (FORCE)`).catch(() => {});
    await admin.end(); process.exit(code);
  };
  setTimeout(() => done().catch(() => process.exit(code)), 500);
}
