import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export interface Notice {
  kind: string; title: string; body?: string; severity?: 'info' | 'warning' | 'critical';
  entityType?: string; entityId?: string; dedupe?: string; permission?: string;
}

/**
 * Notifications persistées (CDC §25) : adressées à des utilisateurs responsables, consultables dans l'historique.
 * Insertion dans la transaction de l'action qui les provoque ; la clé de dédoublonnage évite les répétitions.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Notifications');
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: DbService) {}

  async notifyUsers(c: PoolClient, orgId: string, userIds: (string | null | undefined)[], n: Notice) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    for (const uid of ids)
      await c.query(
        `INSERT INTO notifications(organization_id, user_id, kind, severity, title, body, entity_type, entity_id, dedupe_key, permission_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        [orgId, uid, n.kind, n.severity ?? 'info', n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null, n.dedupe ?? randomUUID(), n.permission ?? null]);
    return ids.length;
  }

  /** Tous les membres actifs dont le rôle détient la permission (hors `exclude`). */
  async notifyPermission(c: PoolClient, orgId: string, permission: string, n: Notice, exclude?: string) {
    const rows = (await c.query(
      `SELECT DISTINCT uo.user_id FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id
        WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = $2`, [orgId, permission])).rows;
    return this.notifyUsers(c, orgId, rows.map((r) => r.user_id).filter((u) => u !== exclude), { ...n, permission });
  }

  /** Recherche des alertes calculables (retards, échéances, incohérences). Idempotente grâce au dédoublonnage quotidien. */
  async scanOrg(orgId: string) {
    return this.db.tx(orgId, async (c) => {
      const day = new Date().toISOString().slice(0, 10);
      const found: Record<string, number> = {};
      const add = async (kind: string, n: number) => { found[kind] = (found[kind] ?? 0) + n; };

      for (const t of (await c.query(
        `SELECT id, code, title, assignee_id, due_date::text AS due FROM tasks WHERE due_date < current_date AND status IN ('open','in_progress','pending_sync','to_correct')`)).rows) {
        await add('task_overdue', await this.notifyUsers(c, orgId, [t.assignee_id], { kind: 'task_overdue', severity: 'warning', title: `Mission en retard : ${t.code}`,
          body: `${t.title} (échéance ${t.due})`, entityType: 'task', entityId: t.id, dedupe: `task_overdue:${t.id}:${day}` }));
        await add('task_overdue', await this.notifyPermission(c, orgId, 'tasks:read_all', { kind: 'task_overdue', severity: 'warning', title: `Mission en retard : ${t.code}`,
          body: `${t.title} (échéance ${t.due})`, entityType: 'task', entityId: t.id, dedupe: `task_overdue:${t.id}:${day}` }));
      }
      for (const w of (await c.query(`SELECT id, net_kg, declared_kg FROM weighings WHERE status = 'pending_approval'`)).rows)
        await add('weighing_variance', await this.notifyPermission(c, orgId, 'weighings:approve', { kind: 'weighing_variance', severity: 'warning', title: 'Écart de pesée à approuver',
          body: `Net ${w.net_kg} kg pour ${w.declared_kg} kg déclarés`, entityType: 'weighing', entityId: w.id, dedupe: `weighing_variance:${w.id}` }));
      for (const s of (await c.query(
        `SELECT m.lot_id, m.warehouse_id, l.code, sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) AS bal
           FROM warehouse_movements m JOIN lots l ON l.id = m.lot_id GROUP BY m.lot_id, m.warehouse_id, l.code
          HAVING sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) < 0`)).rows)
        await add('stock_negative', await this.notifyPermission(c, orgId, 'warehouses:read', { kind: 'stock_negative', severity: 'critical', title: `Stock négatif : lot ${s.code}`,
          body: `Solde ${s.bal} kg`, entityType: 'lot', entityId: s.lot_id, dedupe: `stock_negative:${s.lot_id}:${s.warehouse_id}:${day}` }));
      for (const i of (await c.query(
        `SELECT i.id, i.number, i.due_date::text AS due FROM invoices i WHERE i.status IN ('issued','partially_paid') AND i.due_date < current_date`)).rows)
        await add('invoice_overdue', await this.notifyPermission(c, orgId, 'invoices:read', { kind: 'invoice_overdue', severity: 'warning', title: `Facture échue : ${i.number}`,
          body: `Échéance ${i.due}`, entityType: 'invoice', entityId: i.id, dedupe: `invoice_overdue:${i.id}:${day}` }));
      for (const s of (await c.query(
        `SELECT id, reference, departed_at FROM shipments WHERE status = 'in_transit' AND departed_at < now() - interval '7 days'`)).rows)
        await add('shipment_late', await this.notifyPermission(c, orgId, 'shipments:manage', { kind: 'shipment_late', severity: 'warning', title: `Expédition en retard : ${s.reference}`,
          body: 'En transit depuis plus de 7 jours', entityType: 'shipment', entityId: s.id, dedupe: `shipment_late:${s.id}:${day}` }));
      for (const l of (await c.query(
        `SELECT i.id, i.loan_id, i.seq, i.due_date::text AS due, i.amount FROM loan_installments i JOIN loans l ON l.id = i.loan_id
          WHERE l.status = 'disbursed' AND i.due_date <= current_date + 7
            AND l.approved_amount > coalesce((SELECT sum(CASE WHEN r.reversal_of IS NULL THEN r.amount ELSE -r.amount END) FROM loan_repayments r WHERE r.loan_id = l.id), 0)
            AND (SELECT coalesce(sum(x.amount),0) FROM loan_installments x WHERE x.loan_id = i.loan_id AND x.seq <= i.seq)
                > coalesce((SELECT sum(CASE WHEN r.reversal_of IS NULL THEN r.amount ELSE -r.amount END) FROM loan_repayments r WHERE r.loan_id = l.id), 0)`)).rows)
        await add('loan_due', await this.notifyPermission(c, orgId, 'loans:read', { kind: 'loan_due', severity: 'warning', title: `Échéance de prêt n°${l.seq}`,
          body: `Échéance du ${l.due} : ${l.amount}`, entityType: 'loan', entityId: l.loan_id, dedupe: `loan_due:${l.id}:${day}` }));
      for (const p of (await c.query(
        `SELECT count(*)::int AS n FROM parcels WHERE status = 'active' AND verification_status = 'declared' AND geometry IS NOT NULL`)).rows.filter((r) => r.n > 0))
        await add('parcels_pending', await this.notifyPermission(c, orgId, 'parcels:verify', { kind: 'parcels_pending', title: `${p.n} parcelle(s) en attente de validation`,
          dedupe: `parcels_pending:${day}` }));
      for (const a of (await c.query(`SELECT count(*)::int AS n FROM parcel_anomalies WHERE status = 'open'`)).rows.filter((r) => r.n > 0))
        await add('geo_anomalies_open', await this.notifyPermission(c, orgId, 'geo:anomalies', { kind: 'geo_anomalies_open', severity: 'warning', title: `${a.n} anomalie(s) cartographique(s) ouverte(s)`,
          dedupe: `geo_anomalies_open:${day}` }));
      return { scanned_at: new Date().toISOString(), created: found };
    });
  }

  onApplicationBootstrap() {
    const minutes = Number(process.env.NOTIFY_SCAN_INTERVAL_MIN ?? 60);
    if (!minutes || minutes < 0) return;
    this.timer = setInterval(() => void this.scanAll(), minutes * 60_000);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }

  private async scanAll() {
    try {
      const orgs = await this.db.query<{ id: string }>(`SELECT id FROM organizations WHERE status = 'active'`);
      for (const o of orgs) await this.scanOrg(o.id).catch((e) => this.logger.warn(`scan ${o.id}: ${e.message}`));
    } catch (e: any) { this.logger.warn(`scan: ${e.message}`); }
  }
}
