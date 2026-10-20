// Test de la découverte automatique : un faux serveur AgriTrace répond sur 127.0.0.7, un autre service quelconque sur 127.0.0.9.
const http = require('http');
const { discover, startBeacon, findByBeacon } = require('../src/discovery');
let ko = 0; const check = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) ko++; };
const srv = (host, handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, host, () => res(s)); });
(async () => {
  const a = await srv('127.0.0.7', (q, r) => { r.setHeader('content-type', 'application/json'); r.end(q.url === '/v1/mode' ? '{"mode":"local","version":"1"}' : '{}'); });
  const port = a.address().port;
  const other = await new Promise((res) => { const s = http.createServer((q, r) => r.end('<html>autre</html>')); s.listen(port, '127.0.0.9', () => res(s)); });
  const found = await discover({ port, subnets: [{ base: '127.0.0' }], timeoutMs: 500 });
  check('le serveur AgriTrace est trouvé sans adresse saisie', found.length === 1 && found[0].origin === `http://127.0.0.7:${port}` && found[0].mode === 'local');
  check('un autre service sur le même port est ignoré', !found.some((f) => f.origin.includes('127.0.0.9')));
  const again = await discover({ port, known: `http://127.0.0.7:${port}`, subnets: [{ base: '10.255.255' }] });
  check('adresse mémorisée : reconnexion directe', again.length === 1);
  const moved = await discover({ port, known: 'http://127.0.0.250:1', subnets: [{ base: '127.0.0' }], timeoutMs: 500 });
  check('adresse mémorisée périmée : le serveur est retrouvé seul', moved.length === 1 && moved[0].origin.includes('127.0.0.7'));
  const stop = startBeacon({ port, name: 'Bureau', beaconPort: 48099 });
  await new Promise((r) => setTimeout(r, 200));
  const viaUdp = await findByBeacon({ beaconPort: 48099, waitMs: 800, targets: ['127.0.0.1'] });
  check('balise UDP : le serveur répond à la demande « qui est là ? »', viaUdp.length === 1 && viaUdp[0].origin === `http://127.0.0.1:${port}` && viaUdp[0].name === 'Bureau', viaUdp);
  stop();
  a.close(); other.close(); process.exit(ko ? 1 : 0);
})();
