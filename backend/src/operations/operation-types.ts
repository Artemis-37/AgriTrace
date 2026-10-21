import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { reverseEntry, today } from '../accounting/accounting.helpers';
import { reverseFinancialTx } from '../finance/finance.helpers';
import { addLotEvent, addMovement } from '../stock/stock.helpers';

export type OpType = 'convoy_reception' | 'convoy_settlement' | 'financial_transaction' | 'accounting_entry' | 'warehouse_movement';
export const OP_TYPES: OpType[] = ['convoy_reception', 'convoy_settlement', 'financial_transaction', 'accounting_entry', 'warehouse_movement'];

/** Ce que chaque type d'opération exige pour être imprimé (une de ces permissions) et pour être annulé (demande). */
export const OP_RULES: Record<OpType, { title: string; view: string[]; request: string }> = {
  convoy_reception: { title: 'Bon de réception de convoi', view: ['convoys:receive', 'convoys:settle'], request: 'convoys:receive' },
  convoy_settlement: { title: 'Reçu de règlement de convoi', view: ['convoys:settle'], request: 'convoys:settle' },
  financial_transaction: { title: 'Reçu de caisse', view: ['cash:operate', 'cash:read', 'finance:read'], request: 'cash:operate' },
  accounting_entry: { title: 'Pièce comptable', view: ['accounting:post', 'accounting:read'], request: 'accounting:post' },
  warehouse_movement: { title: 'Bon de mouvement de stock', view: ['stock:move', 'warehouses:read'], request: 'stock:move' },
};

export const MANUAL_MOVEMENTS = ['entry', 'exit', 'loss', 'adjustment_in', 'adjustment_out'];

/** Libellé court et indication « annulable ? » d'une opération (sert à la liste et à la demande). */
export async function describe(c: PoolClient, type: OpType, id: string): Promise<{ label: string; at: string; by: string | null; cancellable: boolean; why?: string } | null> {
  if (type === 'convoy_reception' || type === 'convoy_settlement') {
    const r = (await c.query(`SELECT r.*, v.convoy_no FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id WHERE r.id = $1`, [id])).rows[0];
    if (!r) return null;
    if (type === 'convoy_reception') {
      const ok = r.status !== 'settled';
      return { label: `Réception du convoi ${r.convoy_no} · ${r.total_kg} kg`, at: r.received_at, by: r.received_by, cancellable: ok, why: ok ? undefined : 'Déjà réglé en caisse : la caisse doit demander l\'annulation du règlement' };
    }
    return r.status === 'settled'
      ? { label: `Règlement du convoi ${r.convoy_no} · ${r.amount}`, at: r.settled_at, by: r.settled_by, cancellable: true }
      : null;
  }
  if (type === 'financial_transaction') {
    const t = (await c.query(`SELECT t.*, EXISTS(SELECT 1 FROM financial_transactions x WHERE x.reversal_of = t.id) AS reversed FROM financial_transactions t WHERE t.id = $1`, [id])).rows[0];
    if (!t) return null;
    const why = t.reversal_of ? "C'est déjà une écriture d'annulation" : t.reversed ? 'Déjà annulée' : t.reference_type === 'convoy_reception' ? "Liée à un règlement de convoi : demandez l'annulation du règlement" : undefined;
    return { label: `${t.direction === 'in' ? 'Entrée' : 'Sortie'} ${t.amount} ${t.currency} · ${t.reason}`, at: t.created_at, by: t.created_by, cancellable: !why, why };
  }
  if (type === 'accounting_entry') {
    const e = (await c.query(`SELECT e.*, EXISTS(SELECT 1 FROM accounting_entries x WHERE x.reversal_of = e.id) AS reversed FROM accounting_entries e WHERE e.id = $1`, [id])).rows[0];
    if (!e) return null;
    const why = e.reversal_of ? "C'est déjà une écriture d'annulation" : e.reversed ? 'Déjà annulée' : e.reference_type && e.reference_type !== 'manual' ? "Écriture générée par un document : annulez le document d'origine" : undefined;
    return { label: `Écriture ${e.number} · ${e.label}`, at: e.created_at, by: e.created_by, cancellable: !why, why };
  }
  const m = (await c.query(`SELECT m.*, EXISTS(SELECT 1 FROM warehouse_movements x WHERE x.source_type = 'movement_reversal' AND x.source_id = m.id) AS reversed FROM warehouse_movements m WHERE m.id = $1`, [id])).rows[0];
  if (!m) return null;
  const why = m.reversed ? 'Déjà annulé' : m.source_type === 'movement_reversal' ? "C'est déjà un mouvement d'annulation" : !MANUAL_MOVEMENTS.includes(m.movement_type) || m.source_type ? "Mouvement lié à un autre document (réception, transfert, division…) : annulez le document d'origine" : undefined;
  return { label: `${m.reference} · ${m.direction === 'in' ? 'entrée' : 'sortie'} ${m.quantity_kg} kg`, at: m.created_at, by: m.created_by, cancellable: !why, why };
}

/** Exécute l'annulation approuvée, dans la transaction de l'approbation. Retourne un résumé et l'instantané des données retirées. */
export async function applyCancellation(c: PoolClient, orgId: string, approverId: string, type: OpType, id: string, reason: string): Promise<{ summary: string; snapshot?: any }> {
  const d = await describe(c, type, id);
  if (!d) throw new BadRequestException('Opération introuvable');
  if (!d.cancellable) throw new ConflictException(d.why ?? 'Cette opération ne peut plus être annulée');
  const why = `${reason}`;

  if (type === 'financial_transaction') {
    try { const r = await reverseFinancialTx(c, orgId, approverId, id, why); return { summary: `Écriture compensatoire ${r.id}` }; }
    catch (e: any) { if (e.code === '23505') throw new ConflictException('Cette opération a déjà été compensée'); throw e; }
  }
  if (type === 'accounting_entry') {
    const r = await reverseEntry(c, orgId, approverId, id, `Annulation : ${why}`, today());
    return { summary: `Écriture d'annulation ${r.number}` };
  }
  if (type === 'warehouse_movement') {
    const m = (await c.query(`SELECT * FROM warehouse_movements WHERE id = $1`, [id])).rows[0];
    const back = await addMovement(c, {
      orgId, userId: approverId, warehouseId: m.warehouse_id, lotId: m.lot_id, type: m.direction === 'in' ? 'adjustment_out' : 'adjustment_in',
      direction: m.direction === 'in' ? 'out' : 'in', quantityKg: m.quantity_kg, idempotencyKey: `movement-reversal:${id}`,
      reason: `Annulation de ${m.reference} : ${why}`, sourceType: 'movement_reversal', sourceId: id,
    });
    await addLotEvent(c, orgId, approverId, m.lot_id, 'movement_cancelled', m.quantity_kg, { type: 'warehouse_movement', id }, { reversal: back.reference, original: m.reference });
    return { summary: `Mouvement d'annulation ${back.reference}` };
  }
  const r = (await c.query(`SELECT * FROM convoy_receptions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  const v = (await c.query(`SELECT * FROM convoys WHERE id = $1 FOR UPDATE`, [r.convoy_id])).rows[0];
  if (type === 'convoy_reception') {
    await c.query(`DELETE FROM convoy_receptions WHERE id = $1`, [id]);
    await c.query(`UPDATE convoys SET status = 'in_transit' WHERE id = $1`, [v.id]);
    await c.query(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE entity_type = 'convoy' AND entity_id = $1 AND kind IN ('convoy_received','convoy_variance')`, [v.id]);
    return { summary: `Réception supprimée ; le convoi ${v.convoy_no} est de nouveau en transit`, snapshot: r };
  }
  // convoy_settlement : le compte du collecteur ne doit pas avoir déjà été débité de ce montant.
  const bal = (await c.query(`SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS b FROM financial_transactions WHERE account_id = (SELECT account_id FROM financial_transactions WHERE id = $1)`, [r.tx_id])).rows[0].b;
  if (Number(bal) < Number(r.amount)) throw new ConflictException(`Le compte du collecteur a déjà été débité (solde ${bal}, règlement ${r.amount}) : annulation impossible tant que ce paiement n'est pas régularisé`);
  await reverseFinancialTx(c, orgId, approverId, r.tx_id, why);
  const entries = (await c.query(
    `SELECT e.id FROM accounting_entries e WHERE e.reference_type = 'convoy_reception' AND e.reference_id = $1 AND e.reversal_of IS NULL
        AND NOT EXISTS (SELECT 1 FROM accounting_entries x WHERE x.reversal_of = e.id)`, [id])).rows;
  for (const e of entries) await reverseEntry(c, orgId, approverId, e.id, `Annulation : ${why}`, today());
  await c.query(
    `UPDATE convoy_receptions SET status = 'pending_cashier', unit_price = NULL, amount = NULL, tx_id = NULL, settled_by = NULL, settled_at = NULL,
            gross_amount = NULL, transport_unit = NULL, transport_total = NULL, retention_per_kg = NULL, retention_amount = NULL,
            advance_netted = 0, netting_entry_number = NULL, settle_attempts = settle_attempts + 1 WHERE id = $1`, [id]);
  await c.query(`UPDATE convoys SET status = 'received' WHERE id = $1`, [v.id]);
  return { summary: `Règlement annulé (${entries.length} écriture(s) comptable(s) inversée(s)) ; la réception revient dans la file de la caisse`, snapshot: { amount: r.amount, tx_id: r.tx_id, advance_netted: r.advance_netted } };
}
