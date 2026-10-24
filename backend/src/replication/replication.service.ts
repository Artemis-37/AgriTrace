import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as fs from 'fs/promises';
import { createHash, createHmac } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import * as path from 'path';
import { DbService } from '../db/db.service';
import { Pairing, decodePairing, isLocal, safeEqual, sha256 } from './replication.config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^[a-z][a-z0-9_]*$/;
const BATCH_ROWS = 1000;
const MAX_TRANSFER_BATCHES = 400;
const BATCH_BLOB_BYTES = 8 * 1024 * 1024;
import { decryptFile, encryptFile } from '../common/crypto';
const docsDir = () => process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'storage', 'documents');
const KEEP_SYNCED_DELETES = new Set(['user_organizations']);
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
      await fs.writeFile(path.join(docsDir(), org, key), encryptFile(buf), { mode: 0o600 });
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
        else if (!info.serial) {
          // Le central conserve tout : une suppression venue du local est archivée, pas appliquée. Seules les affectations de droits suivent (elles ne sont pas des données métier).
          if (info.viaRole || KEEP_SYNCED_DELETES.has(r.tbl)) await c.query(info.del, [JSON.stringify(r.pk)]);
          else await c.query(`INSERT INTO replication_archive(site_id, organization_id, tbl, pk, txid) VALUES ($1,$2,$3,$4::jsonb,$5)`, [site.id, org, r.tbl, JSON.stringify(r.pk), Number(r.txid)]);
        }
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

  // ======================= Transfert par support (clé USB) =======================

  /** Côté local : fichier signé contenant tout ce que le central n'a pas encore confirmé. Le local ne se vide pas : seul l'accusé du central le fait. */
  async exportTransfer(): Promise<{ file: Buffer; name: string; rows: number; batches: number; last_txid: number; truncated: boolean }> {
    const l = await this.link();
    if (!l) throw new BadRequestException('Ce serveur n\'est pas rattaché à un central : saisissez le code de jumelage (hors ligne si besoin).');
    const lines: string[] = [JSON.stringify({ format: 'agritrace-transfer-1', site_id: l.site_id, organization_id: l.organization_id, schema_version: await this.schemaVersion(), created_at: new Date().toISOString() })];
    let cursor = Number(l.acked_txid) || 0, rows = 0, batches = 0, truncated = false;
    for (;;) {
      if (batches >= MAX_TRANSFER_BATCHES) { truncated = true; break; }
      const b = await this.nextBatch(cursor, l.organization_id);
      if (!b) break;
      lines.push(JSON.stringify(b.body)); cursor = b.lastTxid; rows += b.body.rows.length; batches++;
    }
    const secret = l.site_token.split('.').slice(1).join('.');
    const mac = createHmac('sha256', sha256(secret)).update(lines.join('\n')).digest('hex');
    lines.push(JSON.stringify({ end: true, batches, rows, last_txid: cursor, hmac: mac }));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return { file: gzipSync(Buffer.from(lines.join('\n'))), name: `AgriTrace-transfert-${stamp}.atx`, rows, batches, last_txid: cursor, truncated };
  }

  /** Côté local : le central a confirmé la réception jusqu'à ce numéro ; on peut alléger la file. */
  async acknowledgeTransfer(lastTxid: number) {
    const l = await this.link();
    if (!l) throw new BadRequestException('Serveur non rattaché');
    await this.db.query(`DELETE FROM sync_outbox WHERE txid <= $1`, [lastTxid]);
    await this.db.query(`UPDATE replication_link SET acked_txid = GREATEST(acked_txid, $1)`, [lastTxid]);
    return { acknowledged: lastTxid };
  }

  /** Côté central : applique un fichier de transfert (idempotent). */
  async importTransfer(fileBuf: Buffer, fileName: string, userId: string) {
    let text: string;
    try { text = gunzipSync(fileBuf, { maxOutputLength: 600 * 1024 * 1024 }).toString('utf8'); } catch { throw new BadRequestException('Fichier de transfert illisible'); }
    const lines = text.split('\n');
    let head: any, tail: any;
    try { head = JSON.parse(lines[0]); tail = JSON.parse(lines[lines.length - 1]); } catch { throw new BadRequestException('Fichier de transfert incomplet'); }
    if (head.format !== 'agritrace-transfer-1' || !tail.end) throw new BadRequestException('Fichier de transfert incomplet ou d\'un autre format');
    const [site] = await this.db.query(`SELECT * FROM replication_sites WHERE id = $1`, [head.site_id]);
    if (!site || site.organization_id !== head.organization_id) throw new BadRequestException('Site inconnu de ce serveur central');
    if (site.status !== 'active') throw new BadRequestException('Site suspendu');
    const mac = createHmac('sha256', site.token_hash).update(lines.slice(0, -1).join('\n')).digest('hex');
    if (!safeEqual(mac, String(tail.hmac))) throw new BadRequestException('Signature invalide : le fichier a été modifié ou ne vient pas de ce site');
    const fileSha = createHash('sha256').update(fileBuf).digest('hex');
    if ((await this.db.query(`SELECT 1 FROM transfer_imports WHERE file_sha256 = $1`, [fileSha])).length) throw new ConflictException('Ce fichier a déjà été importé');
    let applied = 0, total = 0, last = Number(site.last_txid);
    for (const ln of lines.slice(1, -1)) {
      const batch: PushBody = JSON.parse(ln);
      batch.schema_version = batch.schema_version ?? head.schema_version;
      const cur = (await this.db.query(`SELECT * FROM replication_sites WHERE id = $1`, [site.id]))[0];
      const r = await this.receive(cur, batch);
      applied += r.applied; total += batch.rows.length; last = Math.max(last, r.last_txid);
    }
    await this.db.query(`INSERT INTO transfer_imports(site_id, file_sha256, file_name, batches, rows_total, rows_applied, last_txid, imported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [site.id, fileSha, fileName.slice(0, 200), Number(tail.batches) || 0, total, applied, last, userId]);
    return { site: site.name, organization_id: site.organization_id, batches: Number(tail.batches) || 0, rows: total, applied, skipped: total - applied, last_txid: last };
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
  async linkTo(orgId: string, pairingCode: string, offline = false) {
    let p: Pairing;
    try { p = decodePairing(pairingCode); } catch (e: any) { throw new BadRequestException(e.message); }
    if (p.o !== orgId) throw new BadRequestException(`Ce code est prévu pour « ${p.n} » (${p.c}), pas pour cette coopérative.`);
    if (!offline) await this.hello(p);
    const queued = await this.db.tx(orgId, async (c) => {
      await c.query(`DELETE FROM sync_outbox`);
      await c.query(`DELETE FROM replication_link`);
      await c.query(
        `INSERT INTO replication_link(id, central_url, site_id, site_token, organization_id, enabled) VALUES (1,$1,$2,$3,$4,$5)`,
        [p.u.replace(/\/+$/, ''), p.s, `${p.s}.${p.t}`, orgId, !offline]);
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
        try { buf = decryptFile(await fs.readFile(path.join(docsDir(), orgId, r.row.storage_key))); } catch { this.log.warn(`Fichier manquant : ${r.row.storage_key}`); }
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

const sha256Buf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
