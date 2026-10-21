// Poste client réel (Electron sous écran virtuel) face à un vrai serveur local : le poste travaille serveur éteint, redémarre serveur éteint,
// puis envoie son travail au retour du serveur. Pilotage de la fenêtre par le protocole de débogage Chromium.
//   xvfb-run -a node test/client-electron.js <racine du dépôt>      (ne pas lancer en root : PostgreSQL le refuse)
const { LocalServer } = require('../src/server-manager');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..'));
const pw = (() => { for (const p of [path.join(repo, 'web', 'node_modules', 'playwright-core'), '/opt/npm-tools/node_modules/playwright-core']) { try { return require(p); } catch { /* suivant */ } } throw new Error('playwright-core introuvable'); })();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agr-client-'));
const app = path.join(work, 'app'); fs.mkdirSync(app);
fs.symlinkSync(path.join(repo, 'backend'), path.join(app, 'backend'), 'dir');
fs.symlinkSync(path.join(repo, 'web', 'dist'), path.join(app, 'web'), 'dir');
const port = Number(process.env.TEST_PORT ?? 3160), pgPort = Number(process.env.TEST_PG_PORT ?? 54360), cdp = Number(process.env.TEST_CDP ?? 9333);
const PW = 'MotDePasseSolide2026!';
let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (r) => r.json().catch(() => ({}));
let srv, electron, browser;
const logs = [];

async function api(method, p, { token, org, body } = {}) {
  const h = {}; if (token) h.authorization = 'Bearer ' + token; if (org) h['x-organization-id'] = org; if (body) h['content-type'] = 'application/json';
  const r = await fetch(srv.url + '/v1' + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await J(r) };
}
function launch(userData) {
  electron = spawn(path.join(repo, 'desktop', 'node_modules', '.bin', 'electron'), ['--no-sandbox', `--user-data-dir=${userData}`, `--remote-debugging-port=${cdp}`, path.join(repo, 'desktop')], {
    env: { ...process.env, AGRITRACE_PAYLOAD: app }, stdio: ['ignore', 'pipe', 'pipe'] });
  electron.stderr.on('data', (d) => logs.push(String(d).trim()));
}
async function attach() {
  for (let i = 0; i < 60; i++) {
    try {
      browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
      for (let j = 0; j < 40; j++) { const pg = browser.contexts().flatMap((c) => c.pages()).find((x) => x.url().startsWith('agritrace://')); if (pg) return pg; await sleep(500); }
    } catch { /* pas encore prêt */ }
    await sleep(500);
  }
  throw new Error('fenêtre du poste introuvable');
}
async function quitElectron() {
  try { await browser?.close(); } catch { /* ignoré */ }
  electron.kill(); await sleep(1500);
}

(async () => {
  srv = new LocalServer({ dataDir: path.join(work, 'data'), appDir: app, port, pgPort, log: (m) => logs.push(m), tls: true });   // comme en production : HTTPS auto-signé sur le réseau local
  await srv.start();
  const b = await api('POST', '/bootstrap/local', { body: { admin_name: 'Directrice Test', admin_email: 'dir@socahi.test', admin_password: PW, organization_code: 'SOCAHI', organization_name: 'SOCAHI Test' } });
  check('serveur local prêt', b.status === 201, b.body);
  const orgId = b.body.organization_id;
  const adm = (await api('POST', '/auth/login', { body: { email: 'dir@socahi.test', password: PW } })).body.access_token;
  const role = (await api('POST', '/roles', { token: adm, org: orgId, body: { code: 'compta', name: 'Comptabilité', permissions: ['messages:use', 'sync:use'] } })).body;
  const u2 = (await api('POST', '/users', { token: adm, org: orgId, body: { email: 'compta@socahi.test', full_name: 'Aminata Comptable', password: PW, role_id: role.id } })).body;
  const t2 = (await api('POST', '/auth/login', { body: { email: 'compta@socahi.test', password: PW } })).body.access_token;
  check('deuxième utilisateur (autre poste)', !!u2.id && !!t2);

  const userData = path.join(work, 'electron-data'); fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ role: 'client', serverUrl: `https://127.0.0.1:${port}`, serverFp: srv.fingerprint, stationName: 'Bureau directrice' }));

  console.log('Poste client : ouverture et connexion (serveur allumé)');
  launch(userData);
  let page = await attach();
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  check('le portail se charge depuis l\'application (agritrace://)', page.url().startsWith('agritrace://app'));
  await page.fill('input[type=email]', 'dir@socahi.test'); await page.fill('input[type=password]', PW); await page.click('button[type=submit]');
  await page.waitForSelector('text=Bonjour', { timeout: 20000 });
  check('connexion via le serveur relayé', true);
  await page.getByRole('link', { name: /Messages/ }).first().click(); await page.waitForTimeout(1500);
  check('la messagerie liste l\'autre poste', (await page.locator('main').innerText()).includes('Aminata Comptable'));

  console.log('Le serveur s\'éteint');
  await srv.stop();
  await page.getByRole('link', { name: /Tableau de bord/ }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole('link', { name: /Messages/ }).first().click(); await page.waitForTimeout(2500);
  check('bandeau « Hors connexion »', (await page.locator('.offline-bar').innerText().catch(() => '')).includes('Hors connexion'));
  check('la messagerie reste affichée (copie du poste)', (await page.locator('main').innerText()).includes('Aminata Comptable'));
  await page.getByText('Aminata Comptable').first().click(); await page.waitForTimeout(600);
  const MSG = 'Bilan du jour prêt, envoyé sans serveur ' + Date.now();
  await page.getByLabel('Votre message').fill(MSG); await page.getByRole('button', { name: 'Envoyer' }).click(); await page.waitForTimeout(1000);
  check('message écrit serveur éteint : « en attente d\'envoi »', (await page.locator('.chat-thread').innerText()).includes("En attente d'envoi"));

  console.log('Le poste est redémarré pendant que le serveur est toujours éteint');
  await quitElectron();
  launch(userData);
  page = await attach();
  await page.waitForTimeout(4000);
  const t = await page.locator('body').innerText();
  check('le poste s\'ouvre sans serveur et reprend la session (pas de connexion demandée)', !(await page.locator('input[type=password]').count()) && t.includes('Hors connexion'), t.slice(0, 200));
  await page.getByRole('link', { name: /Messages/ }).first().click(); await page.waitForTimeout(1500);
  await page.getByText('Aminata Comptable').first().click(); await page.waitForTimeout(600);
  check('le message en attente a survécu au redémarrage', (await page.locator('.chat-thread').innerText()).includes(MSG));

  console.log('Le serveur revient');
  await srv.start();
  for (let i = 0; i < 40; i++) { await sleep(1000); if (!(await page.locator('.offline-bar').count())) break; }
  check('envoi automatique : bandeau disparu', !(await page.locator('.offline-bar').count()));
  const thread = await api('GET', `/messages?with=${(await api('GET', '/messages/contacts', { token: adm, org: orgId })).body.contacts[0].id}`, { token: adm, org: orgId });
  check('le message est au serveur, une seule fois', thread.body.filter((m) => m.body === MSG).length === 1, thread.body);
  const direct = await api('GET', `/messages/contacts`, { token: t2, org: orgId });
  const fromDir = direct.body.contacts.find((c) => c.full_name === 'Directrice Test');
  check('l\'autre poste voit le message non lu de la directrice', fromDir?.unread === 1, direct.body);
  const dthread = await api('GET', `/messages?with=${fromDir.id}`, { token: t2, org: orgId });
  check('contenu lisible par son destinataire', dthread.body.some((m) => m.body === MSG), dthread.body);

  console.log('Empreinte mémorisée différente (serveur imposteur) : la connexion est refusée');
  await quitElectron();
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ role: 'client', serverUrl: `https://127.0.0.1:${port}`, serverFp: '00'.repeat(32), stationName: 'Bureau directrice' }));
  launch(userData);
  page = await attach();
  await page.waitForTimeout(5000);
  const seen = await page.evaluate(async () => { try { const r = await fetch('/v1/mode'); return { status: r.status, offline: r.headers.get('x-agritrace-offline') }; } catch (e) { return { error: String(e) }; } });
  check('avec une mauvaise empreinte, le serveur n\'est pas joint (503 hors connexion)', seen.status === 503 && seen.offline === '1', seen);

  await quitElectron();
  await srv.stop();
  console.log(`\n${ok} vérifications réussies, ${ko} échec(s)`);
  if (ko) console.log(logs.slice(-20).join('\n'));
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(ko ? 1 : 0);
})().catch(async (e) => { console.error('ÉCHEC', e.stack || e.message); console.error(logs.slice(-20).join('\n')); try { electron?.kill(); await srv?.stop(); } catch {} process.exit(1); });
