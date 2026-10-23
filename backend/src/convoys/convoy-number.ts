/** Numéro de connaissement automatique : <code CCC>-<année>-<3 lettres du délégué>-<n° d'ordre>. */

/** 3 lettres majuscules sans accent tirées du premier mot du nom ; complétées par X si le nom est trop court. */
export function collectorPrefix(fullName: string): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  const letters = first.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  return (letters + 'XXX').slice(0, 3);
}

export function formatConvoyNo(ccc: string, year: number, prefix: string, n: number): string {
  return `${ccc}-${year}-${prefix}-${n}`;
}

/** Aperçu (sans réserver) ou attribution (compteur incrémenté dans la transaction en cours) du prochain numéro. Null si la coopérative n'a pas de code CCC. */
export async function nextConvoyNo(c: any, orgId: string, collectorId: string, reserve: boolean, extra = 0): Promise<{ convoy_no: string; ccc_code: string } | null> {
  const ccc = (await c.query(`SELECT ccc_code FROM organization_profile WHERE organization_id = $1`, [orgId])).rows[0]?.ccc_code;
  if (!ccc) return null;
  const name = (await c.query(`SELECT u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [collectorId])).rows[0]?.full_name;
  const prefix = collectorPrefix(name ?? '');
  const year = new Date().getUTCFullYear();
  let n: number;
  if (reserve) {
    n = (await c.query(
      `INSERT INTO convoy_number_counters(organization_id, year, prefix, last_no) VALUES ($1,$2,$3,1)
       ON CONFLICT (organization_id, year, prefix) DO UPDATE SET last_no = convoy_number_counters.last_no + 1 RETURNING last_no`, [orgId, year, prefix])).rows[0].last_no;
  } else {
    n = ((await c.query(`SELECT last_no FROM convoy_number_counters WHERE year = $1 AND prefix = $2`, [year, prefix])).rows[0]?.last_no ?? 0) + 1 + extra;
  }
  return { convoy_no: formatConvoyNo(ccc, year, prefix, n), ccc_code: ccc };
}
