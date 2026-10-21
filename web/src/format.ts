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

export const TASK_STATUS: Record<string, [string, Tone]> = {
  draft: ['Brouillon', 'neutral'], open: ['Ouverte', 'info'], in_progress: ['En cours', 'info'], pending_sync: ['En attente de synchro', 'warn'],
  submitted: ['Soumise', 'warn'], to_correct: ['À corriger', 'bad'], validated: ['Validée', 'ok'], completed: ['Terminée', 'ok'], closed: ['Clôturée', 'neutral'], cancelled: ['Annulée', 'neutral'],
};
export const PRIORITY: Record<string, [string, Tone]> = { low: ['Basse', 'neutral'], normal: ['Normale', 'info'], high: ['Haute', 'warn'], urgent: ['Urgente', 'bad'] };
export const TASK_CATEGORY: Record<string, string> = { mapping: 'Cartographie', visit: 'Visite', survey: 'Enquête', collection: 'Collecte', training: 'Formation', control: 'Contrôle', other: 'Autre' };
export const ANOMALY_KIND: Record<string, string> = {
  overlap_partial: 'Chevauchement partiel', overlap_inclusion: 'Parcelle incluse', duplicate_identical: 'Doublon identique', duplicate_near: 'Doublon proche', protected_overlap: 'Zone protégée',
};
export const ANOMALY_STATUS: Record<string, [string, Tone]> = { open: ['Ouverte', 'bad'], resolved: ['Corrigée', 'ok'], exception: ['Exception', 'warn'], dismissed: ['Écartée', 'neutral'] };
export const ORDER_STATUS: Record<string, [string, Tone]> = {
  draft: ['Brouillon', 'neutral'], confirmed: ['Confirmée', 'info'], partially_shipped: ['Part. expédiée', 'warn'], shipped: ['Expédiée', 'info'],
  delivered: ['Livrée', 'ok'], closed: ['Clôturée', 'neutral'], cancelled: ['Annulée', 'neutral'],
};
export const SHIPMENT_STATUS: Record<string, [string, Tone]> = {
  planned: ['Planifiée', 'neutral'], loaded: ['Chargée', 'info'], in_transit: ['En transit', 'warn'], delivered: ['Livrée', 'info'], validated: ['Validée', 'ok'], cancelled: ['Annulée', 'neutral'],
};
export const INVOICE_STATUS: Record<string, [string, Tone]> = { issued: ['Émise', 'info'], partially_paid: ['Part. payée', 'warn'], paid: ['Payée', 'ok'], cancelled: ['Annulée', 'neutral'] };
export const COUNT_STATUS: Record<string, [string, Tone]> = { counting: ['Comptage', 'info'], submitted: ['Soumis', 'warn'], approved: ['Approuvé', 'ok'], rejected: ['Rejeté', 'bad'], cancelled: ['Annulé', 'neutral'] };
export const PRODUCER_STATUS: Record<string, [string, Tone]> = {
  creating: ['En création', 'neutral'], active: ['Actif', 'ok'], to_verify: ['À vérifier', 'warn'], suspended: ['Suspendu', 'bad'], inactive: ['Inactif', 'neutral'],
  left: ['Sorti', 'neutral'], archived: ['Archivé', 'neutral'],
};
export const SEVERITY: Record<string, Tone> = { info: 'info', warning: 'warn', critical: 'bad' };
