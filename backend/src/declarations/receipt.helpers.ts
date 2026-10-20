import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { nextNumber, pad } from '../stock/stock.helpers';

export interface ReceiptConfig {
  mode: 'physical' | 'generated'; series: string; required: boolean; mask: string | null; prefix: string;
}

export async function receiptConfig(c: PoolClient): Promise<ReceiptConfig> {
  const r = (await c.query(
    `SELECT purchase_receipt_mode AS mode, purchase_receipt_series AS series, purchase_receipt_required AS required,
            purchase_receipt_mask AS mask, purchase_receipt_prefix AS prefix FROM org_settings`)).rows[0];
  return r ?? { mode: 'physical', series: 'A', required: true, mask: null, prefix: 'RA' };
}

/** Forme canonique : espaces superflus retirés, majuscules. La valeur saisie d'origine est conservée à part. */
export const normalizeReceipt = (raw: string) => raw.trim().replace(/\s+/g, ' ').toUpperCase();

/** Masque simple : # = chiffre, A = lettre majuscule, autre caractère = littéral. Pas d'expression régulière libre (risque de blocage). */
export function matchesMask(no: string, mask: string | null): boolean {
  if (!mask) return true;
  if (no.length !== mask.length) return false;
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i], ch = no[i];
    if (m === '#') { if (!/[0-9]/.test(ch)) return false; }
    else if (m === 'A') { if (!/[A-Z]/.test(ch)) return false; }
    else if (m !== ch) return false;
  }
  return true;
}

export interface ReceiptAssignment {
  series: string | null; no: string | null; entered: string | null; source: 'physical' | 'generated' | null; conflictWith: string | null;
}

/** Contrôle l'enregistrement de la série : une série ne mélange jamais les deux modes. */
async function ensureSeries(c: PoolClient, orgId: string, cfg: ReceiptConfig, userId: string) {
  await c.query(
    `INSERT INTO purchase_receipt_series(organization_id, series, mode, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [orgId, cfg.series, cfg.mode, userId]);
  const s = (await c.query(`SELECT mode FROM purchase_receipt_series WHERE series = $1`, [cfg.series])).rows[0];
  if (s.mode !== cfg.mode)
    throw new ConflictException(`La série « ${cfg.series} » est en mode « ${s.mode} » : une série ne mélange pas les deux modes. Choisir une autre série dans les paramètres.`);
}

/** Détermine le numéro de reçu d'une déclaration (saisi par le collecteur ou généré par le serveur). */
export async function assignReceipt(c: PoolClient, orgId: string, userId: string, raw: string | undefined, cfg: ReceiptConfig): Promise<ReceiptAssignment> {
  const none: ReceiptAssignment = { series: null, no: null, entered: null, source: null, conflictWith: null };
  await ensureSeries(c, orgId, cfg, userId);
  if (cfg.mode === 'generated') {
    if (raw !== undefined && raw !== '')
      throw new BadRequestException("Cette coopérative utilise des reçus générés par AgriTrace : le numéro est attribué par le serveur, ne pas le saisir");
    const n = await nextNumber(c, orgId, `purchase_receipt:${cfg.series}`);
    const no = `${cfg.prefix}-${new Date().getUTCFullYear()}-${pad(n, 6)}`;
    return { series: cfg.series, no, entered: null, source: 'generated', conflictWith: null };
  }
  if (raw === undefined || raw.trim() === '') {
    if (cfg.required) throw new BadRequestException("Le numéro du reçu d'achat est obligatoire");
    return none;
  }
  const no = normalizeReceipt(raw);
  if (!matchesMask(no, cfg.mask))
    throw new BadRequestException(`Format de numéro de reçu invalide : attendu « ${cfg.mask} » (# = chiffre, A = lettre)`);
  const used = await c.query(
    `SELECT id FROM purchase_declarations WHERE purchase_receipt_series = $1 AND purchase_receipt_no = $2 AND receipt_conflict_with IS NULL`, [cfg.series, no]);
  return { series: cfg.series, no, entered: raw, source: 'physical', conflictWith: used.rows[0]?.id ?? null };
}
