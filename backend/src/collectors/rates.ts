import { PoolClient } from 'pg';

export interface DelegateRates { t: string; r: string; rtype: string }

/**
 * Transport et retenue au kilo à appliquer à un règlement : tarif de la filière du produit, sinon tarif général du délégué,
 * sinon tarif par défaut de la coopérative (champ par champ : un tarif de filière peut ne fixer que le transport).
 */
export async function delegateRates(c: PoolClient, collectorId: string, productId: string | null): Promise<DelegateRates> {
  const r = (await c.query(
    `SELECT coalesce(fr.transport_per_kg, k.transport_per_kg, (SELECT convoy_transport_unit FROM org_settings), 0) AS t,
            coalesce(fr.retention_per_kg, k.retention_per_kg, (SELECT convoy_retention_per_kg FROM org_settings), 0) AS r,
            coalesce(k.retention_type, 'mise_en_compte') AS rtype
       FROM collectors k
       LEFT JOIN collector_rates fr ON fr.collector_id = k.id AND fr.value_chain_id = (SELECT value_chain_id FROM products WHERE id = $2)
      WHERE k.id = $1`, [collectorId, productId])).rows[0];
  return r ?? { t: '0', r: '0', rtype: 'mise_en_compte' };
}
