import * as net from 'net';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

/**
 * Analyse antivirus optionnelle par ClamAV (démon clamd, protocole INSTREAM) : CLAMAV_HOST (+ CLAMAV_PORT, défaut 3310).
 * CLAMAV_REQUIRED=true : si l'analyseur est injoignable, le dépôt est refusé (échec fermé). Sinon l'analyse est ignorée avec un avertissement.
 */
export async function scanBuffer(buf: Buffer): Promise<void> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return;
  const required = process.env.CLAMAV_REQUIRED === 'true';
  try {
    const answer = await new Promise<string>((resolve, reject) => {
      const sock = net.connect({ host, port: Number(process.env.CLAMAV_PORT ?? 3310) });
      let out = '';
      sock.setTimeout(20_000, () => { sock.destroy(); reject(new Error('délai dépassé')); });
      sock.on('error', reject);
      sock.on('data', (d) => { out += d.toString(); });
      sock.on('close', () => resolve(out));
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 65536) {
        const part = buf.subarray(i, i + 65536); const len = Buffer.alloc(4); len.writeUInt32BE(part.length);
        sock.write(len); sock.write(part);
      }
      sock.write(Buffer.alloc(4)); // fin du flux
    });
    if (/FOUND/.test(answer)) throw new BadRequestException('Fichier refusé : contenu malveillant détecté');
    if (!/OK/.test(answer)) throw new Error(answer.trim() || 'réponse vide');
  } catch (e: any) {
    if (e instanceof BadRequestException) throw e;
    if (required) throw new ServiceUnavailableException("Analyse antivirus indisponible : dépôt refusé");
    console.warn(`[antivirus] analyse impossible (${e.message}) : fichier accepté sans analyse`);
  }
}
