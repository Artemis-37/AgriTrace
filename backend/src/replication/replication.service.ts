import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DbService } from '../db/db.service';
import { Pairing, decodePairing, isLocal, safeEqual, sha256 } from './replication.config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^[a-z][a-z0-9_]*$/;
const BATCH_ROWS = 1000;
const BATCH_BLOB_BYTES = 8 * 1024 * 1024;
const docsDir = () => process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'storage', 'documents');
const qi = (id: string) => '"' + id.replace(/"/g, '""') + '"';

export interface PushRow { txid: number; tbl: string; op: 'U' | 'D'; pk: Record<string, unknown>; row?: Record<string, any> | null }
export interface PushBody {
  schema_version: string; app_version?: string; last_txid: number;
  rows: PushRow[]; users?: { id: string; email: string; full_name: string; phone?: string | null; status: string }[];
  blobs?: Record<string, string>;
}

@Injectable()
export class ReplicationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Replication');
  private timer?: NodeJS.Timeout;
  private running = false;
  private tableCache = new Map<string, { upsert: string; del: string; serial: boolean; pk: string[]; viaRole: boolean }>();

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    const every = Number(process.env.REPLICATION_INTERVAL_MS ?? 30000);
    if (isLocal() && every > 0) {
      this.timer = setInterval(() => this.syncOnce().catch((e) => this.log.warn(e.message)), every);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async schemaVersion(): Promise<string> {
    const [r] = await this.db.query(`SELECT max(name) AS v FROM schema_migrations`);
    return r?.v ?? '';
  }

  // ======================= Côté central =======================

  /** Authentifie un serveur local d'après son jeton « idSite.secret ». */
  async authenticateSite(token: string | undefined) {
    const [id, secret] = String(token ?? '').split('.');
    if (!id || !secret || !UUID_RE.test(id)) throw new UnauthorizedException('Jeton de site invalide');
    const [site] = await this.db.query(`SELECT * FROM replication_sites WHERE id = $1`, [id]);
    if (!site || !safeEqual(site.token_hash, sha256(secret))) throw new UnauthorizedException('Jeton de site invalide');
    if (site.status !== 'active') throw new UnauthorizedException('Site suspendu par le serveur central');
    return site;
  }

  private async tableInfo(tbl: string) {
    const hit = this.tableCache.get(tbl);
    if (hit) return hit;
    if (!IDENT_RE.test(tbl)) throw new BadRequestException(`Table inconnue : ${tbl}`);
    const [reg] = await this.db.query(`SELECT org_via, pk_cols, serial_id FROM replication_tables WHERE tbl = $1`, [tbl]);
    if (!reg) throw new BadRequestException(`Table non répliquée : ${tbl}`);
    const cols = (await this.db.query<{ attname: string }>(
      `SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '' ORDER BY attnum`,
      [qi(tbl)])).map((r) => r.attname);
    const pk: string[] = reg.pk_cols;
    const insertCols = reg.serial_id ? cols.filter((c) => !pk.includes(c)) : cols;
    const list = insertCols.map(qi).join(', ');
    const sets = insertCols.filter((c) => !pk.includes(c)).map((c) => `${qi(c)} = EXCLUDED.${qi(c)}`).join(', ');
    const upsert = reg.serial_id
      ? `INSERT INTO ${qi(tbl)} (${list}) SELECT ${list} FROM jsonb_populate_record(NULL::${qi(tbl)}, $1::jsonb)`
      : `INSERT INTO ${qi(tbl)} (${list}) SELECT ${list} FROM jsonb_populate_record(NULL::${qi(tbl)}, $1::jsonb)
         ON CONFLICT (${pk.map(qi).join(', ')}) ${sets ? `DO UPDATE SET ${sets}` : 'DO NOTHING'}`;
    const del = `DELETE FROM ${qi(tbl)} t USING jsonb_populate_record(NULL::${qi(tbl)}, $1::jsonb) k WHERE ${pk.map((c) => `t.${qi(c)} = k.${qi(c)}`).join(' AND ')}`;
    const info = { upsert, del, serial: reg.serial_id as boolean, pk, viaRole: reg.org_via === 'role' };
    this.tableCache.set(tbl, info);
    return info;
  }

  /** Reçoit un lot de changements d'un serveur local. Idempotent : les transactions déjà appliquées sont ignorées. */
  async receive(site: any, body: PushBody) {
    const mine = await this.schemaVersion();
    if (body.schema_version !== mine)
      throw new ConflictException({ code: 'schema_mismatch', message: `Version de schéma différente (local ${body.schema_version}, central ${mine}) : mettez à jour le serveur en retard.`, central_schema: mine });
    if (!Array.isArray(body.rows)) throw new BadRequestException('Lot invalide');
    const org: string = site.organization_id;
    const fresh = body.rows.filter((r) => Number(r.txid) > Number(site.last_txid));
    let maxTx = Number(site.last_txid);

    // Contrôles avant toute écriture : la coopérative du site, et seulement elle.
    for (const r of fresh) {
      const info = await this.tableInfo(r.tbl);
      if (!info.viaRole && r.op === 'U' && r.row?.organization_id !== org) throw new BadRequestException(`Ligne hors de l'organisation du site (${r.tbl})`);
      if (!info.viaRole && r.op === 'D' && r.pk?.organization_id !== undefined && r.pk.organization_id !== org) throw new BadRequestException('Suppression hors de l\'organisation du site');
      if (r.op !== 'U' && r.op !== 'D') throw new BadRequestException('Opération inconnue');
    }
    // Pièces jointes : seulement celles dont l'empreinte correspond à la ligne reçue.
    const docRows = new Map<string, any>();
    for (const r of fresh) if (r.tbl === 'documents' && r.op === 'U' && r.row) docRows.set(r.row.storage_key, r.row);
    const blobs = body.blobs ?? {};
    for (const [key, b64] of Object.entries(blobs)) {
      const d = docRows.get(key);
      if (!d || !UUID_RE.test(key)) continue;
      const buf = Buffer.from(b64, 'base64');
      if (sha256Buf(buf) !== d.sha256) throw new BadRequestException(`Empreinte du fichier ${key} incorrecte`);
      await fs.mkdir(path.join(docsDir(), org), { recursive: true });
      await fs.writeFile(path.join(docsDir(), org, key), buf, { mode: 0o600 });
    }

    let applied = 0;
    await this.db.tx(org, async (c) => {
      await c.query(`SELECT set_config('session_replication_role', 'replica', true)`);
      for (const u of body.users ?? []) {
        if (!UUID_RE.test(u.id) || typeof u.email !== 'string') continue;
        const clash = await c.query(`SELECT 1 FROM users WHERE email = $1 AND id <> $2`, [u.email, u.id]);
        const email = clash.rowCount ? `u-${u.id}@replica.invalid` : u.email;
        await c.query(
          `INSERT INTO users(id, email, full_name, phone, password_hash, status) VALUES ($1,$2,$3,$4,'!replica',$5)
           ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, status = EXCLUDED.status
             WHERE users.password_hash LIKE '!%'`,
          [u.id, email, u.full_name, u.phone ?? null, u.status === 'disabled' ? 'disabled' : 'active']);
      }
      // Les rôles d'abord : les droits qui s'y rattachent sont contrôlés contre eux.
      const ordered = [...fresh.filter((r) => r.tbl === 'roles'), ...fresh.filter((r) => r.tbl !== 'roles')];
      for (const r of ordered) {
        const info = await this.tableInfo(r.tbl);
        if (info.viaRole && r.row) {
          const ok = await c.query(`SELECT 1 FROM roles WHERE id = $1 AND organization_id = $2`, [r.row.role_id, org]);
          if (!ok.rowCount) throw new BadRequestException('Rôle hors de l\'organisation du site');
        }
        if (r.op === 'U') await c.query(info.upsert, [JSON.stringify(r.row)]);
        else if (!info.serial) await c.query(info.del, [JSON.stringify(r.pk)]);
        maxTx = Math.max(maxTx, Number(r.txid));
        applied++;
      }
      await c.query(
        `UPDATE replication_sites SET last_txid = GREATEST(last_txid, $2), rows_received = rows_received + $3,
                schema_version = $4, app_version = $5, last_push_at = now(), last_error = NULL WHERE id = $1`,
        [site.id, maxTx, applied, body.schema_version, body.app_version ?? null]);
    });
    return { ok: true, last_txid: maxTx, applied, skipped: body.rows.length - fresh.length };
  }

  async recordSiteError(siteId: string, message: string) {
    await this.db.query(`UPDATE replication_sites SET last_error = $2 WHERE id = $1`, [siteId, message.slice(0, 500)]);
  }

  // ======================= Côté local =======================

  async link() {
    const [l] = await this.db.query(`SELECT * FROM replication_link`);
    return l as undefined | {
      central_url: string; site_id: string; site_token: string; organization_id: string; enabled: boolean; acked_txid: string;
      linked_at: string; last_attempt_at: string | null; last_ok_at: string | null; last_error: string | null; rows_sent: string;
    };
  }

  /** Vérifie un code de jumelage auprès du central (jeton valide, même version de schéma). */
  async hello(p: Pairing) {
    let res: Response;
    try {
      res = await fetch(`${p.u.replace(/\/+$/, '')}/v1/replication/hello`, { headers: { 'X-Site-Token': `${p.s}.${p.t}` }, signal: AbortSignal.timeout(15000) });
    } catch (e: any) {
      throw new BadRequestException(`Serveur central injoignable (${p.u}) : ${e.message}`);
    }
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(j.message ?? `Le serveur central a refusé le jumelage (${res.status})`);
    if (j.organization_id !== p.o) throw new BadRequestException('Le code de jumelage ne correspond pas à l\'organisation du central');
    const mine = await this.schemaVersion();
    if (j.schema_version !== mine) throw new BadRequestException(`Version de schéma différente (local ${mine}, central ${j.schema_version}) : mettez à jour avant de jumeler.`);
    return j;
  }

  /** Relie ce serveur local à un central et met en file l'état actuel de la coopérative. */
  async linkTo(orgId: string, pairingCode: string) {
    let p: Pairing;
    try { p = decodePairing(pairingCode); } catch (e: any) { throw new BadRequestException(e.message); }
    if (p.o !== orgId) throw new BadRequestException(`Ce code est prévu pour « ${p.n} » (${p.c}), pas pour cette coopérative.`);
    await this.hello(p);
    const queued = await this.db.tx(orgId, async (c) => {
      await c.query(`DELETE FROM sync_outbox`);
      await c.query(`DELETE FROM replication_link`);
      await c.query(
        `INSERT INTO replication_link(id, central_url, site_id, site_token, organization_id) VALUES (1,$1,$2,$3,$4)`,
        [p.u.replace(/\/+$/, ''), p.s, `${p.s}.${p.t}`, orgId]);
      const [r] = (await c.query(`SELECT replication_backfill($1) AS n`, [orgId])).rows;
      return Number(r.n);
    });
    return { linked: true, queued };
  }

  async unlink() {
    await this.db.query(`DELETE FROM replication_link`);
    await this.db.query(`DELETE FROM sync_outbox`);
  }

  async status() {
    const l = await this.link();
    const [q] = await this.db.query(`SELECT count(*)::int AS pending, min(created_at) AS oldest FROM sync_outbox`);
    return {
      mode: 'local' as const,
      linked: !!l, enabled: !!l?.enabled,
      central_url: l?.central_url ?? null,
      pending_rows: q.pending, oldest_pending_at: q.oldest,
      last_ok_at: l?.last_ok_at ?? null, last_attempt_at: l?.last_attempt_at ?? null, last_error: l?.last_error ?? null,
      rows_sent: Number(l?.rows_sent ?? 0), schema_version: await this.schemaVersion(),
    };
  }

  /** Envoie au central tout ce qui est en file. Sûr à relancer : le central ignore ce qu'il a déjà appliqué. */
  async syncOnce(): Promise<{ sent: number; batches: number; error?: string }> {
    if (this.running) return { sent: 0, batches: 0 };
    const l = await this.link();
    if (!l || !l.enabled) return { sent: 0, batches: 0 };
    this.running = true;
    let sent = 0, batches = 0;
    try {
      await this.db.query(`UPDATE replication_link SET last_attempt_at = now()`);
      for (let i = 0; i < 50; i++) {
        const b = await this.nextBatch(Number(l.acked_txid) || 0, l.organization_id);
        if (!b) break;
        let res: Response;
        try {
          res = await fetch(`${l.central_url}/v1/replication/push`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Site-Token': l.site_token },
            body: JSON.stringify(b.body), signal: AbortSignal.timeout(120000),
          });
        } catch (e: any) { throw new Error(`Central injoignable : ${e.cause?.code ?? e.message}`); }
        const j: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.message ?? `Refus du central (${res.status})`);
        await this.db.query(`DELETE FROM sync_outbox WHERE txid <= $1`, [b.lastTxid]);
        await this.db.query(`UPDATE replication_link SET acked_txid = GREATEST(acked_txid, $1), rows_sent = rows_sent + $2, last_ok_at = now(), last_error = NULL`, [b.lastTxid, b.body.rows.length]);
        l.acked_txid = String(b.lastTxid);
        sent += b.body.rows.length; batches++;
      }
      await this.db.query(`UPDATE replication_link SET last_ok_at = now(), last_error = NULL`);
      return { sent, batches };
    } catch (e: any) {
      await this.db.query(`UPDATE replication_link SET last_error = $1`, [String(e.message).slice(0, 500)]);
      return { sent, batches, error: e.message };
    } finally {
      this.running = false;
    }
  }

  /** Prochain lot : transactions terminées uniquement, coupé entre deux transactions. */
  private async nextBatch(ackedTx: number, orgId: string): Promise<null | { body: PushBody; lastTxid: number }> {
    const [{ x }] = await this.db.query(`SELECT (pg_snapshot_xmin(pg_current_snapshot())::text)::bigint AS x`);
    const cols = `seq, txid::text AS txid, tbl, op, pk, row`;
    let rows = await this.db.query(`SELECT ${cols} FROM sync_outbox WHERE txid > $1 AND txid < $2 ORDER BY txid, seq LIMIT ${BATCH_ROWS + 1}`, [ackedTx, x]);
    if (!rows.length) return null;
    if (rows.length > BATCH_ROWS) {
      const last = rows[rows.length - 1].txid;
      const kept = rows.filter((r) => r.txid !== last);
      rows = kept.length ? kept : await this.db.query(`SELECT ${cols} FROM sync_outbox WHERE txid = $1 ORDER BY seq`, [last]);
    }
    // Pièces jointes : on borne le poids du lot, toujours à une frontière de transaction.
    const blobs: Record<string, string> = {};
    let weight = 0, cut = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.tbl === 'documents' && r.op === 'U' && r.row?.storage_key) {
        let buf: Buffer | null = null;
        try { buf = await fs.readFile(path.join(docsDir(), orgId, r.row.storage_key)); } catch { this.log.warn(`Fichier manquant : ${r.row.storage_key}`); }
        if (buf) {
          if (weight > 0 && weight + buf.length > BATCH_BLOB_BYTES) {
            cut = i;
            while (cut > 0 && rows[cut - 1].txid === r.txid) cut--;
            if (cut === 0) cut = i; // une seule transaction trop lourde : on l'envoie quand même
            break;
          }
          weight += buf.length;
          blobs[r.row.storage_key] = buf.toString('base64');
        }
      }
    }
    rows = rows.slice(0, cut);
    const keep = new Set(rows.filter((r) => r.tbl === 'documents' && r.row).map((r) => r.row.storage_key as string));
    for (const k of Object.keys(blobs)) if (!keep.has(k)) delete blobs[k];

    const userIds = [...new Set(rows.filter((r) => r.tbl === 'user_organizations' && r.pk?.user_id).map((r) => r.pk.user_id as string))];
    const users = userIds.length
      ? await this.db.query(`SELECT id, email::text AS email, full_name, phone, status FROM users WHERE id = ANY($1::uuid[])`, [userIds])
      : [];
    const lastTxid = Number(rows[rows.length - 1].txid);
    return {
      lastTxid,
      body: {
        schema_version: await this.schemaVersion(), app_version: process.env.APP_VERSION ?? '0.1.0', last_txid: lastTxid,
        rows: rows.map((r) => ({ txid: Number(r.txid), tbl: r.tbl, op: r.op, pk: r.pk, row: r.row })),
        users, blobs,
      },
    };
  }
}

import { createHash } from 'crypto';
const sha256Buf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
