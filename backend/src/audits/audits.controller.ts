import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

const AREAS = ['tracabilite', 'stock', 'pesee', 'comptabilite', 'caisse', 'social', 'environnement', 'autre'];
const MAX_FILE = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

class SupervisionDto { @Matches(/^[A-Za-z0-9_-]{2,20}$/) code: string; }
class CreateAuditDto {
  @IsUUID() supervised_org_id: string;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsIn(AREAS, { each: true }) scope?: string[];
  @IsOptional() @IsISO8601({ strict: true }) starts_on?: string;
  @IsOptional() @IsISO8601({ strict: true }) ends_on?: string;
}
class ParticipantDto { @IsUUID() user_id: string; }
class FindingDto {
  @IsIn(AREAS) area: string;
  @IsIn(['conform', 'observation', 'minor', 'major', 'critical']) result: string;
  @IsString() @Length(3, 500) requirement: string;
  @IsString() @Length(3, 4000) description: string;
  @IsOptional() @IsString() @Length(0, 2000) evidence?: string;
  @IsOptional() @IsISO8601({ strict: true }) due_on?: string;
}
class RespondDto {
  @IsString() @Length(3, 4000) response: string;
  @IsOptional() @IsString() @Length(0, 4000) action_plan?: string;
  @IsOptional() @IsISO8601({ strict: true }) action_due_on?: string;
}
class VerifyDto { @IsOptional() @IsString() @Length(0, 2000) comment?: string; }
class CloseDto { @IsString() @Length(3, 4000) summary: string; }
class ShareDto {
  @IsIn(['snapshot', 'note']) kind: 'snapshot' | 'note';
  @IsString() @Length(2, 200) title: string;
  @IsOptional() @IsString() view?: string;
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsString() @Length(0, 10000) body?: string;
}

type Col = { key: string; label: string };
interface View { label: string; side: 'supervised' | 'supervisor'; columns: Col[]; sql: string; ranged?: boolean }
/** Extraits que chaque partie peut partager. Ils sont produits dans l'organisation de celui qui partage, puis figés ; aucun nom, téléphone ni adresse de producteur n'y figure (code planteur seulement). */
const VIEWS: Record<string, View> = {
  declarations: { label: 'Achats déclarés (code planteur, quantité, statut)', side: 'supervised', ranged: true,
    columns: [{ key: 'operation_date', label: 'Date' }, { key: 'producer_code', label: 'Code planteur' }, { key: 'quantity', label: 'Quantité' }, { key: 'unit', label: 'Unité' }, { key: 'bags', label: 'Sacs' }, { key: 'status', label: 'Statut' }],
    sql: `SELECT d.operation_date::text AS operation_date, p.internal_code AS producer_code, d.quantity, d.unit, d.bags, d.status FROM purchase_declarations d JOIN producers p ON p.id = d.producer_id
           WHERE d.operation_date BETWEEN $1::date AND $2::date ORDER BY d.operation_date, p.internal_code LIMIT ${MAX_ROWS}` },
  convoys: { label: 'Connaissements pesés au magasin', side: 'supervised', ranged: true,
    columns: [{ key: 'convoy_no', label: 'Connaissement' }, { key: 'received_on', label: 'Reçu le' }, { key: 'declared_kg', label: 'Annoncé (kg)' }, { key: 'total_kg', label: 'Pesé (kg)' }, { key: 'variance_kg', label: 'Écart (kg)' }, { key: 'bags', label: 'Sacs' }, { key: 'status', label: 'Statut' }],
    sql: `SELECT v.convoy_no, r.received_at::date::text AS received_on, v.declared_kg, r.total_kg, r.variance_kg, r.bags, r.status FROM convoys v JOIN convoy_receptions r ON r.convoy_id = v.id
           WHERE r.received_at::date BETWEEN $1::date AND $2::date ORDER BY r.received_at LIMIT ${MAX_ROWS}` },
  stocks: { label: 'Stock par lot et magasin (à la date de fin)', side: 'supervised', ranged: true,
    columns: [{ key: 'lot', label: 'Lot' }, { key: 'warehouse', label: 'Magasin' }, { key: 'stock_kg', label: 'Stock (kg)' }],
    sql: `SELECT l.code AS lot, w.name AS warehouse, sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) AS stock_kg FROM warehouse_movements m
           JOIN lots l ON l.id = m.lot_id JOIN warehouses w ON w.id = m.warehouse_id WHERE m.occurred_at::date <= $2::date GROUP BY l.code, w.name HAVING sum(CASE m.direction WHEN 'in' THEN m.quantity_kg ELSE -m.quantity_kg END) <> 0 ORDER BY l.code LIMIT ${MAX_ROWS}` },
  finances: { label: 'Mouvements financiers (date, sens, montant, motif)', side: 'supervised', ranged: true,
    columns: [{ key: 'on', label: 'Date' }, { key: 'direction', label: 'Sens' }, { key: 'amount', label: 'Montant' }, { key: 'currency', label: 'Devise' }, { key: 'reason', label: 'Motif' }, { key: 'reversal', label: 'Annulation' }],
    sql: `SELECT t.created_at::date::text AS "on", t.direction, t.amount, t.currency, t.reason, (t.reversal_of IS NOT NULL) AS reversal FROM financial_transactions t
           WHERE t.created_at::date BETWEEN $1::date AND $2::date ORDER BY t.created_at LIMIT ${MAX_ROWS}` },
  dispatch_sheets: { label: 'Fiches d\'accompagnement', side: 'supervised', ranged: true,
    columns: [{ key: 'number', label: 'Fiche' }, { key: 'status', label: 'Statut' }, { key: 'declared_kg', label: 'Poids (kg)' }, { key: 'declared_bags', label: 'Sacs' }, { key: 'bl_no', label: 'Connaissement' }, { key: 'transmitted_on', label: 'Transmise le' }, { key: 'exporter_name', label: 'Destinataire' }],
    sql: `SELECT s.number, s.status, s.declared_kg, s.declared_bags, s.bl_no, s.transmitted_at::date::text AS transmitted_on, s.exporter_name FROM dispatch_sheets s
           WHERE s.created_at::date BETWEEN $1::date AND $2::date ORDER BY s.created_at LIMIT ${MAX_ROWS}` },
  deliveries_sent: { label: 'Livraisons envoyées (poids chez l\'exportateur, décision, règlement)', side: 'supervised', ranged: true,
    columns: [{ key: 'number', label: 'Livraison' }, { key: 'source_sheet_no', label: 'Fiche' }, { key: 'on', label: 'Date' }, { key: 'declared_kg', label: 'Déclaré (kg)' }, { key: 'net_delivered_kg', label: 'Net livré (kg)' }, { key: 'net_payable_kg', label: 'Net payé (kg)' }, { key: 'decision', label: 'Décision' }, { key: 'bulletin_no', label: 'Bulletin' }, { key: 'amount', label: 'Montant' }],
    sql: `SELECT d.number, d.source_sheet_no, d.created_at::date::text AS "on", d.declared_kg, d.net_delivered_kg, d.net_payable_kg, d.decision, d.bulletin_no, d.amount FROM deliveries d
           WHERE d.source_org_id = current_setting('app.current_org', true)::uuid AND d.created_at::date BETWEEN $1::date AND $2::date ORDER BY d.created_at LIMIT ${MAX_ROWS}` },
  deliveries_received: { label: 'Livraisons reçues de la coopérative auditée (pesées, analyse, règlement)', side: 'supervisor', ranged: true,
    columns: [{ key: 'number', label: 'Livraison' }, { key: 'source_sheet_no', label: 'Fiche' }, { key: 'on', label: 'Date' }, { key: 'declared_kg', label: 'Déclaré (kg)' }, { key: 'gross_kg', label: 'Entrée (kg)' }, { key: 'tare_kg', label: 'Sortie (kg)' }, { key: 'net_delivered_kg', label: 'Net livré (kg)' }, { key: 'net_payable_kg', label: 'Net payé (kg)' }, { key: 'variance_kg', label: 'Écart (kg)' }, { key: 'moisture_pct', label: 'Humidité %' }, { key: 'grade', label: 'Classement' }, { key: 'decision', label: 'Décision' }, { key: 'bulletin_no', label: 'Bulletin' }, { key: 'amount', label: 'Montant' }],
    sql: `SELECT d.number, d.source_sheet_no, d.created_at::date::text AS "on", d.declared_kg, d.gross_kg, d.tare_kg, d.net_delivered_kg, d.net_payable_kg, d.variance_kg, d.moisture_pct, d.grade, d.decision, d.bulletin_no, d.amount FROM deliveries d
           WHERE d.organization_id = current_setting('app.current_org', true)::uuid AND d.source_org_id = $3::uuid AND d.created_at::date BETWEEN $1::date AND $2::date ORDER BY d.created_at LIMIT ${MAX_ROWS}` },
};

/** Supervision et audit : l'exportateur audite les coopératives qui ont accepté sa supervision ; chaque partie partage ses extraits dans l'espace de l'audit, visibles des seuls participants. */
@ApiTags('audits')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class AuditsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private has(req: any, p: string) { return req.org.permissions.has(p); }
  private need(req: any, ...p: string[]) { if (!p.some((x) => this.has(req, x))) throw new ForbiddenException('Permission insuffisante'); }
  private log(orgId: string, req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: orgId, actorUserId: req.user.id, action, entityType: 'audit', entityId: id, details });
  }

  private async getAudit(c: PoolClient, id: string) {
    const a = (await c.query(`SELECT * FROM audits WHERE id = $1`, [id])).rows[0];
    if (!a) throw new NotFoundException('Audit introuvable');
    return a;
  }
  private side(a: any, req: any): 'supervisor' | 'supervised' {
    return a.supervisor_org_id === req.org.id ? 'supervisor' : 'supervised';
  }
  private async isParticipant(c: PoolClient, auditId: string, userId: string) {
    return (await c.query(`SELECT 1 FROM audit_participants WHERE audit_id = $1 AND user_id = $2`, [auditId, userId])).rowCount! > 0;
  }
  private async needParticipant(c: PoolClient, a: any, req: any) {
    if (!(await this.isParticipant(c, a.id, req.user.id))) throw new ForbiddenException('Vous n\'êtes pas participant de cet audit');
  }
  private async notifyOrg(orgId: string, perms: string[], payload: { title: string; body: string; id: string; dedupe: string }) {
    await this.db.tx(orgId, async (c) => {
      const ids = (await c.query(`SELECT DISTINCT uo.user_id FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code = ANY($2::text[])`, [orgId, perms])).rows.map((r) => r.user_id);
      if (ids.length) await this.notif.notifyUsers(c, orgId, ids, { kind: 'audit', severity: 'info', title: payload.title, body: payload.body, entityType: 'audit', entityId: payload.id, dedupe: payload.dedupe });
    }).catch(() => undefined);
  }

  // ── Supervision (lien hiérarchique accepté par la coopérative)
  @Get('supervisions')
  async supervisions(@Req() req: any) {
    this.need(req, 'links:manage', 'audits:read', 'audits:manage');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.id, s.status, s.created_at, s.accepted_at, (s.supervisor_org_id = $1) AS i_supervise,
              o.id AS other_id, o.name AS other_name, o.code AS other_code, o.kind AS other_kind
         FROM org_supervisions s JOIN organizations o ON o.id = CASE WHEN s.supervisor_org_id = $1 THEN s.supervised_org_id ELSE s.supervisor_org_id END
        WHERE s.status <> 'revoked' ORDER BY o.name`, [req.org.id])).rows);
  }

  @Post('supervisions') @RequirePermissions('links:manage')
  async proposeSupervision(@Body() b: SupervisionDto, @Req() req: any) {
    const me = (await this.db.query<any>(`SELECT kind FROM organizations WHERE id = $1`, [req.org.id]))[0];
    if (me?.kind !== 'exporter') throw new ForbiddenException('Seul un exportateur peut proposer de superviser une coopérative');
    const [other] = await this.db.query<any>(`SELECT id, name, kind, status FROM organizations WHERE code = $1`, [b.code.toUpperCase()]);
    if (!other || other.status !== 'active') throw new NotFoundException('Aucune organisation active avec ce code');
    if (other.kind !== 'cooperative') throw new BadRequestException('On ne supervise qu\'une coopérative');
    const row = await this.db.tx(req.org.id, async (c) => {
      const ex = (await c.query(`SELECT id, status FROM org_supervisions WHERE supervisor_org_id = $1 AND supervised_org_id = $2`, [req.org.id, other.id])).rows[0];
      if (ex && ex.status !== 'revoked') throw new ConflictException('Une supervision existe déjà avec cette coopérative');
      if (ex) await c.query(`DELETE FROM org_supervisions WHERE id = $1`, [ex.id]);
      return (await c.query(`INSERT INTO org_supervisions(supervisor_org_id, supervised_org_id, requested_by) VALUES ($1,$2,$3) RETURNING id, status`, [req.org.id, other.id, req.user.id])).rows[0];
    });
    await this.log(req.org.id, req, 'supervision.propose', row.id, { with: other.name });
    await this.notifyOrg(other.id, ['links:manage'], { title: 'Demande de supervision', body: 'Un exportateur demande à superviser et auditer votre coopérative. Acceptez-la dans « Organisations liées ».', id: row.id, dedupe: `supervision:${row.id}` });
    return row;
  }

  @Post('supervisions/:id/accept') @RequirePermissions('links:manage')
  async acceptSupervision(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`SELECT * FROM org_supervisions WHERE id = $1`, [id])).rows[0];
      if (!s) throw new NotFoundException();
      if (s.status !== 'pending') throw new ConflictException('Cette supervision n\'est pas en attente');
      if (s.supervised_org_id !== req.org.id) throw new ForbiddenException('Seule la coopérative supervisée peut accepter');
      return (await c.query(`UPDATE org_supervisions SET status = 'active', accepted_by = $2, accepted_at = now() WHERE id = $1 RETURNING id, status, supervisor_org_id`, [id, req.user.id])).rows[0];
    });
    await this.log(req.org.id, req, 'supervision.accept', id);
    await this.log(r.supervisor_org_id, req, 'supervision.accepted_by_supervised', id);
    return { id: r.id, status: r.status };
  }

  @Post('supervisions/:id/revoke') @RequirePermissions('links:manage')
  async revokeSupervision(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      if ((await c.query(`SELECT 1 FROM audits a JOIN org_supervisions s ON s.supervisor_org_id = a.supervisor_org_id AND s.supervised_org_id = a.supervised_org_id WHERE s.id = $1 AND a.status IN ('in_progress','findings_issued')`, [id])).rowCount)
        throw new ConflictException('Un audit est en cours avec cette coopérative : clôturez-le d\'abord');
      const x = await c.query(`UPDATE org_supervisions SET status = 'revoked' WHERE id = $1 AND status <> 'revoked' RETURNING id, status`, [id]);
      if (!x.rowCount) throw new NotFoundException();
      return x.rows[0];
    });
    await this.log(req.org.id, req, 'supervision.revoke', id);
    return r;
  }

  // ── Audits
  @Get('audits')
  async list(@Req() req: any) {
    this.need(req, 'audits:read', 'audits:manage');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT a.id, a.number, a.title, a.scope, a.starts_on, a.ends_on, a.status, a.created_at, (a.supervisor_org_id = $1) AS i_supervise,
              so.name AS supervisor_name, vo.name AS supervised_name,
              EXISTS (SELECT 1 FROM audit_participants p WHERE p.audit_id = a.id AND p.user_id = $2) AS participant,
              (SELECT count(*)::int FROM audit_findings f WHERE f.audit_id = a.id AND (a.supervisor_org_id = $1 OR a.status IN ('findings_issued','closed'))) AS findings,
              (SELECT count(*)::int FROM audit_findings f WHERE f.audit_id = a.id AND f.status = 'open' AND f.result <> 'conform' AND (a.supervisor_org_id = $1 OR a.status IN ('findings_issued','closed'))) AS open_findings
         FROM audits a JOIN organizations so ON so.id = a.supervisor_org_id JOIN organizations vo ON vo.id = a.supervised_org_id ORDER BY a.created_at DESC LIMIT 300`, [req.org.id, req.user.id])).rows);
  }

  @Post('audits') @RequirePermissions('audits:manage')
  async create(@Body() b: CreateAuditDto, @Req() req: any) {
    const me = (await this.db.query<any>(`SELECT kind FROM organizations WHERE id = $1`, [req.org.id]))[0];
    if (me?.kind !== 'exporter') throw new ForbiddenException('Seul l\'exportateur programme un audit');
    if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) throw new BadRequestException('La date de fin précède la date de début');
    const a = await this.db.tx(req.org.id, async (c) => {
      const sup = (await c.query(`SELECT 1 FROM org_supervisions WHERE supervisor_org_id = $1 AND supervised_org_id = $2 AND status = 'active'`, [req.org.id, b.supervised_org_id])).rowCount;
      if (!sup) throw new BadRequestException('Aucune supervision active avec cette coopérative : elle doit d\'abord accepter votre demande');
      const yr = new Date().getFullYear();
      const n = (await c.query(`INSERT INTO audit_counters(organization_id, year, last_no) VALUES ($1,$2,1) ON CONFLICT (organization_id, year) DO UPDATE SET last_no = audit_counters.last_no + 1 RETURNING last_no`, [req.org.id, yr])).rows[0].last_no;
      const row = (await c.query(
        `INSERT INTO audits(supervisor_org_id, supervised_org_id, number, title, scope, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.org.id, b.supervised_org_id, `AU-${yr}-${String(n).padStart(4, '0')}`, b.title.trim(), b.scope ?? [], b.starts_on ?? null, b.ends_on ?? null, req.user.id])).rows[0];
      await c.query(`INSERT INTO audit_participants(audit_id, organization_id, user_id, added_by) VALUES ($1,$2,$3,$3)`, [row.id, req.org.id, req.user.id]);
      return row;
    });
    await this.log(req.org.id, req, 'audit.create', a.id, { number: a.number });
    await this.log(a.supervised_org_id, req, 'audit.announced', a.id, { number: a.number, title: a.title });
    await this.notifyOrg(a.supervised_org_id, ['audits:respond', 'audits:read'], { title: `Audit ${a.number} programmé`, body: `${a.title}${a.starts_on ? ` · du ${a.starts_on}` : ''}. Désignez vos participants et préparez les données à partager.`, id: a.id, dedupe: `audit:${a.id}:new` });
    return a;
  }

  @Get('audits/catalog')
  async catalog(@Req() req: any) {
    this.need(req, 'audits:share', 'audits:manage');
    const kind = (await this.db.query<any>(`SELECT kind FROM organizations WHERE id = $1`, [req.org.id]))[0]?.kind;
    const side = kind === 'exporter' ? 'supervisor' : 'supervised';
    return Object.entries(VIEWS).filter(([, v]) => v.side === side).map(([key, v]) => ({ key, label: v.label, columns: v.columns }));
  }

  @Get('audits/:id')
  async one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.need(req, 'audits:read', 'audits:manage');
    return this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      const side = this.side(a, req);
      const participant = await this.isParticipant(c, id, req.user.id);
      const orgs = (await c.query(`SELECT id, name FROM organizations WHERE id = ANY($1::uuid[])`, [[a.supervisor_org_id, a.supervised_org_id]])).rows;
      const nm = (oid: string) => orgs.find((o) => o.id === oid)?.name ?? '';
      const parts = (await c.query(`SELECT p.user_id, p.organization_id, u.full_name, p.added_at FROM audit_participants p JOIN users u ON u.id = p.user_id WHERE p.audit_id = $1 ORDER BY p.added_at`, [id])).rows;
      const findings = (await c.query(`SELECT * FROM audit_findings WHERE audit_id = $1 ORDER BY no`, [id])).rows;
      const shares = participant ? (await c.query(
        `SELECT s.id, s.kind, s.title, s.view_key, s.params, s.shared_by_org, s.shared_by_user, u.full_name AS shared_by_name, s.created_at, s.withdrawn_at, s.file_name,
                CASE WHEN s.payload IS NULL THEN NULL ELSE jsonb_array_length(coalesce(s.payload->'rows', '[]'::jsonb)) END AS row_count
           FROM audit_shares s JOIN users u ON u.id = s.shared_by_user WHERE s.audit_id = $1 ORDER BY s.created_at DESC`, [id])).rows : [];
      return { ...a, side, participant, supervisor_name: nm(a.supervisor_org_id), supervised_name: nm(a.supervised_org_id),
        participants: parts.map((p) => ({ ...p, side: p.organization_id === a.supervisor_org_id ? 'supervisor' : 'supervised' })),
        findings, shares: shares.map((s) => ({ ...s, mine: s.shared_by_org === req.org.id })) };
    });
  }

  @Post('audits/:id/participants') @RequirePermissions('audits:manage', 'audits:respond')
  async addParticipant(@Param('id', ParseUUIDPipe) id: string, @Body() b: ParticipantDto, @Req() req: any) {
    const supervisorSide = this.has(req, 'audits:manage');
    return this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      if (this.side(a, req) === 'supervisor' && !this.has(req, 'audits:manage')) throw new ForbiddenException('Permission insuffisante');
      if (this.side(a, req) === 'supervised' && !this.has(req, 'audits:respond')) throw new ForbiddenException('Permission insuffisante');
      void supervisorSide;
      const ok = (await c.query(`SELECT 1 FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.status = 'active' AND rp.permission_code IN ('audits:read','audits:manage')`, [b.user_id, req.org.id])).rowCount;
      if (!ok) throw new BadRequestException('Cette personne n\'appartient pas à votre organisation ou n\'a pas le droit « audit »');
      await c.query(`INSERT INTO audit_participants(audit_id, organization_id, user_id, added_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, req.org.id, b.user_id, req.user.id]);
      await this.log(req.org.id, req, 'audit.participant_add', id, { user_id: b.user_id });
      return { ok: true };
    });
  }

  @Post('audits/:id/participants/:userId/remove') @RequirePermissions('audits:manage', 'audits:respond')
  async removeParticipant(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      if (a.status === 'closed' || a.status === 'cancelled') throw new ConflictException('Cet audit est clos');
      const r = await c.query(`DELETE FROM audit_participants WHERE audit_id = $1 AND user_id = $2 AND organization_id = $3 AND user_id <> $4`, [id, userId, req.org.id, a.created_by]);
      if (!r.rowCount) throw new NotFoundException('Participant introuvable (le créateur de l\'audit ne se retire pas)');
      await this.log(req.org.id, req, 'audit.participant_remove', id, { user_id: userId });
      return { ok: true };
    });
  }

  @Get('audits/:id/candidates') @RequirePermissions('audits:manage', 'audits:respond')
  candidates(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM user_organizations uo JOIN users u ON u.id = uo.user_id JOIN role_permissions rp ON rp.role_id = uo.role_id
        WHERE uo.organization_id = $1 AND uo.status = 'active' AND rp.permission_code IN ('audits:read','audits:manage')
          AND NOT EXISTS (SELECT 1 FROM audit_participants p WHERE p.audit_id = $2 AND p.user_id = u.id) ORDER BY u.full_name`, [req.org.id, id])).rows);
  }

  private async transition(req: any, id: string, from: string[], set: string, params: any[], action: string, after?: (a: any) => Promise<void>, guard?: (c: PoolClient, a: any) => Promise<void>) {
    const a = await this.db.tx(req.org.id, async (c) => {
      const cur = await this.getAudit(c, id);
      if (cur.supervisor_org_id !== req.org.id) throw new ForbiddenException('Seul l\'exportateur peut faire cette opération');
      if (!from.includes(cur.status)) throw new ConflictException(`Opération impossible : l'audit est « ${cur.status} »`);
      await this.needParticipant(c, cur, req);
      if (guard) await guard(c, cur);
      return (await c.query(`UPDATE audits SET ${set} WHERE id = $1 RETURNING *`, [id, ...params])).rows[0];
    });
    await this.log(req.org.id, req, action, id, { number: a.number });
    if (after) await after(a).catch(() => undefined);
    return a;
  }

  @Post('audits/:id/start') @RequirePermissions('audits:manage')
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.transition(req, id, ['planned'], `status = 'in_progress', started_at = now()`, [], 'audit.start',
      (a) => this.notifyOrg(a.supervised_org_id, ['audits:respond', 'audits:read'], { title: `Audit ${a.number} commencé`, body: 'Partagez les données demandées dans l\'espace de l\'audit.', id: a.id, dedupe: `audit:${a.id}:start` }));
  }
  @Post('audits/:id/issue') @RequirePermissions('audits:manage')
  issue(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.transition(req, id, ['in_progress'], `status = 'findings_issued', issued_at = now()`, [], 'audit.issue',
      (a) => this.notifyOrg(a.supervised_org_id, ['audits:respond', 'audits:read'], { title: `Rapport d'audit ${a.number} émis`, body: 'Consultez les constats et répondez à chacun avec votre plan d\'action.', id: a.id, dedupe: `audit:${a.id}:issue` }));
  }
  @Post('audits/:id/close') @RequirePermissions('audits:manage')
  close(@Param('id', ParseUUIDPipe) id: string, @Body() b: CloseDto, @Req() req: any) {
    return this.transition(req, id, ['findings_issued'], `status = 'closed', closed_at = now(), closed_by = $2, summary = $3`, [req.user.id, b.summary.trim()], 'audit.close',
      (a) => this.notifyOrg(a.supervised_org_id, ['audits:respond', 'audits:read'], { title: `Audit ${a.number} clos`, body: b.summary.slice(0, 200), id: a.id, dedupe: `audit:${a.id}:close` }));
  }
  @Post('audits/:id/cancel') @RequirePermissions('audits:manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.transition(req, id, ['planned', 'in_progress'], `status = 'cancelled', closed_at = now(), closed_by = $2`, [req.user.id], 'audit.cancel');
  }

  // ── Constats
  @Post('audits/:id/findings') @RequirePermissions('audits:manage')
  async addFinding(@Param('id', ParseUUIDPipe) id: string, @Body() b: FindingDto, @Req() req: any) {
    const f = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      if (a.supervisor_org_id !== req.org.id) throw new ForbiddenException();
      await this.needParticipant(c, a, req);
      const no = ((await c.query(`SELECT coalesce(max(no), 0) + 1 AS n FROM audit_findings WHERE audit_id = $1`, [id])).rows[0].n) as number;
      return (await c.query(`INSERT INTO audit_findings(audit_id, supervisor_org_id, supervised_org_id, no, area, result, requirement, description, evidence, due_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id, a.supervisor_org_id, a.supervised_org_id, no, b.area, b.result, b.requirement.trim(), b.description.trim(), b.evidence?.trim() || null, b.due_on ?? null, req.user.id])).rows[0];
    });
    await this.log(req.org.id, req, 'audit.finding', id, { no: f.no, result: f.result });
    return f;
  }

  @Post('audits/:id/findings/:fid/respond') @RequirePermissions('audits:respond')
  async respond(@Param('id', ParseUUIDPipe) id: string, @Param('fid', ParseUUIDPipe) fid: string, @Body() b: RespondDto, @Req() req: any) {
    const f = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      if (a.supervised_org_id !== req.org.id) throw new ForbiddenException('Seule la coopérative auditée répond');
      if (a.status !== 'findings_issued') throw new ConflictException('Le rapport n\'est pas (ou plus) ouvert aux réponses');
      await this.needParticipant(c, a, req);
      const cur = (await c.query(`SELECT result, status FROM audit_findings WHERE id = $1 AND audit_id = $2`, [fid, id])).rows[0];
      if (!cur) throw new NotFoundException();
      if (cur.result === 'conform') throw new BadRequestException('Un constat conforme n\'appelle pas de réponse');
      if (cur.status !== 'open') throw new ConflictException('Ce constat a déjà reçu une réponse');
      return (await c.query(`UPDATE audit_findings SET status = 'responded', response = $2, action_plan = $3, action_due_on = $4, responded_by = $5, responded_at = now() WHERE id = $1 RETURNING *`,
        [fid, b.response.trim(), b.action_plan?.trim() || null, b.action_due_on ?? null, req.user.id])).rows[0];
    });
    await this.log(req.org.id, req, 'audit.respond', id, { no: f.no });
    await this.notifyOrg(f.supervisor_org_id, ['audits:manage'], { title: `Réponse au constat n° ${f.no}`, body: f.response.slice(0, 160), id, dedupe: `audit:${id}:resp:${f.id}` });
    return f;
  }

  @Post('audits/:id/findings/:fid/verify') @RequirePermissions('audits:manage')
  async verify(@Param('id', ParseUUIDPipe) id: string, @Param('fid', ParseUUIDPipe) fid: string, @Body() b: VerifyDto, @Req() req: any) {
    const f = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      if (a.supervisor_org_id !== req.org.id) throw new ForbiddenException();
      if (a.status !== 'findings_issued') throw new ConflictException('Le rapport n\'est pas ouvert');
      await this.needParticipant(c, a, req);
      const x = await c.query(`UPDATE audit_findings SET status = 'verified', verified_by = $2, verified_at = now(), verification_comment = $3 WHERE id = $1 AND audit_id = $4 AND status = 'responded' RETURNING *`, [fid, req.user.id, b.comment?.trim() || null, id]);
      if (!x.rowCount) throw new ConflictException('Le constat attend encore une réponse');
      return x.rows[0];
    });
    await this.log(req.org.id, req, 'audit.verify', id, { no: f.no });
    return f;
  }

  // ── Espace de partage de l'audit
  @Post('audits/:id/shares') @RequirePermissions('audits:share')
  async share(@Param('id', ParseUUIDPipe) id: string, @Body() b: ShareDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      await this.needParticipant(c, a, req);
      const side = this.side(a, req);
      let payload: any = null, view: string | null = null, params: any = null;
      if (b.kind === 'note') {
        if (!b.body?.trim()) throw new BadRequestException('Saisissez le texte de la note');
        payload = { text: b.body.trim() };
      } else {
        const v = b.view ? VIEWS[b.view] : undefined;
        if (!v || v.side !== side) throw new BadRequestException('Extrait inconnu pour votre côté de l\'audit');
        const from = b.from ?? a.starts_on ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        const to = b.to ?? a.ends_on ?? new Date().toISOString().slice(0, 10);
        if (to < from) throw new BadRequestException('Période invalide');
        const args: any[] = [from, to]; if (v.sql.includes('$3')) args.push(a.supervised_org_id);
        const rows = (await c.query(v.sql, args)).rows;
        payload = { columns: v.columns, rows, generated_at: new Date().toISOString(), from, to, truncated: rows.length >= MAX_ROWS };
        view = b.view!; params = { from, to };
      }
      const s = (await c.query(
        `INSERT INTO audit_shares(audit_id, shared_by_org, shared_by_user, kind, title, view_key, params, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, title, view_key, created_at`,
        [id, req.org.id, req.user.id, b.kind, b.title.trim(), view, params, payload])).rows[0];
      return { share: s, audit: a, rows: payload?.rows?.length ?? 0 };
    });
    await this.log(req.org.id, req, 'audit.share', id, { share: out.share.id, kind: out.share.kind, title: out.share.title, rows: out.rows });
    return { ...out.share, row_count: out.rows };
  }

  @Post('audits/:id/shares/document') @RequirePermissions('audits:share')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE, files: 1 } }))
  async shareDocument(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body('title') title: string, @Req() req: any) {
    if (!file?.buffer?.length) throw new BadRequestException('Aucun fichier reçu');
    const name = (file.originalname || 'document').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const s = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      await this.needParticipant(c, a, req);
      return (await c.query(
        `INSERT INTO audit_shares(audit_id, shared_by_org, shared_by_user, kind, title, file_name, file_mime, file_sha256, file_bytes) VALUES ($1,$2,$3,'document',$4,$5,$6,$7,$8) RETURNING id, kind, title, file_name, created_at`,
        [id, req.org.id, req.user.id, (title || name).trim().slice(0, 200), name, file.mimetype || 'application/octet-stream', sha, file.buffer])).rows[0];
    });
    await this.log(req.org.id, req, 'audit.share', id, { share: s.id, kind: 'document', title: s.title, sha256: sha });
    return s;
  }

  /** Lecture d'un partage : réservée aux participants ; chaque lecture est journalisée chez celui qui a partagé. */
  @Get('audits/:id/shares/:sid')
  async readShare(@Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Req() req: any) {
    this.need(req, 'audits:read', 'audits:manage');
    const s = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      await this.needParticipant(c, a, req);
      const x = (await c.query(`SELECT id, audit_id, kind, title, view_key, params, payload, file_name, file_sha256, shared_by_org, withdrawn_at, created_at FROM audit_shares WHERE id = $1 AND audit_id = $2`, [sid, id])).rows[0];
      if (!x) throw new NotFoundException();
      return x;
    });
    if (s.shared_by_org !== req.org.id) await this.audit.log({ organizationId: s.shared_by_org, actorUserId: req.user.id, action: 'audit.share_read', entityType: 'audit_share', entityId: sid, details: { audit_id: id, title: s.title, reader_org: req.org.id } });
    return s;
  }

  @Get('audits/:id/shares/:sid/file')
  async readFile(@Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Req() req: any) {
    this.need(req, 'audits:read', 'audits:manage');
    const s = await this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      await this.needParticipant(c, a, req);
      const x = (await c.query(`SELECT shared_by_org, title, file_name, file_mime, file_bytes, withdrawn_at FROM audit_shares WHERE id = $1 AND audit_id = $2 AND kind = 'document'`, [sid, id])).rows[0];
      if (!x || !x.file_bytes) throw new NotFoundException('Document introuvable ou retiré');
      return x;
    });
    if (s.shared_by_org !== req.org.id) await this.audit.log({ organizationId: s.shared_by_org, actorUserId: req.user.id, action: 'audit.share_read', entityType: 'audit_share', entityId: sid, details: { audit_id: id, title: s.title, reader_org: req.org.id } });
    return new StreamableFile(s.file_bytes, { type: s.file_mime, disposition: `attachment; filename="${encodeURIComponent(s.file_name)}"` });
  }

  @Post('audits/:id/shares/:sid/withdraw') @RequirePermissions('audits:share')
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const x = await c.query(`UPDATE audit_shares SET withdrawn_at = now(), withdrawn_by = $3 WHERE id = $1 AND audit_id = $2 AND shared_by_org = $4 AND withdrawn_at IS NULL RETURNING id`, [sid, id, req.user.id, req.org.id]);
      if (!x.rowCount) throw new NotFoundException('Partage introuvable, déjà retiré, ou partagé par l\'autre partie');
    });
    await this.log(req.org.id, req, 'audit.share_withdraw', id, { share: sid });
    return { ok: true };
  }

  /** Qui a consulté ce que NOUS avons partagé (journal chez celui qui a partagé). */
  @Get('audits/:id/access-log')
  async accessLog(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.need(req, 'audits:read', 'audits:manage');
    return this.db.tx(req.org.id, async (c) => {
      const a = await this.getAudit(c, id);
      await this.needParticipant(c, a, req);
      return (await c.query(
        `SELECT l.created_at, u.full_name AS reader, o.name AS reader_org, l.details->>'title' AS title
           FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id LEFT JOIN organizations o ON o.id = (l.details->>'reader_org')::uuid
          WHERE l.organization_id = $1 AND l.action = 'audit.share_read' AND l.details->>'audit_id' = $2 ORDER BY l.created_at DESC LIMIT 500`, [req.org.id, id])).rows;
    });
  }
}
