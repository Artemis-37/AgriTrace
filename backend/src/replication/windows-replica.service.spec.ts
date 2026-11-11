import { BadRequestException, ConflictException } from '@nestjs/common';
import { WindowsReplicaService } from './windows-replica.service';

function fakeDb() {
  const calls: { sql: string; params: any[] }[] = [];
  const db: any = { tx: async (_org: string, fn: any) => fn({ query: async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rowCount: 1 }; } }) };
  return { db, calls };
}
const site = { id: 's1', organization_id: 'o1' };
const row = (n: string) => ({ sync_id: `sync-id-${n}`, updated_at: '2026-11-11T10:00:00', amount: 5 });

describe('WindowsReplicaService', () => {
  it('stocke chaque ligne dans la réplique de la coopérative et marque le site comme vu', async () => {
    const { db, calls } = fakeDb();
    const r = await new WindowsReplicaService(db).receive(site, { schema: 'win-1', tables: { loans: [row('1'), row('2')], partners: [row('3')] } });
    expect(r).toEqual({ ok: true, received: 3, applied: 3 });
    expect(calls.filter((c) => c.sql.includes('windows_replica'))).toHaveLength(3);
    expect(calls[calls.length - 1].sql).toContain('UPDATE replication_sites');
    expect(calls[0].params[0]).toBe('o1');
  });
  it('refuse un autre format, un nom de table dangereux, une ligne sans identifiant ou sans date valide', async () => {
    const svc = new WindowsReplicaService(fakeDb().db);
    await expect(svc.receive(site, { schema: 'v2', tables: {} })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.receive(site, { schema: 'win-1', tables: { 'loans; drop table users': [row('1')] } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.receive(site, { schema: 'win-1', tables: { loans: [{ updated_at: '2026-11-11T10:00:00' }] } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.receive(site, { schema: 'win-1', tables: { loans: [{ ...row('1'), updated_at: 'pas une date' }] } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.receive(site, { schema: 'win-1' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('refuse un lot de plus de 5000 lignes', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => row(String(i).padStart(5, '0')));
    await expect(new WindowsReplicaService(fakeDb().db).receive(site, { schema: 'win-1', tables: { loans: rows } })).rejects.toBeInstanceOf(BadRequestException);
  });
});
