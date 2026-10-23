import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface TxInput {
  orgId: string; userId: string; accountId: string; direction: 'in' | 'out'; amount: string; reason: string;
  idempotencyKey: string; referenceType?: string; referenceId?: string;
}

/**
 * Opération financière interne (décaissement, remboursement, paiement) : même règles que POST /financial-transactions.
 * Compte verrouillé, session de caisse ouverte exigée pour une caisse, sortie de caisse limitée au solde.
 */
export async function postFinancialTx(c: PoolClient, t: TxInput) {
  const a = (await c.query(`SELECT id, owner_type, currency, status, accounting_code FROM financial_accounts WHERE id = $1 FOR UPDATE`, [t.accountId])).rows[0];
  if (!a) throw new BadRequestException('Compte financier inconnu');
  if (a.status !== 'active') throw new BadRequestException('Compte clôturé');
  let sessionId: string | null = null;
  if (a.owner_type === 'cash_register') {
    const s = await c.query(
      `SELECT s.id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE r.account_id = $1 AND s.status = 'open'`, [t.accountId]);
    if (!s.rowCount) throw new UnprocessableEntityException('Aucun caissier connecté à la caisse de ce compte');
    sessionId = s.rows[0].id;
    if (t.direction === 'out') {
      const chk = (await c.query(
        `SELECT $2::numeric <= b.balance AS ok, b.balance FROM (SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
           FROM financial_transactions WHERE account_id = $1) b`, [t.accountId, t.amount])).rows[0];
      if (!chk.ok) throw new UnprocessableEntityException(`Solde de caisse insuffisant (${chk.balance})`);
    }
  }
  const ins = await c.query(
    `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [t.orgId, t.idempotencyKey, t.accountId, sessionId, t.direction, t.amount, a.currency, t.reason, t.referenceType ?? null, t.referenceId ?? null, t.userId]);
  return { tx: ins.rows[0], account: a };
}

/** Écriture compensatoire d'une opération financière (sans session de caisse, comme POST …/reverse). */
export async function reverseFinancialTx(c: PoolClient, orgId: string, userId: string, txId: string, reason: string) {
  const t = (await c.query(`SELECT * FROM financial_transactions WHERE id = $1`, [txId])).rows[0];
  if (!t) throw new BadRequestException('Opération inconnue');
  if (t.reversal_of) throw new BadRequestException("Une écriture compensatoire ne peut pas être annulée");
  await c.query(`SELECT 1 FROM financial_accounts WHERE id = $1 FOR UPDATE`, [t.account_id]);
  return (await c.query(
    `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reversal_of, created_by)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [orgId, `reversal:${txId}`, t.account_id, t.direction === 'in' ? 'out' : 'in', t.amount, t.currency, `Annulation : ${reason}`, txId, userId])).rows[0];
}
