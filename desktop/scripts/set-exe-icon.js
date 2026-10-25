// Applique l'icône AgriTrace à AgriTrace.exe (dossier win-unpacked) : l'explorateur, la barre des tâches et les raccourcis l'affichent.
// À lancer sous Windows après « electron-builder --dir ». Sans effet ailleurs.
const path = require('path');
const fs = require('fs');
if (process.platform !== 'win32') { console.log('set-exe-icon : ignoré (Windows uniquement)'); process.exit(0); }
const mod = require('rcedit');
const rcedit = typeof mod === 'function' ? mod : (mod.rcedit || mod.default);
const exe = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'AgriTrace.exe');
const ico = path.resolve(__dirname, '..', 'build', 'icon.ico');
if (!fs.existsSync(exe)) { console.error('Introuvable : ' + exe); process.exit(1); }
rcedit(exe, { icon: ico, 'version-string': { ProductName: 'AgriTrace', FileDescription: 'AgriTrace', CompanyName: 'AgriTrace', OriginalFilename: 'AgriTrace.exe' } })
  .then(() => console.log('Icône AgriTrace appliquée à', exe))
  .catch((e) => { console.error('Icône non appliquée :', e.message); process.exit(1); });
