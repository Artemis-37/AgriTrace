import { X509Certificate } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const selfsigned = require('selfsigned');

/** Certificat du serveur de la coopérative sur le réseau local : généré une fois, conservé, jamais saisi par l'utilisateur. */
export interface TlsMaterial { key: string; cert: string; fingerprint: string; notAfter: Date }

const state: { current: TlsMaterial | null } = { current: null };
export const tlsInfo = () => state.current;

/**
 * Charge le certificat du dossier `dir`, ou en crée un (auto-signé, RSA 2048, 10 ans) au premier démarrage.
 * Les postes ne vérifient pas un nom d'hôte mais l'EMPREINTE (épinglage) : l'adresse IP du serveur peut donc changer sans rien casser.
 * Un certificat qui expire dans moins de 30 jours est refait ; les postes devront alors se ré-associer (empreinte nouvelle).
 */
export function ensureCertificate(dir: string): TlsMaterial {
  fs.mkdirSync(dir, { recursive: true });
  const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  let key: string | null = null, cert: string | null = null;
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    key = fs.readFileSync(keyFile, 'utf8'); cert = fs.readFileSync(certFile, 'utf8');
    try { if (new Date(new X509Certificate(cert).validTo).getTime() - Date.now() < 30 * 86400000) { key = null; cert = null; } } catch { key = null; cert = null; }
  }
  if (!key || !cert) {
    const pems = selfsigned.generate([{ name: 'commonName', value: 'AgriTrace serveur cooperative' }], {
      keySize: 2048, days: 3650, algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
      ],
    });
    key = pems.private; cert = pems.cert;
    fs.writeFileSync(keyFile, key as string, { mode: 0o600 });
    fs.writeFileSync(certFile, cert as string);
  }
  const x = new X509Certificate(cert as string);
  const m = { key: key as string, cert: cert as string, fingerprint: x.fingerprint256.replace(/:/g, '').toLowerCase(), notAfter: new Date(x.validTo) };
  state.current = m;
  return m;
}
