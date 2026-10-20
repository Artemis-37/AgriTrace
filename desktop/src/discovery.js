// Découverte automatique du serveur de la coopérative sur le réseau local : l'utilisateur n'a jamais à saisir d'adresse.
// Principe : le serveur répond sur /v1/mode ; on sonde les adresses du ou des sous-réseaux du poste (port du serveur) et on ne
// retient que les serveurs AgriTrace. L'adresse trouvée est mémorisée ; si elle change (DHCP), le poste la retrouve seul.
const os = require('os');

function localSubnets() {
  const out = [];
  for (const i of Object.values(os.networkInterfaces()).flat()) {
    if (i && i.family === 'IPv4' && !i.internal) out.push({ ip: i.address, base: i.address.split('.').slice(0, 3).join('.') });
  }
  return out;
}

async function probe(origin, timeoutMs) {
  try {
    const r = await fetch(`${origin}/v1/mode`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return r.ok && j.mode ? { origin, mode: j.mode, version: j.version } : null;
  } catch { return null; }
}

/** Candidats : dernière adresse connue, ce poste lui-même, puis tout le sous-réseau. Renvoie les serveurs AgriTrace trouvés. */
async function discover({ port = 3000, known, timeoutMs = 700, extraHosts = [], subnets = localSubnets() } = {}) {
  if (known) { const k = await probe(known, 1500); if (k) return [k]; }
  const hosts = new Set();
  for (const h of extraHosts) hosts.add(`http://${h}:${port}`);
  for (const s of subnets) for (let n = 1; n < 255; n++) hosts.add(`http://${s.base}.${n}:${port}`);
  const list = [...hosts], found = [];
  let next = 0;
  await Promise.all(Array.from({ length: 64 }, async () => {
    while (next < list.length) { const r = await probe(list[next++], timeoutMs); if (r) found.push(r); }
  }));
  return found;
}

// ---- Balise UDP (comme CentriGest) : le serveur répond « qui est là ? » sur le port 8099 ; le client diffuse et écoute. ----
const dgram = require('dgram');
const BEACON_PORT = 8099, ASK = 'AGRITRACE?';

/** Côté serveur : répond aux demandes des postes clients avec son port. Renvoie une fonction d'arrêt. */
function startBeacon({ port = 3000, name = 'Serveur', beaconPort = BEACON_PORT } = {}) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    if (msg.toString() !== ASK) return;
    sock.send(Buffer.from(JSON.stringify({ app: 'agritrace', port, name })), rinfo.port, rinfo.address);
  });
  sock.on('error', () => { try { sock.close(); } catch { /* ignoré */ } });
  sock.bind(beaconPort);
  return () => { try { sock.close(); } catch { /* ignoré */ } };
}

/** Côté client : diffuse la demande et collecte les réponses pendant `waitMs`. */
function findByBeacon({ beaconPort = BEACON_PORT, waitMs = 1500, targets = ['255.255.255.255'] } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => resolve([]));
    sock.on('message', (msg, rinfo) => {
      try { const j = JSON.parse(msg.toString()); if (j.app === 'agritrace') found.set(`http://${rinfo.address}:${j.port}`, { origin: `http://${rinfo.address}:${j.port}`, name: j.name }); } catch { /* autre service */ }
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* ignoré */ }
      for (const t of targets) sock.send(Buffer.from(ASK), beaconPort, t, () => undefined);
      setTimeout(async () => { try { sock.close(); } catch { /* ignoré */ } resolve([...found.values()]); }, waitMs);
    });
  });
}

/** Recherche complète : balise UDP d'abord (rapide), balayage du sous-réseau ensuite si rien n'a répondu. */
async function findServer(opts = {}) {
  const viaBeacon = await findByBeacon(opts.beacon);
  const checked = [];
  for (const b of viaBeacon) { const r = await probe(b.origin, 1500); if (r) checked.push(r); }
  if (checked.length) return checked;
  return discover(opts);
}

module.exports = { discover, probe, localSubnets, startBeacon, findByBeacon, findServer, BEACON_PORT };
