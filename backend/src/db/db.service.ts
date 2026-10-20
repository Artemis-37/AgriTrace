import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async query<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  /**
   * Transaction avec contexte d'organisation : les politiques RLS lisent app.current_org.
   * Toute opération métier d'une organisation passe par cette méthode.
   */
  async tx<R>(orgId: string | null, fn: (c: PoolClient) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId ?? '']);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
