const nf = (d = 0) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const money = (v: string | number | null | undefined, cur = 'XOF') =>
  v === null || v === undefined || v === '' ? '—' : `${nf(cur === 'XOF' ? 0 : 2).format(Number(v))} ${cur === 'XOF' ? 'FCFA' : cur}`;
export const kg = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : `${nf(0).format(Number(v))} kg`);
export const ha = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : `${nf(2).format(Number(v))} ha`);
export const date = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—');
export const dateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('fr-FR') : '—');

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';
export const DECLARATION_STATUS: Record<string, [string, Tone]> = {
  draft: ['Brouillon', 'neutral'], received: ['Reçue', 'info'], in_review: ['En vérification', 'info'], to_correct: ['À corriger', 'warn'],
  accepted: ['Acceptée', 'ok'], partially_received: ['Réception partielle', 'warn'], received_confirmed: ['Réception confirmée', 'ok'],
  rejected: ['Rejetée', 'bad'], cancelled: ['Annulée', 'neutral'],
};
export const PAYMENT_STATUS: Record<string, [string, Tone]> = {
  planned: ['Prévu', 'neutral'], initiated: ['Initié', 'info'], pending: ['En attente', 'warn'], confirmed: ['Confirmé (manuel)', 'ok'],
  failed: ['Échoué', 'bad'], cancelled: ['Annulé', 'neutral'], refunded: ['Remboursé', 'neutral'],
};
export const LOAN_STATUS: Record<string, [string, Tone]> = {
  requested: ['Demandé', 'info'], in_analysis: ['En analyse', 'info'], approved: ['Approuvé', 'ok'], rejected: ['Rejeté', 'bad'],
  disbursed: ['Décaissé', 'warn'], repaid: ['Remboursé', 'ok'], cancelled: ['Annulé', 'neutral'],
};
export const LOAN_KIND: Record<string, string> = { prefinancing: 'Préfinancement', advance: 'Avance', loan: 'Prêt' };
export const PARCEL_LEVEL: Record<string, [string, Tone]> = { declared: ['Déclarée', 'neutral'], controlled: ['Contrôlée', 'info'], verified: ['Vérifiée', 'ok'] };
export const OUTCOME: Record<string, [string, Tone]> = { compliant: ['Conforme', 'ok'], to_review: ['À examiner', 'warn'], non_compliant: ['Non conforme', 'bad'] };
export const VALIDITY: Record<string, [string, Tone]> = { valid: ['Valide', 'ok'], expiring: ['Expire bientôt', 'warn'], expired: ['Expiré', 'bad'], revoked: ['Révoqué', 'neutral'] };

/** Transitions de déclaration proposées dans l'interface (le serveur reste seul juge). */
export const NEXT_DECLARATION: Record<string, [string, string][]> = {
  received: [['in_review', 'Mettre en vérification']],
  in_review: [['accepted', 'Accepter'], ['to_correct', 'Demander une correction'], ['rejected', 'Rejeter']],
};
