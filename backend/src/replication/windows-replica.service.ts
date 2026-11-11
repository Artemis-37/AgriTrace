import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_ROWS = 5000;

/** Reçoit les lots d'un serveur local Windows (format « win-1 ») et garde la version la plus récente de chaque ligne. */
@Injectable()
export class WindowsReplicaService {
  constructor(private readonly db: DbService) {}

  async receive(site: { id: string; organization_id: string }, body: any) {
    if (body?.schema !== 'win-1') throw new ConflictException('Format de données non pris en charge (attendu : win-1)');
    const tables = body.tables;
    if (!tables || typeof tables !== 'object') throw new BadRequestException('Lot vide ou illisible');
    const items: { tbl: string; sync_id: string; updated_at: string; row: any }[] = [];
    for (const [tbl, rows] of Object.entries<any>(tables)) {
      if (!IDENT_RE.test(tbl) || !Array.isArray(rows)) throw new BadRequestException(`Table invalide : ${tbl}`);
      for (const r of rows) {
        if (!r || typeof r.sync_id !== 'string' || r.sync_id.length < 8 || r.sync_id.length > 64) throw new BadRequestException(`Ligne sans identifiant dans ${tbl}`);
        const at = new Date(r.updated_at);
        if (Number.isNaN(at.getTime())) throw new BadRequestException(`Date invalide dans ${tbl}`);
        // Le serveur local envoie des heures locales sans fuseau : on les lit telles quelles (UTC) pour comparer deux versions d'une même ligne.
        items.push({ tbl, sync_id: r.sync_id, updated_at: String(r.updated_at), row: r });
      }
    }
    if (items.length > MAX_ROWS) throw new BadRequestException(`Lot trop gros (${MAX_ROWS} lignes au plus)`);
    let applied = 0;
    await this.db.tx(site.organization_id, async (c) => {
      for (const it of items) {
        const res = await c.query(
          `INSERT INTO windows_replica (organization_id, tbl, sync_id, row, updated_at, site_id)
           VALUES ($1,$2,$3,$4::jsonb,($5::timestamp AT TIME ZONE 'UTC'),$6)
           ON CONFLICT (organization_id, tbl, sync_id) DO UPDATE
             SET row = EXCLUDED.row, updated_at = EXCLUDED.updated_at, site_id = EXCLUDED.site_id, received_at = now()
             WHERE windows_replica.updated_at < EXCLUDED.updated_at`,
          [site.organization_id, it.tbl, it.sync_id, JSON.stringify(it.row), it.updated_at, site.id]);
        applied += res.rowCount ?? 0;
      }
      await c.query(`UPDATE replication_sites SET last_push_at = now(), last_error = NULL, rows_received = rows_received + $2 WHERE id = $1`, [site.id, applied]);
    });
    return { ok: true, received: items.length, applied };
  }
}
