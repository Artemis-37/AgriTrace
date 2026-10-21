import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { cleanContent } from './training.controller';
import { AssignTargetDto, createAssignment } from './producer-assignments.controller';

const CROPS = ['cacao', 'cafe'];
const LEVELS = ['base', 'intermediaire', 'avance'];

export class SubmitModuleDto {
  @IsString() @Length(1, 120) theme: string;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(0, 1000) summary?: string;
  @IsOptional() @IsArray() @IsIn(CROPS, { each: true }) crops?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) certifications?: string[];
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsInt() @Min(5) @Max(600) duration_min?: number;
  @IsObject() content: Record<string, unknown>;
}
export class DeclineDto { @IsOptional() @IsString() @Length(0, 500) reason?: string; }
export class SubmitResultDto {
  @IsUUID() module_id: string;
  @IsISO8601({ strict: true }) session_date: string;
  @IsOptional() @IsString() @Length(0, 150) village?: string;
  @IsInt() @Min(0) @Max(5000) participants: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) avg_score?: number;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

/**
 * Circuit « exportateur » : l'exportateur propose un module → l'ADG le transmet aux coachs en un clic → les coachs saisissent leurs résultats
 * → l'ADG les transmet à l'exportateur en un clic. L'ADG ne modifie jamais le contenu (figé par la base) : il transmet, ou décline une proposition.
 */
@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class TrainingExchangeController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }
  private has(req: any, p: string) { return req.org.permissions.has(p); }

  // ── Propositions des exportateurs
  @Post('training-submissions')
  @RequirePermissions('training:propose')
  async submit(@Body() b: SubmitModuleDto, @Req() req: any) {
    const cc = cleanContent(b.content); if (cc.error) throw new BadRequestException(cc.error);
    const row = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(
        `INSERT INTO training_submissions(organization_id, submitted_by, theme, title, summary, crops, certifications, level, duration_min, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.org.id, req.user.id, b.theme.trim(), b.title.trim(), (b.summary ?? '').trim(), b.crops?.length ? [...new Set(b.crops)] : ['cacao'], [...new Set((b.certifications ?? []).map((x) => x.trim()).filter(Boolean))], b.level ?? 'base', b.duration_min ?? 45, JSON.stringify(cc.value)])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'training:forward', { kind: 'training_submitted', title: 'Nouveau module proposé par un exportateur', body: r.title, entityType: 'training_submission', entityId: r.id }, req.user.id);
      return r;
    });
    await this.log(req, 'training_submission.create', 'training_submission', row.id, { title: row.title });
    return row;
  }

  @Get('training-submissions')
  list(@Req() req: any) {
    const all = this.has(req, 'training:forward');
    if (!all && !this.has(req, 'training:propose')) throw new ForbiddenException('Permission insuffisante');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.*, u.full_name AS submitted_by_name, d.full_name AS decided_by_name,
              (SELECT count(*)::int FROM training_results r WHERE r.submission_id = s.id) AS results_count,
              (SELECT count(*)::int FROM training_results r WHERE r.submission_id = s.id AND r.status = 'forwarded') AS results_forwarded
         FROM training_submissions s JOIN users u ON u.id = s.submitted_by LEFT JOIN users d ON d.id = s.decided_by
        WHERE ($1::boolean OR s.submitted_by = $2) ORDER BY s.created_at DESC LIMIT 500`, [all, req.user.id])).rows);
  }

  /** Un clic : le module est copié tel quel dans la bibliothèque des coachs, qui sont prévenus. */
  @Post('training-submissions/:id/forward')
  @RequirePermissions('training:forward')
  async forward(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignTargetDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`UPDATE training_submissions SET status = 'forwarded', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'submitted' RETURNING *`, [id, req.user.id])).rows[0];
      if (!s) {
        const e = (await c.query(`SELECT status FROM training_submissions WHERE id = $1`, [id])).rows[0];
        if (!e) throw new NotFoundException('Proposition introuvable');
        throw new ConflictException('Proposition déjà traitée');
      }
      const m = (await c.query(
        `INSERT INTO training_modules(organization_id, theme, title, summary, crops, certifications, level, duration_min, content, sort, review_state, submission_id, updated_by, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(sort),0)+1 FROM training_modules),'exporter',$10,$11,$11,now()) RETURNING id`,
        [req.org.id, s.theme, s.title, s.summary, s.crops, s.certifications, s.level, s.duration_min, JSON.stringify(s.content), s.id, req.user.id])).rows[0];
      await c.query(`UPDATE training_submissions SET module_id = $2 WHERE id = $1`, [id, m.id]);
      const asg = await createAssignment(c, req.org.id, req.user.id, this.notif, { ...b, title: s.title, module_id: m.id, submission_id: s.id });
      await this.notif.notifyPermission(c, req.org.id, 'training:report', { kind: 'training_module_assigned', title: 'Nouveau module de formation à dispenser', body: s.title, entityType: 'training_module', entityId: m.id }, req.user.id);
      await this.notif.notifyUsers(c, req.org.id, [s.submitted_by], { kind: 'training_submission_forwarded', title: 'Votre module a été transmis aux coachs', body: s.title, entityType: 'training_submission', entityId: id });
      return { id, module_id: m.id, status: 'forwarded', assignment_id: asg.id, targets: asg.targets };
    });
    await this.log(req, 'training_submission.forward', 'training_submission', id, { module_id: out.module_id, kind: b.kind, scope: b.scope, targets: out.targets });
    return out;
  }

  @Post('training-submissions/:id/decline')
  @RequirePermissions('training:forward')
  async decline(@Param('id', ParseUUIDPipe) id: string, @Body() b: DeclineDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`UPDATE training_submissions SET status = 'declined', decided_by = $2, decided_at = now(), decline_reason = $3 WHERE id = $1 AND status = 'submitted' RETURNING id, title, submitted_by`, [id, req.user.id, b.reason?.trim() || null])).rows[0];
      if (!s) {
        const e = (await c.query(`SELECT 1 FROM training_submissions WHERE id = $1`, [id])).rows[0];
        if (!e) throw new NotFoundException('Proposition introuvable');
        throw new ConflictException('Proposition déjà traitée');
      }
      await this.notif.notifyUsers(c, req.org.id, [s.submitted_by], { kind: 'training_submission_declined', severity: 'warning', title: 'Votre module n\'a pas été retenu', body: b.reason?.trim() || s.title, entityType: 'training_submission', entityId: id });
      return { id, status: 'declined' };
    });
    await this.log(req, 'training_submission.decline', 'training_submission', id, { reason: b.reason ?? null });
    return out;
  }

  // ── Résultats des coachs
  @Post('training-results')
  @RequirePermissions('training:report')
  async report(@Body() b: SubmitResultDto, @Req() req: any) {
    if (new Date(b.session_date).getTime() > Date.now() + 86400000) throw new BadRequestException('La date de la séance ne peut pas être dans le futur');
    const row = await this.db.tx(req.org.id, async (c) => {
      const m = (await c.query(`SELECT m.id, m.title, m.submission_id FROM training_modules m JOIN training_submissions s ON s.id = m.submission_id AND s.status = 'forwarded' WHERE m.id = $1`, [b.module_id])).rows[0];
      if (!m) throw new BadRequestException('Les résultats ne se saisissent que pour un module transmis par un exportateur');
      const r = (await c.query(
        `INSERT INTO training_results(organization_id, submission_id, module_id, coach_id, session_date, village, participants, avg_score, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.org.id, m.submission_id, m.id, req.user.id, b.session_date.slice(0, 10), (b.village ?? '').trim(), b.participants, b.avg_score ?? null, (b.notes ?? '').trim()])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'training:forward', { kind: 'training_result_submitted', title: 'Résultats de formation à transmettre', body: m.title, entityType: 'training_result', entityId: r.id }, req.user.id);
      return r;
    });
    await this.log(req, 'training_result.create', 'training_result', row.id, { module_id: row.module_id, participants: row.participants });
    return row;
  }

  /** ADG : tous ; coach : les siens ; exportateur : seulement les résultats transmis de ses propres modules. */
  @Get('training-results')
  list_results(@Req() req: any) {
    const all = this.has(req, 'training:forward');
    const mine = this.has(req, 'training:report');
    const exporter = this.has(req, 'training:propose');
    if (!all && !mine && !exporter) throw new ForbiddenException('Permission insuffisante');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.*, m.title AS module_title, s.title AS submission_title, s.submitted_by, u.full_name AS coach_name, e.full_name AS exporter_name
         FROM training_results r JOIN training_submissions s ON s.id = r.submission_id JOIN users u ON u.id = r.coach_id JOIN users e ON e.id = s.submitted_by
         LEFT JOIN training_modules m ON m.id = r.module_id
        WHERE $1::boolean OR ($2::boolean AND r.coach_id = $4) OR ($3::boolean AND s.submitted_by = $4 AND r.status = 'forwarded')
        ORDER BY r.created_at DESC LIMIT 1000`, [all, mine, exporter, req.user.id])).rows);
  }

  /** Un clic : les résultats, tels que saisis par le coach, deviennent visibles de l'exportateur qui a proposé le module. */
  @Post('training-results/:id/forward')
  @RequirePermissions('training:forward')
  async forward_result(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`UPDATE training_results SET status = 'forwarded', forwarded_by = $2, forwarded_at = now() WHERE id = $1 AND status = 'submitted' RETURNING id, submission_id`, [id, req.user.id])).rows[0];
      if (!r) {
        const e = (await c.query(`SELECT 1 FROM training_results WHERE id = $1`, [id])).rows[0];
        if (!e) throw new NotFoundException('Résultat introuvable');
        throw new ConflictException('Résultat déjà transmis');
      }
      const s = (await c.query(`SELECT submitted_by, title FROM training_submissions WHERE id = $1`, [r.submission_id])).rows[0];
      await this.notif.notifyUsers(c, req.org.id, [s.submitted_by], { kind: 'training_result_forwarded', title: 'Résultats de formation disponibles', body: s.title, entityType: 'training_result', entityId: id });
      return { id, status: 'forwarded' };
    });
    await this.log(req, 'training_result.forward', 'training_result', id);
    return out;
  }
}
