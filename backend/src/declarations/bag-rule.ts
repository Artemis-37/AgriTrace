/** Règle de fonctionnement : un sac pèse entre 50 et 75 kg (même règle sur Windows et sur le mobile). */
export const MIN_KG_PER_BAG = 50;
export const MAX_KG_PER_BAG = 75;

/** Message d'erreur si le poids total et le nombre de sacs ne concordent pas ; null sinon. Ne contrôle que les pesées en kg. */
export function bagWeightError(quantity: string | number, unit: string, bags: number | null | undefined): string | null {
  if (String(unit).toLowerCase() !== 'kg' || !bags || bags <= 0) return null;
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return null;
  const lo = bags * MIN_KG_PER_BAG, hi = bags * MAX_KG_PER_BAG;
  if (q >= lo && q <= hi) return null;
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return `${bags} sac(s) pour ${n(q)} kg font ${n(q / bags)} kg par sac. Un sac pèse entre ${MIN_KG_PER_BAG} et ${MAX_KG_PER_BAG} kg : `
    + `le poids total doit être compris entre ${lo} et ${hi} kg. Vérifiez le poids et le nombre de sacs.`;
}

/** États où l'achat peut encore être corrigé : avant validation et avant toute réception au magasin. */
export const CORRECTABLE_STATES = new Set(['draft', 'received', 'in_review', 'to_correct']);
