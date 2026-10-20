import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { nextNumber, pad } from '../stock/stock.helpers';

export interface EntryLine { code: string; debit?: string; credit?: string; label?: string }
export interface EntryInput {
  orgId: string; userId: string; journal: string; date: string; label: string; lines: EntryLine[];
  idempotencyKey: string; referenceType?: string; referenceId?: string; reversalOf?: string;
}

/** Compte comptable (SYSCOHADA) associé à un compte financier : surcharge explicite, sinon caisse 571 / banque 521. */
export const accountingCodeOf = (a: { owner_type: string; accounting_code?: string | null }) =>
  a.accounting_code ?? (a.owner_type === 'cash_register' ? '571' : '521');

/**
 * Écrit une écriture comptable équilibrée et non modifiable. Idempotente par clé.
 * L'équilibre est vérifié par la base (contrainte différée forcée ici) : une écriture déséquilibrée est refusée.
 */
export async function postEntry(c: PoolClient, e: EntryInput): Promise<{ id: string; number: string; replay: boolean }> {
  const prev = await c.query(`SELECT id, number FROM accounting_entries WHERE idempotency_key = $1`, [e.idempotencyKey]);
  if (prev.rowCount) return { id: prev.rows[0].id, number: prev.rows[0].number, replay: true };

  await c.query('SELECT accounting_seed($1::uuid)', [e.orgId]);
  const j = await c.query(`SELECT id FROM journals WHERE code = $1`, [e.journal]);
  if (!j.rowCount) throw new BadRequestException(`Journal inconnu : ${e.journal}`);
  const codes = [...new Set(e.lines.map((l) => l.code))];
  const accs = await c.query(`SELECT id, code, is_active FROM accounting_accounts WHERE code = ANY($1::text[])`, [codes]);
  const byCode = new Map<string, any>(accs.rows.map((r: any) => [r.code, r]));
  for (const code of codes) {
    const a = byCode.get(code);
    if (!a) throw new BadRequestException(`Compte comptable inconnu : ${code}`);
    if (!a.is_active) throw new BadRequestException(`Compte comptable désactivé : ${code}`);
  }
  const year = Number(e.date.slice(0, 4));
  const n = await nextNumber(c, e.orgId, `entry:${year}`);
  const number = `EC-${year}-${pad(n)}`;
  const ent = await c.query(
    `INSERT INTO accounting_entries(organization_id, journal_id, number, entry_date, label, reference_type, reference_id, idempotency_key, reversal_of, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [e.orgId, j.rows[0].id, number, e.date, e.label, e.referenceType ?? null, e.referenceId ?? null, e.idempotencyKey, e.reversalOf ?? null, e.userId]);
  let i = 1;
  for (const l of e.lines) {
    await c.query(
      `INSERT INTO accounting_lines(organization_id, entry_id, line_no, account_id, debit, credit, label) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.orgId, ent.rows[0].id, i++, byCode.get(l.code).id, l.debit ?? '0', l.credit ?? '0', l.label ?? null]);
  }
  await c.query('SET CONSTRAINTS accounting_balance IMMEDIATE'); // vérifie l'équilibre maintenant
  await c.query('SET CONSTRAINTS accounting_balance DEFERRED');
  return { id: ent.rows[0].id, number, replay: false };
}

/** Écriture inverse (débit ↔ crédit) d'une écriture existante : seule voie de correction. */
export async function reverseEntry(c: PoolClient, orgId: string, userId: string, entryId: string, label: string, date: string) {
  const o = await c.query(
    `SELECT e.id, j.code AS journal, e.reference_type, e.reference_id FROM accounting_entries e JOIN journals j ON j.id = e.journal_id WHERE e.id = $1`, [entryId]);
  if (!o.rowCount) throw new BadRequestException('Écriture inconnue');
  const lines = await c.query(
    `SELECT a.code, l.debit, l.credit, l.label FROM accounting_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`, [entryId]);
  try {
    return await postEntry(c, {
      orgId, userId, journal: o.rows[0].journal, date, label,
      lines: lines.rows.map((l: any) => ({ code: l.code, debit: l.credit, credit: l.debit, label: l.label })),
      idempotencyKey: `reversal-entry:${entryId}`, referenceType: o.rows[0].reference_type, referenceId: o.rows[0].reference_id, reversalOf: entryId,
    });
  } catch (err: any) {
    if (err.code === '23505') throw new ConflictException('Cette écriture a déjà été annulée');
    throw err;
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
