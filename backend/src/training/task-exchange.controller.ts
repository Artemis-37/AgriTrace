import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createAssignment } from './producer-assignments.controller';
import { cleanQuestions } from './questionnaires.controller';

export class SubmitTaskDto {
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsArray() questions: any[];
}
export class ForwardTaskDto {
  @IsOptional() @IsString() kind?: string;
  @IsIn(['all', 'selected']) scope: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) producer_ids?: string[];
  @IsOptional() @IsISO8601({ strict: true }) due_date?: string;
  @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
}
export class DeclineTaskDto { @IsOptional() @IsString() @Length(0, 500) reason?: string; }

/**
 * Circuit « tâches de l'exportateur » : l'exportateur crée une tâche (questionnaire) → l'ADG la transmet aux coachs en un clic
 * (producteurs ciblés et échéance au choix) → les coachs renseignent les réponses → l'ADG les transmet à l'exportateur en un clic.
 */
@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('task-submissions')
export class TaskExchangeController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}
  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'task_submission', entityId: id, details });
  }
  private has(req: any, p: string) { return req.org.permissions.has(p); }

  @Post()
  @RequirePermissions('tasks:propose')
  async submit(@Body() b: SubmitTaskDto, @Req() req: any) {
    const questions = cleanQuestions(b.questions);
    const row = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`INSERT INTO task_submissions(organization_id, submitted_by, title, description, questions) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.org.id, req.user.id, b.title.trim(), (b.description ?? '').trim(), JSON.stringify(questions)])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'training:forward', { kind: 'task_submitted', title: 'Nouvelle tâche proposée par un exportateur', body: r.title, entityType: 'task_submission', entityId: r.id }, req.user.id);
      return r;
    });
    await this.log(req, 'task_submission.create', row.id, { title: row.title, questions: questions.length });
    return row;
  }

  @Get()
  list(@Req() req: any) {
    const all = this.has(req, 'training:forward');
    if (!all && !this.has(req, 'tasks:propose')) throw new ForbiddenException('Permission insuffisante');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.id, s.title, s.description, s.questions, s.status, s.decline_reason, s.decided_at, s.created_at, s.results_forwarded_at, s.assignment_id,
              u.full_name AS submitted_by_name, d.full_name AS decided_by_name,
              (SELECT count(*)::int FROM producer_assignment_targets t WHERE t.assignment_id = s.assignment_id) AS targets,
              (SELECT count(*)::int FROM questionnaire_answers a WHERE a.assignment_id = s.assignment_id) AS answers
         FROM task_submissions s JOIN users u ON u.id = s.submitted_by LEFT JOIN users d ON d.id = s.decided_by
        WHERE ($1::boolean OR s.submitted_by = $2) ORDER BY s.created_at DESC LIMIT 500`, [all, req.user.id])).rows);
  }

  /** Un clic : la tâche (questions inchangées) est ajoutée au profil des producteurs choisis ; les coachs sont prévenus. */
  @Post(':id/forward')
  @RequirePermissions('training:forward')
  async forward(@Param('id', ParseUUIDPipe) id: string, @Body() b: ForwardTaskDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`UPDATE task_submissions SET status = 'forwarded', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'submitted' RETURNING *`, [id, req.user.id])).rows[0];
      if (!s) {
        if (!(await c.query(`SELECT 1 FROM task_submissions WHERE id = $1`, [id])).rowCount) throw new NotFoundException('Proposition introuvable');
        throw new ConflictException('Proposition déjà traitée');
      }
      const q = (await c.query(`INSERT INTO questionnaires(organization_id, title, description, questions, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.org.id, s.title, s.description, JSON.stringify(s.questions), req.user.id])).rows[0];
      const asg = await createAssignment(c, req.org.id, req.user.id, this.notif, { ...b, kind: 'tache', title: s.title, module_id: null, questionnaire_id: q.id } as any);
      await c.query(`UPDATE task_submissions SET questionnaire_id = $2, assignment_id = $3 WHERE id = $1`, [id, q.id, asg.id]);
      await this.notif.notifyUsers(c, req.org.id, [s.submitted_by], { kind: 'task_submission_forwarded', title: 'Votre tâche a été transmise aux coachs', body: s.title, entityType: 'task_submission', entityId: id });
      return { id, status: 'forwarded', questionnaire_id: q.id, assignment_id: asg.id, targets: asg.targets };
    });
    await this.log(req, 'task_submission.forward', id, { scope: b.scope, targets: out.targets });
    return out;
  }

  @Post(':id/decline')
  @RequirePermissions('training:forward')
  async decline(@Param('id', ParseUUIDPipe) id: string, @Body() b: DeclineTaskDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`UPDATE task_submissions SET status = 'declined', decided_by = $2, decided_at = now(), decline_reason = $3 WHERE id = $1 AND status = 'submitted' RETURNING id, title, submitted_by`, [id, req.user.id, b.reason?.trim() || null])).rows[0];
      if (!s) {
        if (!(await c.query(`SELECT 1 FROM task_submissions WHERE id = $1`, [id])).rowCount) throw new NotFoundException('Proposition introuvable');
        throw new ConflictException('Proposition déjà traitée');
      }
      await this.notif.notifyUsers(c, req.org.id, [s.submitted_by], { kind: 'task_submission_declined', severity: 'warning', title: "Votre tâche n'a pas été retenue", body: b.reason?.trim() || s.title, entityType: 'task_submission', entityId: id });
      return { id, status: 'declined' };
    });
    await this.log(req, 'task_submission.decline', id, { reason: b.reason ?? null });
    return out;
  }

  /** Un clic : les réponses des coachs deviennent visibles de l'exportateur, telles que saisies. */
  @Post(':id/forward-results')
  @RequirePermissions('training:forward')
  async forwardResults(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`UPDATE task_submissions SET results_forwarded_by = $2, results_forwarded_at = now() WHERE id = $1 AND status = 'forwarded' RETURNING id, title, submitted_by`, [id, req.user.id])).rows[0];
      if (!s) throw new ConflictException("Tâche introuvable ou pas encore transmise aux coachs");
      await this.notif.notifyUsers(c, req.org.id, [s.submitted_by], { kind: 'task_results_forwarded', title: 'Réponses de la tâche disponibles', body: s.title, entityType: 'task_submission', entityId: id });
      return { id, results_forwarded: true };
    });
    await this.log(req, 'task_submission.forward_results', id);
    return out;
  }

  /** Réponses : l'ADG les voit à tout moment ; l'exportateur seulement après transmission. JSON, ou ?format=csv. */
  @Get(':id/results')
  async results(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Query('format') format?: string) {
    const all = this.has(req, 'training:forward');
    if (!all && !this.has(req, 'tasks:propose')) throw new ForbiddenException('Permission insuffisante');
    const d = await this.db.tx(req.org.id, async (c) => {
      const s = (await c.query(`SELECT id, title, questions, assignment_id, submitted_by, results_forwarded_at FROM task_submissions WHERE id = $1`, [id])).rows[0];
      if (!s || (!all && s.submitted_by !== req.user.id)) throw new NotFoundException('Tâche introuvable');
      if (!all && !s.results_forwarded_at) throw new ForbiddenException("Les réponses n'ont pas encore été transmises par l'ADG");
      if (!s.assignment_id) return { ...s, rows: [] as any[] };
      const rows = (await c.query(
        `SELECT p.internal_code, p.last_name, p.first_names, p.village, t.status, an.answers, an.answered_at, u.full_name AS answered_by
           FROM producer_assignment_targets t JOIN producers p ON p.id = t.producer_id LEFT JOIN questionnaire_answers an ON an.target_id = t.id
           LEFT JOIN users u ON u.id = an.answered_by WHERE t.assignment_id = $1 ORDER BY p.last_name, p.first_names`, [s.assignment_id])).rows;
      return { ...s, rows };
    });
    if (format !== 'csv') return { id: d.id, title: d.title, questions: d.questions, rows: d.rows };
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const val = (v: any) => (Array.isArray(v) ? v.join(' ; ') : v);
    const lines = [['Code', 'Nom', 'Prénoms', 'Village', 'État', 'Renseigné le', 'Par', ...d.questions.map((q: any) => q.label)].map(esc).join(';')];
    for (const r of d.rows) lines.push([r.internal_code, r.last_name, r.first_names, r.village, r.status === 'done' ? 'Fait' : 'À faire', r.answered_at ? new Date(r.answered_at).toISOString().slice(0, 10) : '', r.answered_by, ...d.questions.map((q: any) => val(r.answers?.[q.id]))].map(esc).join(';'));
    return new StreamableFile(Buffer.from('﻿' + lines.join('\r\n')), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="reponses-tache.csv"' });
  }
}
