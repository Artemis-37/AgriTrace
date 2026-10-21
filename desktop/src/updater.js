// Mise à jour de l'application de bureau depuis le serveur de la coopérative (réseau local, aucun Internet).
// L'administrateur dépose l'installateur sur le serveur ; chaque poste le voit, le télécharge, vérifie son empreinte SHA-256
// (celle enregistrée à l'envoi) puis l'installe. Aucune dépendance à Electron : le même code est testé sous Node.
const fs = require('fs');
const path = require('path');
const { getJson, download } = require('./secure-fetch');

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const compareVersions = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** Demande au serveur s'il existe une version plus récente. Renvoie l'annonce, ou null si à jour / serveur injoignable. */
async function checkUpdate({ origin, pin = null, current }) {
  try {
    const r = await getJson(origin, `/v1/app/update?current=${encodeURIComponent(current)}`, { timeoutMs: 8000, pin });
    const j = r.json;
    if (r.status !== 200 || !j.available || !VERSION.test(j.version) || compareVersions(j.version, current) <= 0) return null;
    if (!/^[0-9a-f]{64}$/.test(j.sha256 ?? '')) return null;
    return { version: j.version, size: j.size_bytes, sha256: j.sha256, notes: j.notes ?? null };
  } catch { return null; }
}

/** Télécharge l'installateur annoncé et vérifie taille + empreinte. Un fichier qui ne correspond pas est supprimé, jamais lancé. */
async function downloadInstaller({ origin, pin = null, update, destDir, onProgress }) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `AgriTrace-Setup-${update.version}.exe`);
  const r = await download(origin, `/v1/app/installer/${update.version}`, dest, { pin, timeoutMs: 60000, onProgress });
  if (r.sha256 !== update.sha256 || (update.size && r.size !== update.size)) {
    fs.rmSync(dest, { force: true });
    throw new Error("L'installateur téléchargé ne correspond pas à l'empreinte annoncée : installation annulée");
  }
  return dest;
}

/**
 * Commande Windows : on attend quelques secondes que l'application se ferme (fichiers libérés), on lance l'installateur en mode
 * silencieux (une demande d'autorisation Windows peut apparaître), puis on rouvre l'application.
 */
function installCommand(installer, appExe) {
  const q = (p) => `"${String(p).replace(/"/g, '')}"`;
  return { cmd: 'cmd.exe', args: ['/c', `ping -n 11 127.0.0.1 >nul & start /wait "" ${q(installer)} /S /VERYSILENT /SUPPRESSMSGBOXES /NORESTART & start "" ${q(appExe)}`] };
}

/** Anciennes versions téléchargées : on garde seulement la plus récente. */
function cleanOld(destDir, keepVersion) {
  try { for (const f of fs.readdirSync(destDir)) if (!f.includes(`-${keepVersion}.`)) fs.rmSync(path.join(destDir, f), { force: true }); } catch { /* ignoré */ }
}

module.exports = { checkUpdate, downloadInstaller, installCommand, compareVersions, cleanOld };
