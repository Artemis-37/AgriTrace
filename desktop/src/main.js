// Application de bureau AgriTrace (Windows). Deux rôles, choisis au premier lancement :
//   - « server » : ce poste héberge le serveur de la coopérative (PostgreSQL embarqué + API + portail), accessible aux autres postes du réseau local ;
//   - « client » : ce poste affiche le portail d'un serveur déjà installé ailleurs (serveur local de la coopérative, ou serveur central).
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeImage, protocol, net, session } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalServer } = require('./server-manager');
const { discover, findServer, startBeacon, probe, probeHost } = require('./discovery');
const { electronFingerprintToHex, securityCode } = require('./secure-fetch');
const { checkUpdate, downloadInstaller, installCommand, cleanOld } = require('./updater');
const { spawn } = require('child_process');

const PORT = 3000;
let stopBeacon = null, cfg = null, server = null, win = null, tray = null, quitting = false;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return null; } };
const saveCfg = (c) => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); cfg = c; };
const logFile = () => path.join(app.getPath('userData'), 'agritrace.log');
const log = (m) => { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${m}\n`); } catch { /* ignoré */ } };
const appDir = () => process.env.AGRITRACE_PAYLOAD || (app.isPackaged ? path.join(process.resourcesPath, 'app-payload') : path.join(__dirname, '..', 'payload'));

// Le poste client charge le portail depuis l'application elle-même (agritrace://app) : il s'ouvre même si le serveur est éteint.
// Les appels /v1/* sont relayés vers le serveur ; s'il ne répond pas, le portail reçoit un 503 marqué et passe en mode hors connexion.
protocol.registerSchemesAsPrivileged([{ scheme: 'agritrace', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
function registerClientProtocol() {
  protocol.handle('agritrace', async (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/v1/') || u.pathname === '/v1') {
      const headers = new Headers(req.headers); headers.delete('host'); headers.delete('origin');
      const canRetryBody = ['GET', 'HEAD'].includes(req.method);
      const body = canRetryBody ? undefined : await req.arrayBuffer();
      const send = () => net.fetch(cfg.serverUrl + u.pathname + u.search, { method: req.method, headers, body, signal: AbortSignal.timeout(25000) });
      try {
        return await send();
      } catch {
        // Le serveur a peut-être changé d'adresse (box/DHCP) : on le cherche seul, sans rien demander à l'utilisateur ; la requête suivante utilisera la nouvelle adresse.
        void refindServer().catch(() => undefined);   // en arrière-plan : la réponse « hors connexion » n'attend jamais la recherche
        return new Response(JSON.stringify({ message: 'Serveur injoignable', offline: true }), { status: 503, headers: { 'content-type': 'application/json', 'x-agritrace-offline': '1' } });
      }
    }
    const root = path.join(appDir(), 'web');
    let file = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    const r = await net.fetch(pathToFileURL(file).toString());
    return new Response(r.body, { status: r.status, headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' } });
  });
}

// Serveur de coopérative en HTTPS (certificat auto-signé) : on ne valide pas une autorité mais l'EMPREINTE mémorisée à l'association.
// Aucun autre certificat invalide n'est accepté, et un serveur à l'empreinte différente est refusé (cfg.serverFp).
function installCertificatePinning() {
  session.defaultSession.setCertificateVerifyProc((req, callback) => {
    try {
      if (cfg?.serverFp && cfg.serverUrl) {
        const host = new URL(cfg.serverUrl).hostname;
        if (req.hostname === host && electronFingerprintToHex(req.certificate.fingerprint) === cfg.serverFp) return callback(0);
      }
    } catch { /* on retombe sur la vérification normale */ }
    callback(-3);   // décision de Chromium : un certificat auto-signé non épinglé est refusé
  });
}

// ---- Mise à jour de l'application : l'installateur déposé par l'administrateur sur le serveur de la coopérative ----
// Le poste le télécharge sur le réseau local, vérifie son empreinte SHA-256, puis l'installe et se rouvre. Windows uniquement.
let updating = false;
const declinedUpdates = new Set();
function updateSource() {
  if (cfg?.role === 'client') return cfg.serverUrl ? { origin: cfg.serverUrl, pin: cfg.serverFp ?? null } : null;
  return server ? { origin: server.url, pin: null } : null;
}
async function checkForUpdate(manual = false) {
  if (updating) return;
  if (process.platform !== 'win32' && !process.env.AGRITRACE_UPDATE_TEST) { if (manual) dialog.showMessageBox({ message: 'Les mises à jour automatiques concernent la version Windows.' }); return; }
  const src = updateSource();
  if (!src) return;
  const u = await checkUpdate({ ...src, current: app.getVersion() });
  if (!u) { if (manual) dialog.showMessageBox({ message: 'AgriTrace est à jour.', detail: `Version ${app.getVersion()}` }); return; }
  if (!manual && declinedUpdates.has(u.version)) return;
  const isServer = cfg?.role === 'server' || cfg?.role === 'single';
  const mo = Math.max(1, Math.round((u.size || 0) / 1048576));
  const r = await dialog.showMessageBox({
    type: 'question', buttons: ['Installer maintenant', 'Plus tard'], defaultId: 0, cancelId: 1, message: `Une nouvelle version d'AgriTrace est disponible (${u.version})`,
    detail: `${u.notes ? u.notes + '\n\n' : ''}Téléchargement : environ ${mo} Mo, depuis le serveur de la coopérative. L'application va se fermer puis se rouvrir. Windows peut demander l'autorisation d'installer.` +
      (cfg?.role === 'server' ? '\n\nCe poste est le serveur : pendant la mise à jour, les autres postes passent en mode hors connexion puis envoient leur travail au retour du serveur.' : ''),
  });
  if (r.response !== 0) { declinedUpdates.add(u.version); return; }
  updating = true;
  try {
    const dir = path.join(app.getPath('userData'), 'updates');
    const file = await downloadInstaller({ ...src, update: u, destDir: dir, onProgress: (n, t) => win?.setProgressBar(t ? n / t : 2) });
    win?.setProgressBar(-1);
    cleanOld(dir, u.version);
    log(`mise à jour vers ${u.version} : installateur vérifié, lancement`);
    const { cmd, args } = installCommand(file, process.execPath);
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    quitting = true; void isServer;
    app.quit();
  } catch (e) {
    updating = false; win?.setProgressBar(-1);
    log('mise à jour impossible : ' + e.message);
    dialog.showErrorBox('Mise à jour impossible', e.message);
  }
}
function scheduleUpdateChecks() {
  setTimeout(() => void checkForUpdate().catch((e) => log('vérification de mise à jour : ' + e.message)), 30000);
  setInterval(() => void checkForUpdate().catch(() => undefined), 6 * 3600 * 1000);
}

// Retrouve le serveur sur le réseau local et met à jour l'adresse mémorisée. Au plus une recherche à la fois, et une toutes les 20 s.
let finding = null, lastFind = 0;
async function refindServer() {
  if (finding) return finding;
  if (Date.now() - lastFind < 20000) return false;
  lastFind = Date.now();
  finding = (async () => {
    const found = await findServer({ port: PORT, known: cfg?.serverUrl, pin: cfg?.serverFp ?? null });
    // Poste déjà associé à un serveur en HTTPS : seul le serveur à la même empreinte est accepté (jamais un autre, même sur le même réseau).
    const ok = found.filter((f) => !cfg?.serverFp || f.fp === cfg.serverFp);
    const best = ok.find((f) => f.mode === 'local') ?? ok[0];
    if (!best) { if (found.length) log('un serveur répond mais son empreinte diffère de celle mémorisée : refusé'); return false; }
    // Premier passage d'un serveur qui passe en HTTPS : on retient son empreinte (association automatique).
    if (best.origin !== cfg.serverUrl || (best.fp && best.fp !== cfg.serverFp)) { log(`serveur retrouvé (${best.origin})`); saveCfg({ ...cfg, serverUrl: best.origin, ...(best.fp && { serverFp: best.fp }) }); }
    return true;
  })().finally(() => { finding = null; });
  return finding;
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function page(name) { return path.join(__dirname, name); }

function mainWindow(url) {
  if (win) { win.loadURL(url); win.show(); return; }
  session.defaultSession.setPermissionRequestHandler((_w, _perm, cb) => cb(false)); // caméra, micro, position, notifications… : jamais accordés à la page
  win = new BrowserWindow({ width: 1366, height: 860, minWidth: 900, minHeight: 600, icon: path.join(__dirname, '..', 'build', 'icon.png'), title: cfg?.stationName ? `AgriTrace — ${cfg.stationName}` : 'AgriTrace', backgroundColor: '#efebe1', webPreferences: { contextIsolation: true, sandbox: true, preload: page('preload.js') } });
  win.loadURL(url);
  // Liens externes : seulement http(s) ouverts dans le navigateur du système (jamais file:, smb:, ms-… qui lanceraient autre chose).
  win.webContents.setWindowOpenHandler(({ url: u }) => { try { if (/^https?:$/.test(new URL(u).protocol)) shell.openExternal(u); } catch { /* adresse invalide : ignorée */ } return { action: 'deny' }; });
  // La fenêtre ne peut pas être détournée vers un autre site : toute navigation hors du serveur de la coopérative / de l'application est bloquée.
  win.webContents.on('will-navigate', (e, u) => { try { const t = new URL(u), a = new URL(url); if (t.origin !== a.origin) { e.preventDefault(); if (/^https?:$/.test(t.protocol)) shell.openExternal(u); } } catch { e.preventDefault(); } });
  win.webContents.on('did-fail-load', (_e, code, desc, failed, isMain) => {
    if (isMain && code !== -3) win.loadFile(page('error.html'), { query: { url: failed, reason: desc } });
  });
  let signedOut = false, signingOut = false;
  win.on('close', (e) => {
    // Avant de fermer, l'interface se déconnecte (ferme la caisse de la caissière) ; au plus 2,5 s d'attente.
    if (!signedOut && win.webContents && !win.webContents.isDestroyed()) {
      e.preventDefault();
      if (signingOut) return;
      signingOut = true;
      const go = () => { ipcMain.removeListener('app:signed-out', go); clearTimeout(t); signingOut = false; if (!win || win.isDestroyed()) return; signedOut = true; try { win.close(); } finally { signedOut = false; } };
      const t = setTimeout(go, 2500);
      ipcMain.once('app:signed-out', go);
      win.webContents.send('app:sign-out');
      return;
    }
    // Sur le poste serveur, fermer la fenêtre ne coupe pas le serveur : les autres postes en ont besoin.
    if (!quitting && (cfg?.role === 'server' || cfg?.role === 'single')) { e.preventDefault(); win.hide(); tray?.displayBalloon?.({ title: 'AgriTrace', content: 'Le serveur reste actif. Clic droit sur l\'icône pour quitter.' }); }
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const isServer = cfg?.role === 'server' || cfg?.role === 'single';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      ...(isServer ? [
        { label: 'Sauvegarder maintenant…', click: backupNow },
        { label: 'Ouvrir le dossier des données', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Démarrer avec Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
        { type: 'separator' },
      ] : []),
      { label: 'Poste et réseau…', click: showNetwork },
      { label: 'Rechercher une mise à jour…', click: () => void checkForUpdate(true) },
      { label: 'Changer de rôle (poste unique / serveur / client)…', click: resetRole },
      { label: 'Journal technique', click: () => shell.openPath(logFile()) },
      { type: 'separator' }, { label: isServer ? 'Quitter et arrêter le serveur' : 'Quitter', role: 'quit' },
    ] },
    { label: 'Affichage', submenu: [{ role: 'reload', label: 'Actualiser' }, { role: 'togglefullscreen', label: 'Plein écran' }, { type: 'separator' }, { role: 'zoomIn', label: 'Agrandir' }, { role: 'zoomOut', label: 'Réduire' }, { role: 'resetZoom', label: 'Taille normale' }] },
    { label: 'Aide', submenu: [{ label: 'À propos', click: () => dialog.showMessageBox({ title: 'AgriTrace', message: `AgriTrace ${app.getVersion()}`, detail: isServer ? `Poste « ${cfg?.stationName ?? 'serveur'} » — serveur de la coopérative.\nLes autres postes le trouvent automatiquement sur le réseau du bureau.` : `Poste « ${cfg?.stationName ?? 'client'} » relié au serveur de la coopérative (connexion automatique).\nSi le serveur est éteint, ce poste continue de fonctionner et enverra son travail au retour du serveur.` }) }] },
  ]));
}

async function backupNow() {
  const r = await dialog.showOpenDialog({ title: 'Dossier de destination de la sauvegarde (clé USB, disque externe…)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  try {
    const t = await server.backup(r.filePaths[0]);
    dialog.showMessageBox({ message: 'Sauvegarde terminée', detail: t });
  } catch (e) { dialog.showErrorBox('Sauvegarde impossible', e.message); }
}
// Équivalent de « Paramètres → Poste & réseau » : rôle de ce poste et état de la liaison, sans adresse affichée.
async function showNetwork() {
  const ROLE = { single: 'Poste unique — les données restent sur cet ordinateur, aucun autre poste ne peut s\'y connecter.', server: 'Serveur — héberge les données et accepte les postes clients du réseau du bureau.', client: 'Poste client — se connecte au serveur de la coopérative ; ne garde pas les données.' };
  let detail = '';
  if (server?.fingerprint) detail = `Connexion chiffrée (HTTPS) active. Code de sécurité de ce serveur : ${securityCode(server.fingerprint)}\nIl s'affiche aussi sur chaque poste client ; s'ils sont identiques, le poste parle bien à ce serveur.\n`;
  if (cfg?.role === 'client') {
    if (cfg.serverFp) detail += `Connexion chiffrée (HTTPS). Code de sécurité du serveur mémorisé : ${securityCode(cfg.serverFp)}\n`;
    const r = await findServer({ port: PORT, known: cfg.serverUrl, pin: cfg.serverFp ?? null }).catch(() => []);
    detail += r.length ? 'Serveur de la coopérative : trouvé et joignable.' : 'Serveur de la coopérative : introuvable pour le moment (le poste continue en mode hors connexion).';
  }
  const choice = await dialog.showMessageBox({ title: 'Poste et réseau', message: `Poste « ${cfg?.stationName ?? ''} »`, detail: `${ROLE[cfg?.role] ?? ''}\n${detail}`, buttons: cfg?.role === 'client' ? ['Fermer', 'Rechercher le serveur'] : ['Fermer'], cancelId: 0 });
  if (choice.response === 1) { lastFind = 0; const ok = await refindServer(); dialog.showMessageBox({ message: ok ? 'Serveur trouvé et connecté.' : 'Aucun serveur trouvé sur le réseau.', detail: ok ? '' : 'Vérifiez que le poste serveur est allumé avec AgriTrace ouvert, sur le même réseau.' }); if (ok) win?.reload(); }
}
async function resetRole() {
  const r = await dialog.showMessageBox({ type: 'warning', buttons: ['Annuler', 'Changer de mode'], defaultId: 0, cancelId: 0, message: 'Changer de mode ?', detail: 'Les données du serveur sur ce poste ne sont PAS supprimées. Le serveur sera arrêté et le choix initial vous sera reproposé.' });
  if (r.response !== 1) return;
  quitting = true;
  try { await server?.stop(); } catch { /* ignoré */ }
  fs.rmSync(cfgFile(), { force: true });
  app.relaunch(); app.exit(0);
}

async function startServerRole() {
  const splash = new BrowserWindow({ width: 460, height: 260, frame: false, resizable: false, alwaysOnTop: true, webPreferences: { contextIsolation: true } });
  splash.loadFile(page('splash.html'));
  const single = cfg.role === 'single';
  server = new LocalServer({ dataDir: path.join(app.getPath('userData'), 'server'), appDir: appDir(), port: PORT, nodeBin: process.execPath, log, localOnly: single, tls: !single });
  server.version = app.getVersion();
  try {
    await server.start();
  } catch (e) {
    log('démarrage impossible : ' + e.stack);
    splash.close();
    const r = dialog.showMessageBoxSync({ type: 'error', buttons: ['Quitter', 'Voir le journal'], message: 'Le serveur AgriTrace n\'a pas pu démarrer', detail: e.message });
    if (r === 1) shell.openPath(logFile());
    app.exit(1); return;
  }
  splash.close();
  if (!single) stopBeacon = startBeacon({ port: PORT, name: cfg.stationName ?? 'Serveur', tls: !!server.fingerprint });   // les postes clients trouvent ce serveur seuls
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('AgriTrace — serveur actif');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir AgriTrace', click: () => { win?.show(); win?.focus(); } },
    { type: 'separator' }, { label: 'Quitter et arrêter le serveur', click: () => app.quit() },
  ]));
  tray.on('double-click', () => { win?.show(); win?.focus(); });
  mainWindow(server.url);
  scheduleUpdateChecks();
}

async function main() {
  cfg = loadCfg();
  buildMenu();
  if (!cfg) {
    const setup = new BrowserWindow({ width: 640, height: 600, resizable: false, title: 'AgriTrace — installation', webPreferences: { contextIsolation: true, sandbox: true, preload: page('preload.js') } });
    setup.setMenuBarVisibility(false);
    setup.loadFile(page('setup.html'));
    await new Promise((resolve) => {
      ipcMain.handleOnce('setup:choose', (_e, c) => { saveCfg(c); resolve(); setImmediate(() => setup.destroy()); return true; });
      setup.on('closed', () => { if (!cfg) app.quit(); });
    });
    buildMenu();
  }
  if (cfg.role === 'server' || cfg.role === 'single') await startServerRole();
  else { installCertificatePinning(); registerClientProtocol(); mainWindow('agritrace://app/'); refindServer().catch(() => undefined); scheduleUpdateChecks(); }
}

ipcMain.handle('setup:check', async (_e, url) => {
  try {
    // Adresse saisie à la main (cas rare) : avec ou sans protocole ; HTTPS d'abord, HTTP ensuite.
    const raw = /^https?:\/\//.test(url) ? url : `//${url}`;
    const u = new URL(raw, 'http://x');
    const port = u.port || PORT;
    const r = /^https?:\/\//.test(url) ? await probe(`${u.protocol}//${u.hostname}:${port}`, 6000) : await probeHost(u.hostname, port, 6000);
    return r ? { ok: true, mode: r.mode, version: r.version, origin: r.origin, fp: r.fp } : { ok: false, error: 'Aucun serveur AgriTrace à cette adresse' };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('setup:discover', async () => {
  const found = await findServer({ port: PORT });
  const best = found.find((f) => f.mode === 'local') ?? found[0];
  return best ? { ok: true, mode: best.mode, origin: best.origin, fp: best.fp, count: found.length } : { ok: false };
});
ipcMain.handle('app:retry', async (_e, url) => { await refindServer(); win?.loadURL(url); });
ipcMain.on('app:station', (e) => { e.returnValue = cfg?.stationName ?? 'Poste'; });
ipcMain.handle('app:change', () => resetRole());

app.whenReady().then(main);
app.on('before-quit', () => { quitting = true; stopBeacon?.(); });
app.on('will-quit', async (e) => {
  if (server && server.state !== 'stopped') { e.preventDefault(); const s = server; server = null; await s.stop().catch(() => undefined); app.quit(); }
});
app.on('window-all-closed', () => { if (cfg?.role !== 'server' && cfg?.role !== 'single') app.quit(); });
