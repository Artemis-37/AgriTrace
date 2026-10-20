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

module.exports = { discover, probe, localSubnets };
