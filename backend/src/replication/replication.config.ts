import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Mode d'exécution : « local » (serveur de coopérative, autonome) ou « central » (consolide les coopératives). Par défaut : central. */
export type Mode = 'central' | 'local';
export const mode = (): Mode => (process.env.AGRITRACE_MODE === 'local' ? 'local' : 'central');
export const isLocal = () => mode() === 'local';
export const isCentral = () => mode() === 'central';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const PAIRING_PREFIX = 'AGT1-';
export interface Pairing { u: string; s: string; t: string; o: string; c: string; n: string }
export const encodePairing = (p: Pairing) => PAIRING_PREFIX + Buffer.from(JSON.stringify(p)).toString('base64url');
export function decodePairing(code: string): Pairing {
  const raw = code.trim();
  if (!raw.startsWith(PAIRING_PREFIX)) throw new Error('Code de jumelage invalide');
  try {
    const p = JSON.parse(Buffer.from(raw.slice(PAIRING_PREFIX.length), 'base64url').toString('utf8'));
    if (!p.u || !p.s || !p.t || !p.o || !p.c || !p.n) throw new Error();
    return p;
  } catch {
    throw new Error('Code de jumelage illisible');
  }
}
