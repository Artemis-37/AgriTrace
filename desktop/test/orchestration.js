// Vérifie l'orchestration du serveur local hors Electron : PostgreSQL embarqué → migrations → API + portail → premier démarrage → redémarrage.
//   node test/orchestration.js <dossier racine du dépôt>      (ne pas lancer en root : PostgreSQL le refuse)
const { LocalServer } = require('../src/server-manager');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agr-desktop-'));
// Disposition identique à l'application installée : <app>/backend (dist, migrations, scripts, node_modules) et <app>/web (build).
const app = path.join(work, 'app'); fs.mkdirSync(app);
fs.symlinkSync(path.join(repo, 'backend'), path.join(app, 'backend'), 'dir');
fs.symlinkSync(path.join(repo, 'web', 'dist'), path.join(app, 'web'), 'dir');
const data = path.join(work, 'data');
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const logs = [];
const port = Number(process.env.TEST_PORT ?? 3150), pgPort = Number(process.env.TEST_PG_PORT ?? 54350);
const J = (r) => r.json().catch(() => ({}));
const { probe } = require('../src/discovery');

(async () => {
  const srv = new LocalServer({ dataDir: data, appDir: app, port, pgPort, log: (m) => logs.push(m), tls: true });
  const t0 = Date.now();
  await srv.start();
  console.log(`Démarrage à froid : ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check('serveur démarré', srv.state === 'running');
  if (process.env.ONLY_START) { console.log('Serveur vierge laissé actif sur', srv.url); await new Promise(() => {}); }
  const mode = await J(await fetch(srv.url + '/v1/mode'));
  check('mode local, non initialisé', mode.mode === 'local' && mode.initialized === false, mode);
  console.log('HTTPS sur le réseau local (certificat auto-signé épinglé)');
  check('empreinte du certificat connue du gestionnaire', /^[0-9a-f]{64}$/.test(srv.fingerprint ?? ''), srv.fingerprint);
  check('le poste lui-même parle en HTTP sur 127.0.0.1 (port + 1)', srv.url === `http://127.0.0.1:${port + 1}`, srv.url);
  const lan = await probe(`https://127.0.0.1:${port}`, 5000);
  check('le port du réseau local répond en HTTPS avec la même empreinte', lan && lan.fp === srv.fingerprint && lan.mode === 'local', lan);
  check('empreinte attendue différente : serveur refusé', (await probe(`https://127.0.0.1:${port}`, 5000, '00'.repeat(32))) === null);
  check('HTTP en clair refusé sur le port du réseau local', (await probe(`http://127.0.0.1:${port}`, 3000)) === null);
  const crt = await fetch(srv.url + '/v1/tls/certificate');
  check('certificat public téléchargeable (sans clé privée)', crt.ok && (await crt.text()).includes('BEGIN CERTIFICATE'));
  const home = await fetch(srv.url + '/');
  check('le portail est servi par l\'API', home.ok && (await home.text()).includes('<div id="root">'));
  const deep = await fetch(srv.url + '/producteurs');
  check('adresse interne du portail → page d\'accueil', deep.ok && (await deep.text()).includes('<div id="root">'));
  const csp = (await fetch(srv.url + '/')).headers.get('content-security-policy') ?? '';
  check('pas de mise à niveau forcée vers HTTPS (réseau local en HTTP)', !csp.includes('upgrade-insecure-requests'), csp);
  check('API absente → 404 JSON, pas la page d\'accueil', (await fetch(srv.url + '/v1/inconnu')).status === 404);

  const b = await fetch(srv.url + '/v1/bootstrap/local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ admin_name: 'Admin Test', admin_email: 'admin@socahi.test', admin_password: 'MotDePasseSolide2026!', organization_code: 'SOCAHI', organization_name: 'SOCAHI' }) });
  check('premier démarrage : coopérative créée', b.status === 201, await J(b));
  const login = await J(await fetch(srv.url + '/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@socahi.test', password: 'MotDePasseSolide2026!' }) }));
  check('connexion de l\'administrateur', !!login.access_token);
  const orgs = await J(await fetch(srv.url + '/v1/organizations', { headers: { authorization: 'Bearer ' + login.access_token } }));
  check('une coopérative rattachée', Array.isArray(orgs) && orgs.length === 1 && orgs[0].code === 'SOCAHI', orgs);
  const orgId = orgs[0].id;
  const pr = await fetch(srv.url + '/v1/value-chains', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + login.access_token, 'x-organization-id': orgId }, body: JSON.stringify({ code: 'CACAO', name: 'Cacao' }) });
  check('écriture en base', pr.status === 201);
  check('secrets créés avec droits restreints', fs.existsSync(srv.secretsFile) && (process.platform === 'win32' || (fs.statSync(srv.secretsFile).mode & 0o077) === 0));

  console.log('Sauvegarde puis redémarrage');
  const bk = await srv.backup(work);
  check('sauvegarde créée (base + secrets + certificat)', fs.existsSync(path.join(bk, 'pgdata', 'PG_VERSION')) && fs.existsSync(path.join(bk, 'server.json')) && fs.existsSync(path.join(bk, 'tls', 'cert.pem')), bk);
  check('serveur relancé après sauvegarde', srv.state === 'running' && (await fetch(srv.url + '/v1/ready')).ok);
  await srv.stop();
  check('arrêt propre', srv.state === 'stopped' && !(await fetch(srv.url + '/v1/ready').then(() => true).catch(() => false)));
  const srv2 = new LocalServer({ dataDir: data, appDir: app, port, pgPort, log: (m) => logs.push(m), tls: true });
  const t1 = Date.now();
  await srv2.start();
  console.log(`Redémarrage : ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  const again = await J(await fetch(srv2.url + '/v1/mode'));
  check('après redémarrage : même certificat (les postes restent associés)', srv2.fingerprint === srv.fingerprint, [srv.fingerprint, srv2.fingerprint]);
  check('après redémarrage : toujours initialisé', again.initialized === true, again);
  const login2 = await J(await fetch(srv2.url + '/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@socahi.test', password: 'MotDePasseSolide2026!' }) }));
  const vcs = await J(await fetch(srv2.url + '/v1/value-chains', { headers: { authorization: 'Bearer ' + login2.access_token, 'x-organization-id': orgId } }));
  check('les données ont survécu', Array.isArray(vcs) && vcs.some((v) => v.code === 'CACAO'), vcs);
  if (process.env.KEEP_RUNNING) { console.log('Serveur laissé actif sur', srv2.url, '— Ctrl+C pour arrêter'); await new Promise(() => {}); }
  await srv2.stop();
  console.log(`\n${ok} vérifications réussies, ${ko} échec(s)`);
  if (ko) console.log(logs.slice(-25).join('\n'));
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('ÉCHEC', e.message); console.error(logs.slice(-30).join('\n')); process.exit(1); });
