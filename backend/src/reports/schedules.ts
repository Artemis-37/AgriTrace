import { BadRequestException, Body, Controller, Delete, Get, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Param, ParseUUIDPipe, Post, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { createTransport } from 'nodemailer';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsController } from './reports.controller';

const REPORTS = ['purchases', 'finance', 'stock', 'quality'] as const;
type Kind = (typeof REPORTS)[number];
const LABEL: Record<Kind, string> = { purchases: 'Achats', finance: 'Finances', stock: 'Stocks', quality: 'Qualité' };
const FREQ: Record<string, string> = { daily: 'quotidien', weekly: 'hebdomadaire', monthly: 'mensuel' };

class ScheduleDto {
  @IsIn(REPORTS as unknown as string[]) report: Kind;
  @IsIn(['daily', 'weekly', 'monthly']) frequency: 'daily' | 'weekly' | 'monthly';
  @IsOptional() @IsInt() @Min(1) @Max(7) weekday?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) month_day?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) hour?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('all', { each: true }) recipients: string[];
  @IsOptional() @IsBoolean() send_email?: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Période couverte : la veille (quotidien), les 7 derniers jours (hebdomadaire), le mois civil précédent (mensuel). Dates en UTC. */
export function periodFor(freq: string, now: Date): { from: string; to: string } {
  const day = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
  if (freq === 'daily') return { from: iso(day(-1)), to: iso(day(-1)) };
  if (freq === 'weekly') return { from: iso(day(-7)), to: iso(day(-1)) };
  return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))), to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))) };
}
export const isDue = (s: { frequency: string; weekday?: number | null; month_day?: number | null; hour: number; last_run_on?: string | null }, now: Date) => {
  if (s.last_run_on && String(s.last_run_on).slice(0, 10) === iso(now)) return false;
  if (now.getUTCHours() < s.hour) return false;
  if (s.frequency === 'weekly') return (now.getUTCDay() || 7) === s.weekday;
  if (s.frequency === 'monthly') return now.getUTCDate() === s.month_day;
  return true;
};

@Injectable()
export class ReportScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ReportScheduler');
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: DbService, private readonly reports: ReportsController, private readonly notif: NotificationsService) {}

  emailConfigured() { return !!process.env.SMTP_URL; }

  /** Génère le rapport d'une programmation, le conserve, prévient les destinataires (et leur écrit si l'envoi par e-mail est configuré). */
  async run(orgId: string, scheduleId: string, now = new Date()) {
    const s = await this.db.tx(orgId, async (c) => (await c.query(`SELECT * FROM report_schedules WHERE id = $1`, [scheduleId])).rows[0]);
    if (!s) throw new NotFoundException('Programmation introuvable');
    const per = periodFor(s.frequency, now);
    const file = await this.reports.buildXlsx(s.report, orgId, { from: per.from, to: per.to });
    // Seuls les membres actifs qui ont encore le droit de lire les rapports reçoivent le fichier.
    const recips = await this.db.tx(orgId, async (c) => (await c.query(
      `SELECT DISTINCT u.id, u.email FROM users u JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = $1 AND uo.status = 'active'
         JOIN role_permissions rp ON rp.role_id = uo.role_id AND rp.permission_code = 'reports:read' WHERE u.id = ANY($2::uuid[]) AND u.status = 'active'`, [orgId, s.recipients])).rows);
    let emailed = 0;
    if (s.send_email && this.emailConfigured() && recips.length) {
      try {
        const tr = createTransport(process.env.SMTP_URL!);
        await tr.sendMail({ from: process.env.SMTP_FROM ?? 'AgriTrace <no-reply@agritrace.local>', to: recips.map((r: any) => r.email).join(', '),
          subject: `Rapport ${LABEL[s.report as Kind]} (${per.from} → ${per.to})`, text: `Veuillez trouver ci-joint le rapport ${FREQ[s.frequency]} « ${LABEL[s.report as Kind]} » pour la période du ${per.from} au ${per.to}.`,
          attachments: [{ filename: file.filename, content: file.buffer }] });
        emailed = recips.length;
      } catch (e: any) { this.logger.warn(`e-mail du rapport ${scheduleId} : ${e.message}`); }
    }
    return this.db.tx(orgId, async (c) => {
      const run = (await c.query(
        `INSERT INTO report_runs(organization_id, schedule_id, report, filename, period_from, period_to, xlsx, emailed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, report, filename, period_from, period_to, emailed, created_at`,
        [orgId, scheduleId, s.report, file.filename, per.from, per.to, file.buffer, emailed])).rows[0];
      await this.notif.notifyUsers(c, orgId, recips.map((r: any) => r.id), { kind: 'report_ready', title: `Rapport ${FREQ[s.frequency]} prêt : ${LABEL[s.report as Kind]}`,
        body: `Période du ${per.from} au ${per.to}`, entityType: 'report_run', entityId: run.id, dedupe: `report_run:${run.id}`, permission: 'reports:read' });
      await c.query(`UPDATE report_schedules SET last_run_on = $2 WHERE id = $1`, [scheduleId, iso(now)]);
      return { ...run, recipients: recips.length };
    });
  }

  async tick(now = new Date()) {
    const orgs = await this.db.query<{ id: string }>(`SELECT id FROM organizations WHERE status = 'active'`);
    for (const o of orgs) {
      const due = await this.db.tx(o.id, async (c) => (await c.query(`SELECT * FROM report_schedules WHERE active`)).rows.filter((s: any) => isDue(s, now)));
      for (const s of due) await this.run(o.id, s.id, now).catch((e) => this.logger.warn(`rapport ${s.id} : ${e.message}`));
    }
  }

  onApplicationBootstrap() {
    const minutes = Number(process.env.REPORT_SCHEDULE_INTERVAL_MIN ?? 15);
    if (!minutes || minutes < 0) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.logger.warn(e.message)), minutes * 60_000);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
}

@ApiTags('rapports')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ReportSchedulesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly sched: ReportScheduler) {}

  @Get('report-schedules')
  @RequirePermissions('reports:schedule')
  async list(@Req() req: any) {
    const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.*, (SELECT coalesce(json_agg(u.full_name ORDER BY u.full_name), '[]') FROM users u WHERE u.id = ANY(s.recipients)) AS recipient_names
         FROM report_schedules s ORDER BY s.created_at DESC`)).rows);
    return { email_configured: this.sched.emailConfigured(), schedules: rows };
  }

  @Post('report-schedules')
  @RequirePermissions('reports:schedule')
  async create(@Body() b: ScheduleDto, @Req() req: any) {
    if (b.frequency === 'weekly' && !b.weekday) throw new BadRequestException('Jour de la semaine requis (1 = lundi … 7 = dimanche)');
    if (b.frequency === 'monthly' && !b.month_day) throw new BadRequestException('Jour du mois requis (1 à 28)');
    const need = b.report === 'finance' ? 'finance:read' : b.report === 'stock' ? 'warehouses:read' : b.report === 'quality' ? 'quality:read' : 'reports:read';
    const row = await this.db.tx(req.org.id, async (c) => {
      const ok = (await c.query(
        `SELECT count(DISTINCT uo.user_id)::int AS n FROM user_organizations uo JOIN role_permissions rp ON rp.role_id = uo.role_id AND rp.permission_code = 'reports:read'
          WHERE uo.organization_id = $1 AND uo.status = 'active' AND uo.user_id = ANY($2::uuid[])
            AND EXISTS (SELECT 1 FROM role_permissions r2 WHERE r2.role_id = uo.role_id AND r2.permission_code = $3)`, [req.org.id, b.recipients, need])).rows[0].n;
      if (ok !== new Set(b.recipients).size) throw new BadRequestException(`Chaque destinataire doit être un membre actif autorisé à lire ce rapport (droits reports:read et ${need})`);
      return (await c.query(
        `INSERT INTO report_schedules(organization_id, report, frequency, weekday, month_day, hour, recipients, send_email, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.org.id, b.report, b.frequency, b.frequency === 'weekly' ? b.weekday : null, b.frequency === 'monthly' ? b.month_day : null, b.hour ?? 6, [...new Set(b.recipients)], !!b.send_email, req.user.id])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'report_schedule.create', entityType: 'report_schedule', entityId: row.id, details: { report: b.report, frequency: b.frequency } });
    return row;
  }

  @Delete('report-schedules/:id')
  @RequirePermissions('reports:schedule')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const n = await this.db.tx(req.org.id, async (c) => (await c.query(`DELETE FROM report_schedules WHERE id = $1`, [id])).rowCount);
    if (!n) throw new NotFoundException('Programmation introuvable');
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'report_schedule.delete', entityType: 'report_schedule', entityId: id });
    return { deleted: true };
  }

  /** Génère tout de suite le rapport (essai ou envoi exceptionnel). */
  @Post('report-schedules/:id/run')
  @RequirePermissions('reports:schedule')
  async runNow(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.sched.run(req.org.id, id);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'report_schedule.run', entityType: 'report_schedule', entityId: id, details: { run_id: r.id } });
    return r;
  }

  /** Rapports générés : un destinataire voit les siens, un responsable des programmations voit tout. */
  @Get('report-runs')
  @RequirePermissions('reports:read')
  list_runs(@Req() req: any) {
    const all = req.org.permissions.has('reports:schedule');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.report, r.filename, r.period_from, r.period_to, r.emailed, r.created_at FROM report_runs r LEFT JOIN report_schedules s ON s.id = r.schedule_id
        WHERE $1::boolean OR $2::uuid = ANY(s.recipients) ORDER BY r.created_at DESC LIMIT 100`, [all, req.user.id])).rows);
  }

  @Get('report-runs/:id/download')
  @RequirePermissions('reports:read')
  async download(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const all = req.org.permissions.has('reports:schedule');
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.filename, r.xlsx FROM report_runs r LEFT JOIN report_schedules s ON s.id = r.schedule_id WHERE r.id = $1 AND ($2::boolean OR $3::uuid = ANY(s.recipients))`, [id, all, req.user.id])).rows[0]);
    if (!r) throw new NotFoundException('Rapport introuvable');
    return new StreamableFile(r.xlsx, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="${r.filename}"` });
  }
}
