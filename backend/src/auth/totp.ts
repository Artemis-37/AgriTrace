import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// TOTP (RFC 6238) : HMAC-SHA1, 6 chiffres, pas de 30 s — compatible avec les applications d'authentification usuelles.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function newTotpSecret(): string {
  const b = randomBytes(20); let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function decodeBase32(s: string): Buffer {
  let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const i = ALPHA.indexOf(ch); if (i < 0) throw new Error('base32'); bits += i.toString(2).padStart(5, '0'); }
  const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);
export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', decodeBase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
/** Retourne le pas validé (±1 pas de tolérance d'horloge) ou null. `lastStep` interdit de rejouer un code déjà utilisé. */
export function verifyTotp(secret: string, code: string, lastStep?: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = stepAt(now);
  for (const s of [cur, cur - 1, cur + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    const a = Buffer.from(totpCode(secret, s)), b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return s;
  }
  return null;
}
export const otpauthUri = (secret: string, email: string) =>
  `otpauth://totp/AgriTrace:${encodeURIComponent(email)}?secret=${secret}&issuer=AgriTrace&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
