import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { applyCancellation, describe, OP_RULES, OP_TYPES, OpType } from './operation-types';

class RequestDto {
  @IsIn(OP_TYPES) entity_type: OpType;
  @IsUUID() entity_id: string;
  @IsString() @Length(5, 500) reason: string;
}
class DecideDto {
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject';
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

const can = (req: any, perms: string[]) => perms.some((p) => req.org.permissions?.has?.(p) ?? req.org.permissions?.includes?.(p));

/** Poids sans zéros inutiles : 1795.000 → « 1795 kg », 12.500 → « 12.5 kg ». */
/** Poids en kg entiers, séparateur de milliers = espace insécable fine (39 880), jamais de virgule ni de « .000 ». */
const nb = (v: any) => String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
const kg = (v: any) => `${nb(v)} kg`;
@ApiTags('operations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class OperationsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  /** Opérations récentes réalisées par l'utilisateur (ou, avec le droit d'approuver, par toute l'équipe). */
  @Get('my-operations')
  @RequirePermissions('cancellations:request')
  async mine(@Query('all') all: string | undefined, @Query('limit') limit: string | undefined, @Req() req: any) {
    const everyone = all === '1' && can(req, ['cancellations:decide']);
    const n = Math.min(Math.max(Number(limit) || 60, 1), 200);
    const u = req.user.id;
    return this.db.tx(req.org.id, async (c) => {
      const out: any[] = [];
      const add = (type: OpType, rows: any[]) => { if (can(req, OP_RULES[type].view)) for (const r of rows) out.push({ entity_type: type, title: OP_RULES[type].title, ...r }); };
      const who = everyone ? '' : 'AND {col} = $1';
      const q = (sql: string, col: string) => c.query(sql.replace('{who}', who.replace('{col}', col)), everyone ? [n] : [u, n]);
      const lim = everyone ? '$1' : '$2';
      add('convoy_reception', (await q(
        `SELECT r.id AS entity_id, 'Réception du convoi ' || v.convoy_no || ' · ' || trim_scale(r.total_kg)::text || ' kg' AS label, r.received_at AS at, ru.full_name AS by
           FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id LEFT JOIN users ru ON ru.id = r.received_by WHERE true {who} ORDER BY r.received_at DESC LIMIT ${lim}`, 'r.received_by')).rows);
      add('convoy_settlement', (await q(
        `SELECT r.id AS entity_id, 'Règlement du convoi ' || v.convoy_no || ' · ' || r.amount AS label, r.settled_at AS at, su.full_name AS by
           FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id LEFT JOIN users su ON su.id = r.settled_by WHERE r.status = 'settled' {who} ORDER BY r.settled_at DESC LIMIT ${lim}`, 'r.settled_by')).rows);
      add('financial_transaction', (await q(
        `SELECT t.id AS entity_id, CASE t.direction WHEN 'in' THEN 'Entrée ' ELSE 'Sortie ' END || t.amount || ' ' || t.currency || ' · ' || t.reason AS label, t.created_at AS at, cu.full_name AS by
           FROM financial_transactions t LEFT JOIN users cu ON cu.id = t.created_by WHERE true {who} ORDER BY t.created_at DESC LIMIT ${lim}`, 't.created_by')).rows);
      add('accounting_entry', (await q(
        `SELECT e.id AS entity_id, 'Écriture ' || e.number || ' · ' || e.label AS label, e.created_at AS at, cu.full_name AS by
           FROM accounting_entries e LEFT JOIN users cu ON cu.id = e.created_by WHERE true {who} ORDER BY e.created_at DESC LIMIT ${lim}`, 'e.created_by')).rows);
      add('warehouse_movement', (await q(
        `SELECT m.id AS entity_id, m.reference || ' · ' || CASE m.direction WHEN 'in' THEN 'entrée ' ELSE 'sortie ' END || trim_scale(m.quantity_kg)::text || ' kg' AS label, m.created_at AS at, cu.full_name AS by
           FROM warehouse_movements m LEFT JOIN users cu ON cu.id = m.created_by WHERE true {who} ORDER BY m.created_at DESC LIMIT ${lim}`, 'm.created_by')).rows);
      out.sort((a, b) => +new Date(b.at) - +new Date(a.at));
      const top = out.slice(0, n);
      const reqs = (await c.query(`SELECT entity_type, entity_id, id, status FROM cancellation_requests WHERE entity_id = ANY($1::uuid[]) ORDER BY requested_at`, [top.map((x) => x.entity_id)])).rows;
      for (const x of top) {
        const d = await describe(c, x.entity_type, x.entity_id);
        const mine = reqs.filter((r) => r.entity_type === x.entity_type && r.entity_id === x.entity_id);
        const last = mine[mine.length - 1];
        x.cancellable = !!d?.cancellable && can(req, [OP_RULES[x.entity_type as OpType].request]);
        x.why_not = d?.cancellable ? undefined : d?.why;
        x.request_status = last?.status ?? null;
        x.request_id = last?.id ?? null;
        if (last?.status === 'pending') x.cancellable = false;
      }
      return top;
    });
  }

  /** Données d'un reçu imprimable. Chaque édition est tracée ; à partir de la deuxième, le document est un duplicata. */
  @Get('operation-receipts/:type/:id')
  @RequirePermissions('cancellations:request')
  async receipt(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    if (!OP_TYPES.includes(type as OpType)) throw new BadRequestException("Type d'opération inconnu");
    const t = type as OpType;
    if (!can(req, OP_RULES[t].view)) throw new ForbiddenException('Droit insuffisant pour imprimer ce document');
    const data = await this.db.tx(req.org.id, async (c) => {
      const d = await describe(c, t, id);
      if (!d || (t === 'convoy_settlement' && !d)) throw new NotFoundException('Opération introuvable');
      const org = (await c.query(
        `SELECT o.name, p.commercial_name, p.address, p.phone, p.email, p.currency FROM organizations o LEFT JOIN organization_profile p ON p.organization_id = o.id WHERE o.id = $1`, [req.org.id])).rows[0];
      const user = (id2: string | null) => id2 ? c.query(`SELECT full_name FROM users WHERE id = $1`, [id2]).then((r) => r.rows[0]?.full_name ?? null) : Promise.resolve(null);
      let number = '', lines: { label: string; value: string }[] = [], extra: any = {};
      if (t === 'convoy_reception' || t === 'convoy_settlement') {
        const r = (await c.query(`SELECT r.*, v.convoy_no, v.driver_name, v.truck_no, v.declared_kg, v.declared_bags, w.name AS warehouse, ku.full_name AS collector, (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS collector_code
            FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id JOIN warehouses w ON w.id = r.warehouse_id JOIN collectors k ON k.id = v.collector_id JOIN users ku ON ku.id = k.user_id WHERE r.id = $1`, [id])).rows[0];
        number = r.convoy_no;
        lines = [{ label: 'Connaissement', value: r.convoy_no }, { label: 'Collecteur', value: r.collector }, { label: 'Chauffeur / camion', value: `${r.driver_name} · ${r.truck_no}` },
          { label: 'Magasin', value: r.warehouse }, { label: 'Poids déclaré', value: r.declared_kg == null ? '—' : kg(r.declared_kg) }, { label: 'Poids reçu', value: kg(r.total_kg) },
          { label: 'Sacs', value: String(r.bags) }, { label: 'Écart', value: r.variance_kg == null ? '—' : kg(r.variance_kg) }];
        if (t === 'convoy_settlement') {
          if (r.status !== 'settled') throw new NotFoundException("Ce convoi n'est pas réglé");
          lines.push({ label: 'Prix unitaire', value: String(r.unit_price) }, { label: 'Montant brut', value: String(r.gross_amount ?? '') }, { label: 'Transport', value: String(r.transport_total ?? 0) },
            { label: 'Retenue', value: String(r.retention_amount ?? 0) }, { label: 'Avance compensée', value: String(r.advance_netted ?? 0) }, { label: 'Net payé', value: String(r.amount) });
        }
        extra = { operator: await user(t === 'convoy_settlement' ? r.settled_by : r.received_by), notes: r.notes };
        if (t === 'convoy_reception') {
          // Bulletin de pesée : poids en kg entiers (chaînes déjà formatées), champs absents = null (non imprimés).
          const w = (v: any) => (v == null ? null : nb(v));
          extra.bulletin = {
            no: r.bulletin_no, convoy_no: r.convoy_no, received_at: r.received_at, collector: r.collector, collector_code: r.collector_code, driver: r.driver_name, truck: r.truck_no, trailer: r.trailer_no, origin: r.origin,
            warehouse: r.warehouse, grade: r.grade, status: r.status,
            weigh_in: w(r.weigh_in_kg), weigh_in_at: r.weigh_in_at, scale_in: r.scale_in, weigh_out: w(r.weigh_out_kg), weigh_out_at: r.weigh_out_at, scale_out: r.scale_out,
            gross: w(r.gross_kg), bag_tare: w(r.bag_tare_kg), refaction: w(r.refaction_kg), net: w(r.total_kg), declared: w(r.declared_kg), variance: r.variance_kg == null ? null : (Number(r.variance_kg) > 0 ? '+' : '') + nb(r.variance_kg),
            net_delivered: r.gross_kg == null ? null : w(Number(r.gross_kg) - Number(r.bag_tare_kg ?? 0)),
            avg_bag: r.bags > 0 ? nb(Number(r.total_kg) / r.bags) : null,
            missing: r.declared_bags != null && r.bags_unloaded != null ? r.declared_bags - r.bags_unloaded : null,
            approver: await user(r.variance_approved_by ?? null),
            bags: r.bags, bags_unloaded: r.bags_unloaded, bags_refused: r.bags_refused, declared_bags: r.declared_bags, analysis: r.analysis ?? {}, notes: r.notes,
          };
        }
      } else if (t === 'financial_transaction') {
        const x = (await c.query(`SELECT t.*, a.name AS account FROM financial_transactions t JOIN financial_accounts a ON a.id = t.account_id WHERE t.id = $1`, [id])).rows[0];
        number = x.id.slice(0, 8).toUpperCase();
        lines = [{ label: 'Compte', value: x.account }, { label: 'Sens', value: x.direction === 'in' ? 'Encaissement' : 'Décaissement' }, { label: 'Montant', value: `${x.amount} ${x.currency}` }, { label: 'Motif', value: x.reason }];
        extra = { operator: await user(x.created_by) };
      } else if (t === 'accounting_entry') {
        const e = (await c.query(`SELECT e.*, j.code AS journal FROM accounting_entries e JOIN journals j ON j.id = e.journal_id WHERE e.id = $1`, [id])).rows[0];
        const ls = (await c.query(`SELECT a.code, a.label AS name, l.debit, l.credit FROM accounting_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`, [id])).rows;
        number = e.number;
        lines = [{ label: 'Journal', value: e.journal }, { label: 'Date', value: String(e.entry_date).slice(0, 10) }, { label: 'Libellé', value: e.label },
          ...ls.map((l: any) => ({ label: `${l.code} ${l.name}`, value: Number(l.debit) ? `Débit ${l.debit}` : `Crédit ${l.credit}` }))];
        extra = { operator: await user(e.created_by) };
      } else {
        const m = (await c.query(`SELECT m.*, w.name AS warehouse, l.code AS lot FROM warehouse_movements m JOIN warehouses w ON w.id = m.warehouse_id JOIN lots l ON l.id = m.lot_id WHERE m.id = $1`, [id])).rows[0];
        number = m.reference;
        lines = [{ label: 'Magasin', value: m.warehouse }, { label: 'Lot', value: m.lot }, { label: 'Type', value: m.movement_type }, { label: 'Sens', value: m.direction === 'in' ? 'Entrée' : 'Sortie' },
          { label: 'Quantité', value: kg(m.quantity_kg) }, { label: 'Motif', value: m.reason ?? '—' }];
        extra = { operator: await user(m.created_by) };
      }
      const prints = (await c.query(`SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action = 'receipt.print' AND entity_id = $2::text`, [req.org.id, id])).rows[0].n;
      const reversed = d.cancellable === false && /annul/i.test(d.why ?? '');
      return { type: t, title: OP_RULES[t].title, number, at: d.at, label: d.label, lines, organization: org, printed_by: req.user.full_name ?? null, duplicate: prints > 0, copy_no: prints + 1, cancelled: reversed, ...extra };
    });
    await this.log(req, 'receipt.print', t, id, { number: data.number, copy_no: data.copy_no });
    return data;
  }

  @Post('cancellation-requests')
  @RequirePermissions('cancellations:request')
  async request(@Body() b: RequestDto, @Req() req: any) {
    if (!can(req, [OP_RULES[b.entity_type].request])) throw new ForbiddenException("Vous n'avez pas le droit de demander l'annulation de ce type d'opération");
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await describe(c, b.entity_type, b.entity_id);
      if (!d) throw new NotFoundException('Opération introuvable');
      if (!d.cancellable) throw new ConflictException(d.why ?? 'Cette opération ne peut pas être annulée');
      let r;
      try {
        r = (await c.query(
          `INSERT INTO cancellation_requests(organization_id, entity_type, entity_id, entity_label, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.org.id, b.entity_type, b.entity_id, d.label, b.reason.trim(), req.user.id])).rows[0];
      } catch (e: any) { if (e.code === '23505') throw new ConflictException("Une demande d'annulation est déjà en attente pour cette opération"); throw e; }
      await this.notif.notifyPermission(c, req.org.id, 'cancellations:decide', {
        kind: 'cancellation_request', severity: 'warning', title: `Demande d'annulation : ${d.label}`, body: `${req.user.full_name ?? ''} · ${b.reason.trim()}`,
        entityType: 'cancellation_request', entityId: r.id, dedupe: `cancel_req:${r.id}` }, req.user.id);
      return r;
    });
    await this.log(req, 'cancellation.request', b.entity_type, b.entity_id, { request_id: row.id, reason: b.reason });
    return row;
  }

  @Get('cancellation-requests')
  @RequirePermissions('cancellations:request')
  list(@Query('status') status: string | undefined, @Req() req: any) {
    const all = can(req, ['cancellations:decide']);
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT q.*, ru.full_name AS requested_by_name, du.full_name AS decided_by_name FROM cancellation_requests q
         LEFT JOIN users ru ON ru.id = q.requested_by LEFT JOIN users du ON du.id = q.decided_by
        WHERE ($1::text IS NULL OR q.status = $1) AND ($2::boolean OR q.requested_by = $3) ORDER BY q.requested_at DESC LIMIT 200`,
      [status ?? null, all, req.user.id])).rows);
  }

  @Post('cancellation-requests/:id/decide')
  @RequirePermissions('cancellations:decide')
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDto, @Req() req: any) {
    if (b.decision === 'reject' && (!b.note || b.note.trim().length < 3)) throw new BadRequestException('Précisez le motif du refus');
    const out = await this.db.tx(req.org.id, async (c) => {
      const q = (await c.query(`SELECT * FROM cancellation_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!q) throw new NotFoundException('Demande introuvable');
      if (q.status !== 'pending') throw new ConflictException('Cette demande a déjà été traitée');
      if (q.requested_by === req.user.id) throw new ForbiddenException('Vous ne pouvez pas approuver votre propre demande');
      let summary = b.note?.trim() ?? '', snapshot: any = null, status = b.decision === 'approve' ? 'approved' : 'rejected';
      if (b.decision === 'approve') {
        const r = await applyCancellation(c, req.org.id, req.user.id, q.entity_type, q.entity_id, q.reason);
        summary = r.summary + (b.note ? ` — ${b.note.trim()}` : ''); snapshot = r.snapshot ?? null;
      }
      await c.query(`UPDATE cancellation_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, snapshot = $5 WHERE id = $1`,
        [id, status, req.user.id, summary || null, snapshot]);
      await this.notif.notifyUsers(c, req.org.id, [q.requested_by], {
        kind: 'cancellation_decided', severity: status === 'approved' ? 'info' : 'warning',
        title: `Annulation ${status === 'approved' ? 'approuvée' : 'refusée'} : ${q.entity_label}`, body: summary || undefined,
        entityType: 'cancellation_request', entityId: id, dedupe: `cancel_dec:${id}` });
      await c.query(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE entity_type = 'cancellation_request' AND entity_id = $1 AND kind = 'cancellation_request'`, [id]);
      return { id, status, summary, entity_type: q.entity_type, entity_id: q.entity_id };
    });
    await this.log(req, `cancellation.${out.status}`, out.entity_type, out.entity_id, { request_id: id, summary: out.summary });
    return out;
  }
}
