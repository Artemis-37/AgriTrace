import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';

/** Numéro de document séquentiel par organisation (reçus, mouvements, lots). */
export async function nextNumber(c: PoolClient, orgId: string, name: string): Promise<number> {
  const r = await c.query(
    `INSERT INTO document_counters(organization_id, name, last_value) VALUES ($1,$2,1)
     ON CONFLICT (organization_id, name) DO UPDATE SET last_value = document_counters.last_value + 1
     RETURNING last_value`, [orgId, name]);
  return r.rows[0].last_value;
}

export const pad = (n: number, width = 5) => String(n).padStart(width, '0');

/** Solde exact (numeric) d'un lot dans un magasin, calculé depuis les mouvements. */
export async function lotBalance(c: PoolClient, lotId: string, warehouseId: string): Promise<string> {
  const r = await c.query(
    `SELECT coalesce(sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END), 0) AS balance
       FROM warehouse_movements WHERE lot_id = $1 AND warehouse_id = $2`, [lotId, warehouseId]);
  return r.rows[0].balance;
}

export interface MovementInput {
  orgId: string; userId: string; warehouseId: string; lotId: string;
  type: string; direction: 'in' | 'out'; quantityKg: string; idempotencyKey: string;
  reason?: string; sourceType?: string; sourceId?: string;
}

/** Écrit un mouvement (immuable). Les sorties vérifient le solde sous verrou du lot. */
export async function addMovement(c: PoolClient, m: MovementInput) {
  if (m.direction === 'out') {
    await c.query(`SELECT 1 FROM lots WHERE id = $1 FOR UPDATE`, [m.lotId]);
    const ok = await c.query(
      `SELECT $3::numeric <= coalesce(sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END), 0) AS ok,
              coalesce(sum(CASE direction WHEN 'in' THEN quantity_kg ELSE -quantity_kg END), 0) AS balance
         FROM warehouse_movements WHERE lot_id = $1 AND warehouse_id = $2`, [m.lotId, m.warehouseId, m.quantityKg]);
    if (!ok.rows[0].ok)
      throw new BadRequestException(`Stock insuffisant dans ce magasin pour ce lot (disponible : ${ok.rows[0].balance} kg)`);
  }
  const n = await nextNumber(c, m.orgId, 'movement');
  const ref = `MV-${new Date().getUTCFullYear()}-${pad(n, 6)}`;
  const r = await c.query(
    `INSERT INTO warehouse_movements(organization_id, reference, idempotency_key, warehouse_id, lot_id, movement_type, direction,
                                     quantity_kg, reason, source_type, source_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [m.orgId, ref, m.idempotencyKey, m.warehouseId, m.lotId, m.type, m.direction, m.quantityKg,
     m.reason ?? null, m.sourceType ?? null, m.sourceId ?? null, m.userId]);
  return r.rows[0];
}

export async function addLotEvent(c: PoolClient, orgId: string, userId: string, lotId: string, type: string,
                                  quantityKg: string | null, ref?: { type: string; id: string }, details: object = {}) {
  await c.query(
    `INSERT INTO lot_events(organization_id, lot_id, event_type, quantity_kg, ref_type, ref_id, details, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orgId, lotId, type, quantityKg, ref?.type ?? null, ref?.id ?? null, JSON.stringify(details), userId]);
}
