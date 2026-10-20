/** Transitions autorisées côté serveur (le client ne déclare jamais lui-même un état validé). */
export const MANUAL_TRANSITIONS: Record<string, string[]> = {
  draft: ['cancelled'],
  received: ['in_review', 'rejected', 'cancelled'],
  in_review: ['to_correct', 'accepted', 'rejected'],
  to_correct: ['rejected', 'cancelled'],
  accepted: ['cancelled'],
};

/** Motif obligatoire pour ces états cibles. */
export const REASON_REQUIRED = new Set(['to_correct', 'rejected', 'cancelled']);

/** États réservés au module de pesée et de réception (P3) : jamais atteignables manuellement. */
export const RECEPTION_STATES = new Set(['partially_received', 'received_confirmed']);

export function canTransition(from: string, to: string): boolean {
  return (MANUAL_TRANSITIONS[from] ?? []).includes(to);
}

/** Une déclaration peut être (re)soumise depuis le brouillon ou après demande de correction. */
export const canSubmit = (status: string) => status === 'draft' || status === 'to_correct';
