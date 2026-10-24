import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

class LinkDto {
  @Matches(/^[A-Za-z0-9_-]{2,20}$/) code: string;
  /** supply_to : nous livrons à l'autre organisation ; receive_from : nous recevons de l'autre. */
  @IsIn(['supply_to', 'receive_from']) direction: 'supply_to' | 'receive_from';
  @IsOptional() @IsBoolean() bidirectional?: boolean;
}
class WeighInDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000000) gross_kg: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100000000) declared_gross_kg?: number;
  @IsOptional() @IsString() @Length(0, 120) origin?: string;
  @IsOptional() @IsString() @Length(0, 120) transporter?: string;
  @IsOptional() @IsString() @Length(0, 120) bridge_in?: string;
}
class WeighOutDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100000000) tare_kg: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bags_discharged?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bags_refused?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1000000) sack_tare_kg?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1000000) pallet_tare_kg?: number;
  @IsOptional() @IsString() @Length(0, 120) bridge_out?: string;
}
class AnalysisDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) moisture_pct: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) bean_count?: number;
  @IsOptional() @IsObject() defects?: Record<string, number>;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1000000) refaction_kg?: number;
  @IsOptional() @IsString() @Length(0, 60) grade?: string;
  @IsIn(['accepted', 'rejected']) decision: 'accepted' | 'rejected';
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}
class SettleDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1000000) unit_price: number;
  @IsOptional() @IsString() @Length(0, 120) payment_ref?: string;
}

const LIST = `d.id, d.number, d.source_org_id, d.source_org_name, d.source_sheet_no, d.truck_no, d.driver_name, d.bl_no, d.lot_id_dse, d.departure_date, d.declared_kg, d.declared_bags,
  d.status, d.gross_kg, d.tare_kg, d.net_kg, d.net_delivered_kg, d.net_payable_kg, d.variance_kg, d.variance_pct, d.moisture_pct, d.decision, d.bulletin_no, d.unit_price, d.amount, d.settled_at, d.created_at, d.organization_id`;

/** Liens entre organisations et livraisons : l'exportateur (ou une coopérative destinataire) pèse, analyse et règle ce que lui livre une coopérative. */
@ApiTags('deliveries')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class DeliveriesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private has(req: any, p: string) { return req.org.permissions.has(p); }
  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'delivery', entityId: id, details });
  }
  private need(req: any, ...p: string[]) { if (!p.some((x) => this.has(req, x))) throw new ForbiddenException('Permission insuffisante'); }

  // ── Liens entre organisations
  @Get('org-links')
  async links(@Req() req: any) {
    this.need(req, 'links:manage', 'deliveries:read');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT l.id, l.status, l.bidirectional, l.created_at, l.accepted_at,
              CASE WHEN l.from_org_id = $1 THEN 'supplier' ELSE 'receiver' END AS my_side,
              (l.requested_by_org = $1) AS requested_by_me,
              o.id AS other_id, o.code AS other_code, o.name AS other_name, o.kind AS other_kind
         FROM org_links l JOIN organizations o ON o.id = CASE WHEN l.from_org_id = $1 THEN l.to_org_id ELSE l.from_org_id END
        WHERE l.status <> 'revoked' ORDER BY o.name`, [req.org.id])).rows);
  }

  @Post('org-links') @RequirePermissions('links:manage')
  async proposeLink(@Body() b: LinkDto, @Req() req: any) {
    const [other] = await this.db.query<any>(`SELECT id, name, status FROM organizations WHERE code = $1`, [b.code.toUpperCase()]);
    if (!other || other.status !== 'active') throw new NotFoundException('Aucune organisation active avec ce code');
    if (other.id === req.org.id) throw new BadRequestException('Une organisation ne peut pas se lier à elle-même');
    const from = b.direction === 'supply_to' ? req.org.id : other.id, to = b.direction === 'supply_to' ? other.id : req.org.id;
    const row = await this.db.tx(req.org.id, async (c) => {
      const ex = (await c.query(`SELECT id, status, from_org_id, to_org_id FROM org_links WHERE (from_org_id = $1 AND to_org_id = $2) OR (from_org_id = $2 AND to_org_id = $1)`, [from, to])).rows;
      if (ex.some((x) => x.status !== 'revoked')) throw new ConflictException('Un lien existe déjà avec cette organisation');
      await c.query(`DELETE FROM org_links WHERE id = ANY($1::uuid[])`, [ex.map((x) => x.id)]);
      return (await c.query(`INSERT INTO org_links(from_org_id, to_org_id, bidirectional, requested_by_org, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, status`,
        [from, to, !!b.bidirectional, req.org.id, req.user.id])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'org_link.propose', entityType: 'org_link', entityId: row.id, details: { with: other.name, direction: b.direction } });
    return row;
  }

  @Post('org-links/:id/accept') @RequirePermissions('links:manage')
  async acceptLink(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const l = (await c.query(`SELECT * FROM org_links WHERE id = $1`, [id])).rows[0];
      if (!l) throw new NotFoundException();
      if (l.status !== 'pending') throw new ConflictException('Ce lien n\'est pas en attente');
      if (l.requested_by_org === req.org.id) throw new ForbiddenException('L\'autre organisation doit accepter le lien');
      return (await c.query(`UPDATE org_links SET status = 'active', accepted_by = $2, accepted_at = now() WHERE id = $1 RETURNING id, status`, [id, req.user.id])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'org_link.accept', entityType: 'org_link', entityId: id });
    return r;
  }

  @Post('org-links/:id/revoke') @RequirePermissions('links:manage')
  async revokeLink(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const x = await c.query(`UPDATE org_links SET status = 'revoked' WHERE id = $1 AND status <> 'revoked' RETURNING id, status`, [id]);
      if (!x.rowCount) throw new NotFoundException();
      return x.rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'org_link.revoke', entityType: 'org_link', entityId: id });
    return r;
  }

  /** Organisations auxquelles cette organisation peut livrer (lien actif, sens autorisé). */
  @Get('org-links/destinations') @RequirePermissions('dispatch:manage')
  destinations(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT o.id, o.code, o.name, o.kind FROM org_links l
         JOIN organizations o ON o.id = CASE WHEN l.from_org_id = $1 THEN l.to_org_id ELSE l.from_org_id END
        WHERE l.status = 'active' AND o.status = 'active' AND (l.from_org_id = $1 OR l.bidirectional) ORDER BY o.name`, [req.org.id])).rows);
  }

  // ── Livraisons
  @Get('deliveries')
  async list(@Req() req: any, @Query('status') status?: string, @Query('source') source?: string) {
    this.need(req, 'deliveries:read');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT ${LIST} FROM deliveries d WHERE d.organization_id = $1 AND ($2::text IS NULL OR d.status = $2) AND ($3::uuid IS NULL OR d.source_org_id = $3) ORDER BY d.created_at DESC LIMIT 500`,
      [req.org.id, status || null, source && /^[0-9a-f-]{36}$/i.test(source) ? source : null])).rows);
  }

  /** Suivi côté fournisseur : ce que nous avons livré et ce qu'il en est advenu. */
  @Get('deliveries/sent')
  async sent(@Req() req: any) {
    this.need(req, 'deliveries:read', 'dispatch:manage');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT ${LIST}, o.name AS destination_name FROM deliveries d JOIN organizations o ON o.id = d.organization_id WHERE d.source_org_id = $1 ORDER BY d.created_at DESC LIMIT 500`, [req.org.id])).rows);
  }

  /** Synthèse par coopérative fournisseuse (l'écran « Coopératives » de l'exportateur). */
  @Get('deliveries/suppliers')
  async suppliers(@Req() req: any) {
    this.need(req, 'deliveries:read');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT d.source_org_id AS id, d.source_org_name AS name, count(*)::int AS deliveries,
              coalesce(sum(coalesce(d.net_payable_kg, d.net_delivered_kg, d.net_kg)) FILTER (WHERE d.decision = 'accepted'), 0) AS accepted_kg,
              coalesce(sum(coalesce(d.net_payable_kg, d.net_delivered_kg, d.net_kg)) FILTER (WHERE d.decision = 'rejected'), 0) AS rejected_kg,
              coalesce(sum(d.amount) FILTER (WHERE d.status = 'settled'), 0) AS paid,
              coalesce(sum(coalesce(d.net_payable_kg, d.net_delivered_kg, d.net_kg)) FILTER (WHERE d.decision = 'accepted' AND d.status = 'analysed'), 0) AS to_settle_kg,
              count(*) FILTER (WHERE d.status IN ('arrived','weighing_in','weighed'))::int AS in_progress
         FROM deliveries d WHERE d.organization_id = $1 GROUP BY d.source_org_id, d.source_org_name ORDER BY d.source_org_name`, [req.org.id])).rows);
  }

  @Get('deliveries/:id')
  async one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.need(req, 'deliveries:read', 'dispatch:manage');
    return this.db.tx(req.org.id, async (c) => {
      const d = (await c.query(`SELECT d.*, o.name AS destination_name FROM deliveries d JOIN organizations o ON o.id = d.organization_id WHERE d.id = $1`, [id])).rows[0];
      if (!d) throw new NotFoundException();
      return { ...d, mine: d.organization_id === req.org.id };
    });
  }

  private async mutate(req: any, id: string, from: string[], sql: string, params: any[], action: string, notify?: (d: any) => { title: string; body: string }) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const d = (await c.query(`SELECT * FROM deliveries WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, req.org.id])).rows[0];
      if (!d) throw new NotFoundException();
      if (!from.includes(d.status)) throw new ConflictException(`Opération impossible : la livraison est « ${d.status} »`);
      return { before: d, after: (await c.query(sql, [id, ...params])).rows[0] };
    });
    await this.log(req, action, id, { number: out.after.number });
    if (notify) await this.notifySource(out.after, notify(out.after)).catch(() => undefined);
    return out.after;
  }

  /** Prévient les comptes du fournisseur (lecture de ses livraisons). */
  private async notifySource(d: any, n: { title: string; body: string }) {
    await this.db.tx(d.source_org_id, async (c: PoolClient) => {
      const ids = (await c.query(
        `SELECT DISTINCT uo.user_id FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id
          WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code IN ('dispatch:manage','deliveries:read')`, [d.source_org_id])).rows.map((r) => r.user_id);
      if (ids.length) await this.notif.notifyUsers(c, d.source_org_id, ids, { kind: 'delivery', severity: 'info', title: n.title, body: n.body, entityType: 'delivery', entityId: d.id, dedupe: `delivery:${d.id}:${d.status}` });
    });
  }

  @Post('deliveries/:id/weigh-in') @RequirePermissions('deliveries:weigh')
  weighIn(@Param('id', ParseUUIDPipe) id: string, @Body() b: WeighInDto, @Req() req: any) {
    return this.mutate(req, id, ['arrived'],
      `UPDATE deliveries SET status = 'weighing_in', gross_kg = $2, gross_at = now(), gross_by = $3, declared_gross_kg = $4, origin = $5, transporter = $6, bridge_in = $7 WHERE id = $1 RETURNING *`,
      [b.gross_kg, req.user.id, b.declared_gross_kg ?? null, b.origin?.trim() || null, b.transporter?.trim() || null, b.bridge_in?.trim() || null], 'delivery.weigh_in');
  }

  @Post('deliveries/:id/weigh-out') @RequirePermissions('deliveries:weigh')
  async weighOut(@Param('id', ParseUUIDPipe) id: string, @Body() b: WeighOutDto, @Req() req: any) {
    const cur = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT gross_kg, declared_kg, declared_bags FROM deliveries WHERE id = $1 AND organization_id = $2`, [id, req.org.id])).rows[0]);
    if (!cur) throw new NotFoundException();
    if (cur.gross_kg == null) throw new ConflictException('Peser d\'abord l\'entrée (poids d\'entrée)');
    if (b.tare_kg >= Number(cur.gross_kg)) throw new UnprocessableEntityException('Le poids de sortie doit être inférieur au poids d\'entrée');
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const brutLivre = r3(Number(cur.gross_kg) - b.tare_kg);                 // poids brut livré
    const sackTare = b.sack_tare_kg ?? 0, palletTare = b.pallet_tare_kg ?? 0;
    const net = r3(brutLivre - sackTare - palletTare);                         // poids net livré
    if (net <= 0) throw new UnprocessableEntityException('Les tares dépassent le poids livré');
    const discharged = b.bags_discharged ?? null, refused = b.bags_refused ?? 0;
    if (discharged != null && refused > discharged) throw new UnprocessableEntityException('Les sacs refusés dépassent les sacs déchargés');
    const decl = Number(cur.declared_kg ?? 0);
    const variance = r3(net - decl);
    return this.mutate(req, id, ['weighing_in'],
      `UPDATE deliveries SET status = 'weighed', tare_kg = $2, tare_at = now(), tare_by = $3, net_kg = $4, net_delivered_kg = $5, bags_counted = $6, bags_discharged = $6, bags_refused = $7,
              sack_tare_kg = $8, pallet_tare_kg = $9, bridge_out = $10, variance_kg = $11, variance_pct = $12 WHERE id = $1 RETURNING *`,
      [b.tare_kg, req.user.id, brutLivre, net, discharged, refused, sackTare, palletTare, b.bridge_out?.trim() || null, variance, decl > 0 ? Math.round(variance / decl * 100000) / 1000 : null], 'delivery.weigh_out',
      (d) => ({ title: `Livraison ${d.source_sheet_no} pesée`, body: `Poids net livré ${Number(d.net_delivered_kg)} kg (déclaré ${Number(d.declared_kg)} kg, écart ${Number(d.variance_kg)} kg)` }));
  }

  @Post('deliveries/:id/analysis') @RequirePermissions('deliveries:analyse')
  async analysis(@Param('id', ParseUUIDPipe) id: string, @Body() b: AnalysisDto, @Req() req: any) {
    if (b.decision === 'rejected' && !b.notes?.trim()) throw new UnprocessableEntityException('Indiquez le motif du rejet');
    // En-tête de l'exportateur figé sur le bulletin : lisible aussi par la coopérative fournisseuse
    const issuer = await this.db.tx(req.org.id, async (c) => {
      const o = (await c.query(
        `SELECT o.name, coalesce(p.commercial_name, o.name) AS commercial_name, p.address, p.phone, p.email, p.ccc_code,
                (SELECT name FROM campaigns ORDER BY starts_on DESC LIMIT 1) AS campaign, (SELECT name FROM warehouses WHERE status = 'active' ORDER BY created_at LIMIT 1) AS plant
           FROM organizations o LEFT JOIN organization_profile p ON p.organization_id = o.id WHERE o.id = $1`, [req.org.id])).rows[0];
      return { ...o, printed_by: (await c.query(`SELECT full_name FROM users WHERE id = $1`, [req.user.id])).rows[0]?.full_name ?? '' };
    }).catch(() => ({}));
    const cur = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT net_delivered_kg FROM deliveries WHERE id = $1 AND organization_id = $2`, [id, req.org.id])).rows[0]);
    if (!cur) throw new NotFoundException();
    const refaction = b.refaction_kg ?? 0;
    if (cur.net_delivered_kg != null && refaction >= Number(cur.net_delivered_kg)) throw new UnprocessableEntityException('La réfaction dépasse le poids net livré');
    const payable = cur.net_delivered_kg == null ? null : Math.round((Number(cur.net_delivered_kg) - refaction) * 1000) / 1000;
    return this.mutate(req, id, ['weighed'],
      `UPDATE deliveries SET status = 'analysed', moisture_pct = $2, bean_count = $3, defects = $4::jsonb, grade = $5, decision = $6, analysis_notes = $7, analysed_by = $8, analysed_at = now(),
              refaction_kg = $9, net_payable_kg = $10, issuer = $11::jsonb, bulletin_no = 'BP-' || substr(number, 4) WHERE id = $1 RETURNING *`,
      [b.moisture_pct, b.bean_count ?? null, JSON.stringify(b.defects ?? {}), b.grade || null, b.decision, b.notes?.trim() || null, req.user.id, refaction, payable, JSON.stringify(issuer)], 'delivery.analysis',
      (d) => ({ title: `Livraison ${d.source_sheet_no} : ${d.decision === 'accepted' ? 'acceptée' : 'rejetée'}`, body: `Bulletin ${d.bulletin_no} · humidité ${Number(d.moisture_pct)} %${d.analysis_notes ? ` · ${d.analysis_notes}` : ''}` }));
  }

  @Post('deliveries/:id/settle') @RequirePermissions('deliveries:settle')
  async settle(@Param('id', ParseUUIDPipe) id: string, @Body() b: SettleDto, @Req() req: any) {
    const cur = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT net_kg, net_payable_kg, decision FROM deliveries WHERE id = $1 AND organization_id = $2`, [id, req.org.id])).rows[0]);
    if (!cur) throw new NotFoundException();
    if (cur.decision !== 'accepted') throw new UnprocessableEntityException('Seule une livraison acceptée se règle');
    const amount = Math.round(Number(cur.net_payable_kg ?? cur.net_kg) * b.unit_price * 100) / 100;   // poids net payé × prix
    return this.mutate(req, id, ['analysed'],
      `UPDATE deliveries SET status = 'settled', unit_price = $2, amount = $3, settled_by = $4, settled_at = now(), payment_ref = $5 WHERE id = $1 RETURNING *`,
      [b.unit_price, amount, req.user.id, b.payment_ref || null], 'delivery.settle',
      (d) => ({ title: `Livraison ${d.source_sheet_no} réglée`, body: `${Number(d.net_payable_kg ?? d.net_kg)} kg × ${Number(d.unit_price)} = ${Number(d.amount)}` }));
  }

  /** Données du bulletin de pesée (impression côté portail). Visible du destinataire et du fournisseur. */
  @Get('deliveries/:id/bulletin')
  async bulletin(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.need(req, 'deliveries:read', 'dispatch:manage');
    return this.db.tx(req.org.id, async (c) => {
      const d = (await c.query(
        `SELECT d.*, o.name AS destination_name, w.full_name AS weigher_name, a.full_name AS analyst_name
           FROM deliveries d JOIN organizations o ON o.id = d.organization_id
           LEFT JOIN users w ON w.id = d.tare_by LEFT JOIN users a ON a.id = d.analysed_by WHERE d.id = $1`, [id])).rows[0];
      if (!d) throw new NotFoundException();
      if (!d.bulletin_no) throw new ConflictException('Le bulletin n\'existe qu\'après l\'analyse');
      const { lines, ...rest } = d;
      return { ...rest, producers: Array.isArray(lines) ? lines.length : 0 };
    });
  }
}

/** Numéro de livraison par destinataire et par année (DL-aaaa-nnnnn). */
export async function nextDeliveryNumber(c: PoolClient, orgId: string) {
  const yr = new Date().getFullYear();
  const n = (await c.query(`INSERT INTO delivery_counters(organization_id, year, last_no) VALUES ($1,$2,1) ON CONFLICT (organization_id, year) DO UPDATE SET last_no = delivery_counters.last_no + 1 RETURNING last_no`, [orgId, yr])).rows[0].last_no;
  return `DL-${yr}-${String(n).padStart(5, '0')}`;
}
