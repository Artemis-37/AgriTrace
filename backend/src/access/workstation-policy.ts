import { createHash } from 'crypto';
import { DbService } from '../db/db.service';

const cache = new Map<string, { required: boolean; at: number }>();
export const forgetPolicy = (orgId: string) => cache.delete(orgId);
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** La coopérative exige-t-elle un poste associé ? (mémorisé 5 s ; invalidé dès qu'on change la règle ou révoque un poste) */
export async function workstationsRequired(db: DbService, orgId: string): Promise<boolean> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 5000) return hit.required;
  const required = await db.tx(orgId, async (c) => !!(await c.query(`SELECT workstations_required FROM org_settings WHERE organization_id = $1`, [orgId])).rows[0]?.workstations_required);
  cache.set(orgId, { required, at: Date.now() });
  return required;
}

/** Poste associé et actif correspondant au jeton, ou null. */
export async function findWorkstation(db: DbService, orgId: string, token: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  return db.tx(orgId, async (c) => {
    const r = await c.query(`SELECT id, name, last_seen_at FROM workstations WHERE token_hash = $1 AND status = 'active'`, [hashToken(token)]);
    if (!r.rowCount) return null;
    if (!r.rows[0].last_seen_at || Date.now() - new Date(r.rows[0].last_seen_at).getTime() > 60000)
      await c.query(`UPDATE workstations SET last_seen_at = now() WHERE id = $1`, [r.rows[0].id]);
    return { id: r.rows[0].id, name: r.rows[0].name };
  });
}
