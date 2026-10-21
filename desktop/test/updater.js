// Mise à jour du poste : annonce, téléchargement contrôlé (empreinte du fichier et du serveur), installateur falsifié refusé.
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { checkUpdate, downloadInstaller, installCommand, compareVersions, cleanOld } = require('../src/updater');
let ko = 0; const check = (n, c, x) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) { ko++; if (x !== undefined) console.log('   ', JSON.stringify(x)); } };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agritrace-upd-'));
const installer = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(300000)]);
const sha = crypto.createHash('sha256').update(installer).digest('hex');
let announce = { available: true, version: '0.2.0', size_bytes: installer.length, sha256: sha, notes: 'Essai' };
let body = installer, status = 200;
const handler = (q, r) => {
  if (q.url.startsWith('/v1/app/update')) { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify(announce)); }
  if (q.url.startsWith('/v1/app/installer/')) { if (status !== 200) { r.statusCode = status; return r.end(); } r.setHeader('content-length', body.length); return r.end(body); }
  r.statusCode = 404; r.end();
};
const listen = (s) => new Promise((res) => s.listen(0, '127.0.0.1', () => res(s.address().port)));

(async () => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(work, 'k.pem'), '-out', path.join(work, 'c.pem'), '-days', '2', '-subj', '/CN=t'], { stdio: 'ignore' });
  const cert = fs.readFileSync(path.join(work, 'c.pem'), 'utf8');
  const fp = new crypto.X509Certificate(cert).fingerprint256.replace(/:/g, '').toLowerCase();
  const plain = http.createServer(handler), tls = https.createServer({ key: fs.readFileSync(path.join(work, 'k.pem')), cert }, handler);
  const pp = await listen(plain), tp = await listen(tls);
  const O = `http://127.0.0.1:${pp}`, S = `https://127.0.0.1:${tp}`;

  check('comparaison de versions', compareVersions('0.2.0', '0.1.9') > 0 && compareVersions('1.0.0', '1.0.0') === 0 && compareVersions('0.9.0', '0.10.0') < 0);
  const u = await checkUpdate({ origin: O, current: '0.1.0' });
  check('version plus récente annoncée', u && u.version === '0.2.0' && u.sha256 === sha, u);
  check('déjà à jour : rien', (await checkUpdate({ origin: O, current: '0.2.0' })) === null);
  announce = { ...announce, sha256: 'zz' };
  check('annonce sans empreinte valide : ignorée', (await checkUpdate({ origin: O, current: '0.1.0' })) === null);
  announce = { available: true, version: '0.2.0', size_bytes: installer.length, sha256: sha, notes: 'Essai' };
  check('serveur injoignable : pas d\'erreur, rien à faire', (await checkUpdate({ origin: 'http://127.0.0.1:1', current: '0.1.0' })) === null);

  let seen = 0;
  const f = await downloadInstaller({ origin: O, update: u, destDir: path.join(work, 'dl'), onProgress: (n) => { seen = n; } });
  check('installateur téléchargé et vérifié (HTTP, poste serveur)', fs.existsSync(f) && fs.statSync(f).size === installer.length && seen === installer.length);
  check('aucun fichier .part laissé', !fs.readdirSync(path.join(work, 'dl')).some((n) => n.endsWith('.part')));
  const f2 = await downloadInstaller({ origin: S, pin: fp, update: u, destDir: path.join(work, 'dl2') });
  check('installateur téléchargé en HTTPS avec empreinte épinglée (poste client)', fs.existsSync(f2));
  check('serveur HTTPS d\'une autre empreinte : téléchargement refusé', await downloadInstaller({ origin: S, pin: '00'.repeat(32), update: u, destDir: path.join(work, 'dl3') }).then(() => false, () => true));
  check('… et aucun fichier n\'est resté', !fs.existsSync(path.join(work, 'dl3')) || fs.readdirSync(path.join(work, 'dl3')).length === 0);

  body = Buffer.concat([installer.subarray(0, installer.length - 1), Buffer.from('X')]);
  const bad = await downloadInstaller({ origin: O, update: u, destDir: path.join(work, 'dl4') }).then(() => null, (e) => e.message);
  check('installateur falsifié (même taille, empreinte différente) : refusé et supprimé', /empreinte/.test(bad ?? '') && fs.readdirSync(path.join(work, 'dl4')).length === 0, bad);
  body = installer.subarray(0, 1000);
  check('téléchargement tronqué : refusé', await downloadInstaller({ origin: O, update: u, destDir: path.join(work, 'dl5') }).then(() => false, () => true));
  body = installer; status = 404;
  check('serveur sans cette version (404) : refusé', await downloadInstaller({ origin: O, update: u, destDir: path.join(work, 'dl6') }).then(() => false, (e) => /404/.test(e.message)));
  status = 200;

  const c = installCommand('C:\\Users\\Moi\\AppData\\Roaming\\AgriTrace\\updates\\AgriTrace-Setup-0.2.0.exe', 'C:\\Program Files\\AgriTrace\\AgriTrace.exe');
  check('commande d\'installation : silencieuse, puis réouverture', c.cmd === 'cmd.exe' && c.args[1].includes('/S') && c.args[1].includes('start /wait') && c.args[1].includes('AgriTrace.exe"'), c);
  const keep = path.join(work, 'keep'); fs.mkdirSync(keep);
  for (const v of ['0.1.5', '0.2.0']) fs.writeFileSync(path.join(keep, `AgriTrace-Setup-${v}.exe`), 'x');
  cleanOld(keep, '0.2.0');
  check('anciens installateurs supprimés', fs.readdirSync(keep).join() === 'AgriTrace-Setup-0.2.0.exe');

  plain.close(); tls.close(); fs.rmSync(work, { recursive: true, force: true });
  process.exit(ko ? 1 : 0);
})();
