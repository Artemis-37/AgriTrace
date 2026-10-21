import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

// ---------- Chiffrement des petits secrets (secret TOTP) : clé dérivée de SECRETS_KEY, à défaut de JWT_SECRET ----------
const secretKey = () => Buffer.from(hkdfSync('sha256', process.env.SECRETS_KEY || process.env.JWT_SECRET || 'dev', 'agritrace-secrets', 'v1', 32));

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}
export function decryptSecret(enc: string): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1') throw new Error('secret illisible');
  const d = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// ---------- Chiffrement des documents au repos (AES-256-GCM) : actif si DOCUMENTS_KEY (32 octets en base64) est définie ----------
// Format : "AGT1" | iv(12) | tag(16) | données. Les fichiers anciens (sans l'en-tête) restent lisibles.
const MAGIC = Buffer.from('AGT1');
function docKey(): Buffer | null {
  const k = process.env.DOCUMENTS_KEY;
  if (!k) return null;
  const b = Buffer.from(k, 'base64');
  if (b.length !== 32) throw new Error('DOCUMENTS_KEY doit contenir 32 octets encodés en base64 (openssl rand -base64 32)');
  return b;
}
export const documentsEncrypted = () => !!process.env.DOCUMENTS_KEY;
export function encryptFile(buf: Buffer): Buffer {
  const key = docKey(); if (!key) return buf;
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
export function decryptFile(buf: Buffer): Buffer {
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) return buf; // fichier ancien, non chiffré
  const key = docKey(); if (!key) throw new Error('Document chiffré : DOCUMENTS_KEY absente');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}
