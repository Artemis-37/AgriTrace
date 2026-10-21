// Test du HTTPS à certificat auto-signé épinglé : découverte, empreinte mémorisée, serveur imposteur refusé, balise UDP.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { probe, probeHost, discover, startBeacon, findByBeacon } = require('../src/discovery');
const { electronFingerprintToHex, securityCode } = require('../src/secure-fetch');
let ko = 0; const check = (n, c, x) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) { ko++; if (x !== undefined) console.log('   ', JSON.stringify(x)); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agritrace-tls-'));
const mkCert = (name) => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, name + '.key'), '-out', path.join(dir, name + '.crt'), '-days', '2', '-subj', '/CN=AgriTrace test'], { stdio: 'ignore' });
  const cert = fs.readFileSync(path.join(dir, name + '.crt'), 'utf8');
  return { key: fs.readFileSync(path.join(dir, name + '.key'), 'utf8'), cert, fp: new crypto.X509Certificate(cert).fingerprint256.replace(/:/g, '').toLowerCase() };
};
const serve = (c, host, port = 0) => new Promise((res) => {
  const s = https.createServer({ key: c.key, cert: c.cert }, (q, r) => { r.setHeader('content-type', 'application/json'); r.end(q.url === '/v1/mode' ? '{"mode":"local","version":"1"}' : '{}'); });
  s.listen(port, host, () => res(s));
});

(async () => {
  const good = mkCert('good'), fake = mkCert('fake');
  const a = await serve(good, '127.0.0.7');
  const port = a.address().port;
  const origin = `https://127.0.0.7:${port}`;

  const first = await probe(origin, 3000);
  check('première rencontre : le serveur est trouvé et son empreinte relevée', first && first.tls === true && first.fp === good.fp, first);
  check('empreinte mémorisée correcte : accepté', !!(await probe(origin, 3000, good.fp)));
  check('empreinte mémorisée différente : refusé', (await probe(origin, 3000, fake.fp)) === null);
  const any = await probeHost('127.0.0.7', port, 3000);
  check('adresse sans protocole : HTTPS reconnu', any && any.origin === origin && any.fp === good.fp, any);
  check('serveur imposteur (autre certificat, même adresse) refusé quand une empreinte est mémorisée', (await probeHost('127.0.0.7', port, 3000, fake.fp)) === null);

  const found = await discover({ port, subnets: [{ base: '127.0.0' }], timeoutMs: 800 });
  check('balayage du réseau : serveur HTTPS trouvé avec son empreinte', found.some((f) => f.origin === origin && f.fp === good.fp), found);
  const pinned = await discover({ port, known: origin, pin: good.fp, subnets: [{ base: '10.255.255' }] });
  check('adresse connue + empreinte : reconnexion directe', pinned.length === 1 && pinned[0].fp === good.fp);

  const stop = startBeacon({ port, name: 'Bureau', beaconPort: 48098, tls: true });
  await new Promise((r) => setTimeout(r, 200));
  const udp = await findByBeacon({ beaconPort: 48098, waitMs: 800, targets: ['127.0.0.1'] });
  check('balise UDP : annonce HTTPS', udp.length === 1 && udp[0].origin === `https://127.0.0.1:${port}`, udp);
  stop();

  const b64 = Buffer.from(good.fp, 'hex').toString('base64');
  check('empreinte Electron (sha256/BASE64) convertie en hexadécimal', electronFingerprintToHex('sha256/' + b64) === good.fp);
  check('code de sécurité lisible (4 groupes de 4)', /^([0-9A-F]{4}-){3}[0-9A-F]{4}$/.test(securityCode(good.fp)), securityCode(good.fp));

  a.close(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(ko ? 1 : 0);
})();
