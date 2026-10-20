// Application de bureau AgriTrace (Windows). Deux rôles, choisis au premier lancement :
//   - « server » : ce poste héberge le serveur de la coopérative (PostgreSQL embarqué + API + portail), accessible aux autres postes du réseau local ;
//   - « client » : ce poste affiche le portail d'un serveur déjà installé ailleurs (serveur local de la coopérative, ou serveur central).
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalServer } = require('./server-manager');

const PORT = 3000;
let cfg = null, server = null, win = null, tray = null, quitting = false;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return null; } };
const saveCfg = (c) => { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); cfg = c; };
const logFile = () => path.join(app.getPath('userData'), 'agritrace.log');
const log = (m) => { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${m}\n`); } catch { /* ignoré */ } };
const appDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'app-payload') : path.join(__dirname, '..', 'payload'));
const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function page(name) { return path.join(__dirname, name); }

function mainWindow(url) {
  if (win) { win.loadURL(url); win.show(); return; }
  win = new BrowserWindow({ width: 1366, height: 860, minWidth: 900, minHeight: 600, title: 'AgriTrace', backgroundColor: '#f4f1ea', webPreferences: { contextIsolation: true, sandbox: true, preload: page('preload.js') } });
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('did-fail-load', (_e, code, desc, failed, isMain) => {
    if (isMain && code !== -3) win.loadFile(page('error.html'), { query: { url: failed, reason: desc } });
  });
  win.on('close', (e) => {
    // Sur le poste serveur, fermer la fenêtre ne coupe pas le serveur : les autres postes en ont besoin.
    if (!quitting && cfg?.role === 'server') { e.preventDefault(); win.hide(); tray?.displayBalloon?.({ title: 'AgriTrace', content: 'Le serveur reste actif. Clic droit sur l\'icône pour quitter.' }); }
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const isServer = cfg?.role === 'server';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      ...(isServer ? [
        { label: 'Sauvegarder maintenant…', click: backupNow },
        { label: 'Adresses pour les autres postes', click: showAddresses },
        { label: 'Ouvrir le dossier des données', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Démarrer avec Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
        { type: 'separator' },
      ] : []),
      { label: 'Changer de mode (serveur / poste client)…', click: resetRole },
      { label: 'Journal technique', click: () => shell.openPath(logFile()) },
      { type: 'separator' }, { label: isServer ? 'Quitter et arrêter le serveur' : 'Quitter', role: 'quit' },
    ] },
    { label: 'Affichage', submenu: [{ role: 'reload', label: 'Actualiser' }, { role: 'togglefullscreen', label: 'Plein écran' }, { type: 'separator' }, { role: 'zoomIn', label: 'Agrandir' }, { role: 'zoomOut', label: 'Réduire' }, { role: 'resetZoom', label: 'Taille normale' }] },
    { label: 'Aide', submenu: [{ label: 'À propos', click: () => dialog.showMessageBox({ title: 'AgriTrace', message: `AgriTrace ${app.getVersion()}`, detail: isServer ? `Serveur de la coopérative.\nAdresses pour les autres postes :\n${lanAddresses().join('\n') || '(aucune carte réseau active)'}` : `Poste client relié à ${cfg?.serverUrl}` }) }] },
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
function showAddresses() {
  dialog.showMessageBox({ title: 'Adresses du serveur', message: 'Sur les autres ordinateurs du bureau, installez AgriTrace en « poste client » et saisissez l\'une de ces adresses (ou ouvrez-la dans un navigateur) :', detail: lanAddresses().join('\n') || 'Aucune carte réseau active.' });
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
  server = new LocalServer({ dataDir: path.join(app.getPath('userData'), 'server'), appDir: appDir(), port: PORT, nodeBin: process.execPath, log });
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
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')));
  tray.setToolTip('AgriTrace — serveur actif');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir AgriTrace', click: () => { win?.show(); win?.focus(); } },
    { label: 'Adresses pour les autres postes', click: showAddresses },
    { type: 'separator' }, { label: 'Quitter et arrêter le serveur', click: () => app.quit() },
  ]));
  tray.on('double-click', () => { win?.show(); win?.focus(); });
  mainWindow(server.url);
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
  if (cfg.role === 'server') await startServerRole();
  else mainWindow(cfg.serverUrl);
}

ipcMain.handle('setup:check', async (_e, url) => {
  try {
    const u = new URL(url);
    const r = await fetch(`${u.origin}/v1/mode`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return { ok: r.ok && !!j.mode, mode: j.mode, version: j.version, origin: u.origin };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('app:retry', (_e, url) => { win?.loadURL(url); });
ipcMain.handle('app:change', () => resetRole());

app.whenReady().then(main);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', async (e) => {
  if (server && server.state !== 'stopped') { e.preventDefault(); const s = server; server = null; await s.stop().catch(() => undefined); app.quit(); }
});
app.on('window-all-closed', () => { if (cfg?.role !== 'server') app.quit(); });
