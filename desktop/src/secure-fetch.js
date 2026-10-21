// Appel JSON vers un serveur AgriTrace, en HTTP ou en HTTPS avec certificat auto-signé.
// Le certificat n'est pas validé par une autorité mais ÉPINGLÉ : on compare son empreinte SHA-256 à celle mémorisée à la première
// association (ou, à la toute première rencontre, on la retient). Le nom d'hôte n'est pas vérifié : l'adresse du serveur peut changer.
const http = require('http');
const https = require('https');

const norm = (f) => String(f || '').replace(/[^0-9a-f]/gi, '').toLowerCase();

/** `pin` : empreinte attendue (hex). Renvoie { status, json, fp } ; rejette si le serveur ne répond pas ou si l'empreinte diffère. */
function getJson(origin, pathname, { timeoutMs = 1500, pin = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(origin);
    const secure = u.protocol === 'https:';
    let fp = null;
    const req = (secure ? https : http).request({
      host: u.hostname, port: u.port || (secure ? 443 : 80), path: pathname, method: 'GET', timeout: timeoutMs, agent: false,   // connexion neuve à chaque sonde : la poignée de main (et l'empreinte) a toujours lieu
      ...(secure && { rejectUnauthorized: false }),
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(new Error('réponse trop grande')); });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body), fp }); } catch (e) { reject(e); } });
    });
    if (secure) req.on('socket', (sock) => {
      // Avec un certificat auto-signé, Node ne vérifie rien : l'empreinte est relevée et comparée dès la poignée de main, avant tout envoi.
      const check = () => {
        fp = norm(sock.getPeerCertificate().fingerprint256);
        if (pin && fp !== norm(pin)) req.destroy(new Error('Empreinte du serveur différente de celle mémorisée'));
      };
      sock.once('secureConnect', check);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Télécharge `pathname` dans `destFile` (écriture dans un fichier .part puis renommage). Renvoie { size, sha256 } et rejette si
 * l'empreinte du certificat (HTTPS) ne correspond pas à `pin`, si le serveur répond autre chose que 200 ou si la connexion s'interrompt.
 */
function download(origin, pathname, destFile, { pin = null, timeoutMs = 30000, onProgress } = {}) {
  const fs = require('fs');
  const crypto = require('crypto');
  return new Promise((resolve, reject) => {
    const u = new URL(origin);
    const secure = u.protocol === 'https:';
    const part = destFile + '.part';
    const fail = (e) => { try { fs.rmSync(part, { force: true }); } catch { /* ignoré */ } reject(e); };
    const req = (secure ? https : http).request({
      host: u.hostname, port: u.port || (secure ? 443 : 80), path: pathname, method: 'GET', timeout: timeoutMs, agent: false,
      ...(secure && { rejectUnauthorized: false }),
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return fail(new Error(`Le serveur a répondu ${res.statusCode}`)); }
      const total = Number(res.headers['content-length'] ?? 0);
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let size = 0;
      res.on('data', (d) => { size += d.length; hash.update(d); onProgress?.(size, total); });
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('Téléchargement interrompu')));
      res.pipe(out);
      out.on('error', fail);
      out.on('finish', () => {
        if (total && size !== total) return fail(new Error('Téléchargement incomplet'));
        try { fs.renameSync(part, destFile); } catch (e) { return fail(e); }
        resolve({ size, sha256: hash.digest('hex') });
      });
    });
    if (secure) req.on('socket', (sock) => sock.once('secureConnect', () => {
      const fp = norm(sock.getPeerCertificate().fingerprint256);
      if (pin && fp !== norm(pin)) req.destroy(new Error('Empreinte du serveur différente de celle mémorisée'));
    }));
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', fail);
    req.end();
  });
}

/** Convertit l'empreinte d'Electron (« sha256/BASE64 ») en hexadécimal comparable. */
function electronFingerprintToHex(f) {
  const m = /^sha256\/(.+)$/.exec(String(f || ''));
  return m ? Buffer.from(m[1], 'base64').toString('hex') : norm(f);
}

/** Code de sécurité lisible (8 premiers octets de l'empreinte) à comparer entre le serveur et un poste : « 1A2B-3C4D-5E6F-7081 ». */
function securityCode(fp) {
  return (norm(fp).slice(0, 16).toUpperCase().match(/.{4}/g) || []).join('-');
}

module.exports = { getJson, download, norm, electronFingerprintToHex, securityCode };
