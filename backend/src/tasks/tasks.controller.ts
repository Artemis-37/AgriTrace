import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['mapping', 'visit', 'survey', 'collection', 'training', 'control', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CLOSED = ['closed', 'cancelled'];

/** Transitions autorisées ; la permission requise dépend de la cible (voir `moveTask`). */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['open', 'cancelled'],
  open: ['in_progress', 'cancelled'],
  in_progress: ['submitted', 'cancelled'],
  pending_sync: ['submitted', 'in_progress'],
  submitted: ['validated', 'to_correct', 'cancelled'],
  to_correct: ['in_progress', 'cancelled'],
  validated: ['completed', 'closed', 'cancelled'],
  completed: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

export class TaskDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(1, 4000) description?: string;
  @IsIn(CATEGORIES) category: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @Matches(DATE) due_date?: string;
  @IsOptional() @IsString() @Length(1, 100) section?: string;
  @IsOptional() @IsUUID() producer_id?: string;
  @IsOptional() @IsUUID() parcel_id?: string;
  @IsOptional() @IsUUID() campaign_id?: string;
  @IsOptional() @IsUUID() assignee_id?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) team_ids?: string[];
  @IsOptional() @IsString() @Length(1, 2000) expected_result?: string;
  @IsOptional() @IsString() @Length(1, 2000) validation_criteria?: string;
  @IsOptional() @IsString() @Length(1, 4000) instructions?: string;
  @IsOptional() publish?: boolean;
}
class UpdateTaskDto {
  @IsOptional() @IsString() @Length(3, 200) title?: string;
  @IsOptional() @IsString() @Length(1, 4000) description?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @Matches(DATE) due_date?: string;
  @IsOptional() @IsString() @Length(1, 100) section?: string;
  @IsOptional() @IsString() @Length(1, 2000) expected_result?: string;
  @IsOptional() @IsString() @Length(1, 2000) validation_criteria?: string;
  @IsOptional() @IsString() @Length(1, 4000) instructions?: string;
  @IsString() @Length(3, 300) reason: string;
}
class AssignDto {
  @IsUUID() assignee_id: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) team_ids?: string[];
}
class TransitionDto { @IsString() to: string; @IsOptional() @IsString() @Length(1, 1000) note?: string; }
export class TaskEntryDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(['observation', 'result', 'gps', 'photo', 'document']) kind: string;
  @IsOptional() @IsString() @Length(1, 4000) content?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100000) accuracy_m?: number;
  @IsOptional() @IsUUID() document_id?: string;
  @IsOptional() @IsISO8601() recorded_at?: string;
}
class RequestDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(1, 4000) description?: string;
  @IsOptional() @IsIn(CATEGORIES) category?: string;
  @IsOptional() @IsUUID() producer_id?: string;
  @IsOptional() @IsUUID() parcel_id?: string;
}
class DecideDto {
  @IsIn(['accept', 'reject']) decision: string;
  @IsString() @Length(3, 500) note: string;
  @IsOptional() @IsUUID() assignee_id?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @Matches(DATE) due_date?: string;
  @IsOptional() @IsString() @Length(1, 4000) instructions?: string;
}

@ApiTags('missions et tâches')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class TasksController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'task', entityId: id, details });
  }
  private has = (req: any, p: string) => req.org.permissions.has(p);
  private isExecutor = (t: any, uid: string) => t.assignee_id === uid || (t.team_ids ?? []).includes(uid);

  private async load(c: PoolClient, id: string, req: any, lock = false) {
    const t = (await c.query(`SELECT * FROM tasks WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!t) throw new NotFoundException();
    // Sans « toute la coopérative », seules les missions où l'on est exécutant (et non en brouillon) existent
    if (!this.has(req, 'tasks:read_all') && !(this.isExecutor(t, req.user.id) && t.status !== 'draft')) throw new NotFoundException();
    return t;
  }
  private async checkRefs(c: PoolClient, b: { producer_id?: string; parcel_id?: string; campaign_id?: string; assignee_id?: string; team_ids?: string[] }, orgId: string) {
    if (b.producer_id && !(await c.query(`SELECT 1 FROM producers WHERE id = $1`, [b.producer_id])).rowCount) throw new BadRequestException('Producteur inconnu');
    if (b.parcel_id) {
      const p = (await c.query(`SELECT producer_id FROM parcels WHERE id = $1 AND status = 'active'`, [b.parcel_id])).rows[0];
      if (!p) throw new BadRequestException('Parcelle inconnue ou archivée');
      if (b.producer_id && p.producer_id !== b.producer_id) throw new BadRequestException('La parcelle n\'appartient pas au producteur indiqué');
    }
    if (b.campaign_id && !(await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [b.campaign_id])).rowCount) throw new BadRequestException('Campagne inconnue');
    const people = [...(b.assignee_id ? [b.assignee_id] : []), ...(b.team_ids ?? [])];
    if (people.length) {
      const ok = (await c.query(`SELECT DISTINCT user_id FROM user_organizations WHERE organization_id = $1 AND status = 'active' AND user_id = ANY($2)`, [orgId, people])).rows.length;
      if (ok !== new Set(people).size) throw new BadRequestException('Responsable ou équipe : utilisateur inconnu ou suspendu dans cette coopérative');
    }
  }
  private async nextCode(c: PoolClient, orgId: string) {
    const n = (await c.query(
      `INSERT INTO task_counters(organization_id, last_no) VALUES ($1, 1) ON CONFLICT (organization_id) DO UPDATE SET last_no = task_counters.last_no + 1 RETURNING last_no`, [orgId])).rows[0].last_no;
    return `M${String(n).padStart(5, '0')}`;
  }
  private async history(c: PoolClient, orgId: string, taskId: string, from: string | null, to: string, actor: string, note?: string) {
    await c.query(`INSERT INTO task_history(organization_id, task_id, from_status, to_status, note, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`, [orgId, taskId, from, to, note ?? null, actor]);
  }

  private notifyAssigned(c: PoolClient, req: any, t: any) {
    return this.notif.notifyUsers(c, req.org.id, [t.assignee_id, ...(t.team_ids ?? [])].filter((u) => u !== req.user.id), { kind: 'task_assigned', title: `Nouvelle mission : ${t.code}`,
      body: t.title, entityType: 'task', entityId: t.id, dedupe: `task_assigned:${t.id}:${t.assignee_id}:${(t.team_ids ?? []).join(',')}` });
  }

  // ---- Création et consultation ----
  @Post('tasks')
  @RequirePermissions('tasks:create')
  async create(@Body() b: TaskDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM tasks WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      await this.checkRefs(c, b, req.org.id);
      if (b.publish && !b.assignee_id) throw new BadRequestException('Une mission ouverte doit avoir un responsable');
      if (b.assignee_id && !this.has(req, 'tasks:assign')) throw new ForbiddenException('Permission manquante : tasks:assign');
      const status = b.publish ? 'open' : 'draft';
      const code = await this.nextCode(c, req.org.id);
      const t = (await c.query(
        `INSERT INTO tasks(organization_id, idempotency_key, code, title, description, category, priority, due_date, section, producer_id, parcel_id, campaign_id,
                           assignee_id, team_ids, expected_result, validation_criteria, instructions, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [req.org.id, b.idempotency_key, code, b.title, b.description ?? null, b.category, b.priority ?? 'normal', b.due_date ?? null, b.section ?? null,
         b.producer_id ?? null, b.parcel_id ?? null, b.campaign_id ?? null, b.assignee_id ?? null, b.team_ids ?? [], b.expected_result ?? null,
         b.validation_criteria ?? null, b.instructions ?? null, status, req.user.id])).rows[0];
      await this.history(c, req.org.id, t.id, null, status, req.user.id, 'Création');
      if (status === 'open') await this.notifyAssigned(c, req, t);
      await this.log(req, 'task.create', t.id, { code, status });
      return t;
    });
    return out;
  }

  @Get('tasks')
  @RequirePermissions('tasks:read')
  list(@Req() req: any, @Query('status') status?: string, @Query('assignee_id') assignee?: string, @Query('category') cat?: string,
       @Query('producer_id') prod?: string, @Query('overdue') overdue?: string) {
    const all = this.has(req, 'tasks:read_all');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT t.*, (t.due_date < current_date AND t.status NOT IN ('validated','completed','closed','cancelled')) AS overdue
         FROM tasks t
        WHERE ($1::boolean OR ((t.assignee_id = $2 OR $2 = ANY(t.team_ids)) AND t.status <> 'draft'))
          AND ($3::text IS NULL OR t.status = $3) AND ($4::uuid IS NULL OR t.assignee_id = $4) AND ($5::text IS NULL OR t.category = $5)
          AND ($6::uuid IS NULL OR t.producer_id = $6)
          AND ($7::boolean IS NOT TRUE OR (t.due_date < current_date AND t.status NOT IN ('validated','completed','closed','cancelled')))
        ORDER BY array_position(ARRAY['urgent','high','normal','low'], t.priority), t.due_date NULLS LAST, t.created_at DESC LIMIT 500`,
      [all, req.user.id, status ?? null, assignee ?? null, cat ?? null, prod ?? null, overdue === 'true' ? true : null])).rows);
  }

  @Get('tasks/dashboard')
  @RequirePermissions('tasks:read')
  async dashboard(@Req() req: any, @Query('scope') scope?: string) {
    const all = scope === 'all';
    if (all && !this.has(req, 'tasks:read_all')) throw new ForbiddenException('Permission manquante : tasks:read_all');
    return this.db.tx(req.org.id, async (c) => {
      const mine = `(t.assignee_id = $1 OR $1 = ANY(t.team_ids)) AND t.status <> 'draft'`;
      const where = all ? `t.status <> 'draft'` : mine;
      const p = all ? [] : [req.user.id];
      const open = `t.status IN ('open','in_progress','pending_sync','to_correct')`;
      const q = async (sql: string, params: any[] = p) => (await c.query(sql, params)).rows;
      const cols = `t.id, t.code, t.title, t.category, t.priority, t.due_date, t.status, t.producer_id, t.parcel_id`;
      const assigned = await q(`SELECT ${cols} FROM tasks t WHERE ${where} AND ${open} ORDER BY t.due_date NULLS LAST LIMIT 100`);
      const urgent = await q(`SELECT ${cols} FROM tasks t WHERE ${where} AND ${open} AND t.priority = 'urgent' ORDER BY t.due_date NULLS LAST LIMIT 100`);
      const overdue = await q(`SELECT ${cols} FROM tasks t WHERE ${where} AND ${open} AND t.due_date < current_date ORDER BY t.due_date LIMIT 100`);
      const done = await q(`SELECT ${cols} FROM tasks t WHERE ${where} AND t.status IN ('validated','completed','closed') ORDER BY t.updated_at DESC LIMIT 50`);
      const toReview = await q(`SELECT ${cols} FROM tasks t WHERE ${where} AND t.status = 'submitted' ORDER BY t.submitted_at LIMIT 100`);
      const producersToVisit = await q(
        `SELECT DISTINCT p.id, p.internal_code, p.last_name, p.first_names, p.village FROM tasks t JOIN producers p ON p.id = t.producer_id
          WHERE ${where} AND ${open} AND t.category IN ('visit','survey','mapping','control') ORDER BY p.internal_code LIMIT 100`);
      const unmapped = await q(
        `SELECT p.id, p.internal_code, p.last_name, p.first_names, p.village FROM producers p
          WHERE p.status = 'active' AND NOT EXISTS (SELECT 1 FROM parcels x WHERE x.producer_id = p.id AND x.status = 'active' AND x.geometry IS NOT NULL)
          ORDER BY p.internal_code LIMIT 100`, []);
      const noPolygon = await q(`SELECT id, code, producer_id, declared_area_ha FROM parcels WHERE status = 'active' AND geometry IS NULL ORDER BY code LIMIT 100`, []);
      const pendingValidation = await q(`SELECT id, code, producer_id, verification_status FROM parcels WHERE status = 'active' AND verification_status = 'declared' AND geometry IS NOT NULL ORDER BY code LIMIT 100`, []);
      const anomalies = this.has(req, 'geo:anomalies')
        ? await q(`SELECT id, kind, parcel_a, parcel_b, intersection_m2, detected_at FROM parcel_anomalies WHERE status = 'open' ORDER BY detected_at DESC LIMIT 100`, []) : [];
      const toCorrect = await q(`SELECT ${cols}, t.review_note FROM tasks t WHERE ${where} AND t.status = 'to_correct' LIMIT 100`);
      return {
        counts: { assigned: assigned.length, urgent: urgent.length, overdue: overdue.length, done: done.length, to_review: toReview.length, to_correct: toCorrect.length,
          unmapped_producers: unmapped.length, parcels_without_polygon: noPolygon.length, parcels_pending_validation: pendingValidation.length, open_anomalies: anomalies.length },
        assigned, urgent, overdue, done, to_review: toReview, to_correct: toCorrect,
        producers_to_visit: producersToVisit, unmapped_producers: unmapped, parcels_without_polygon: noPolygon, parcels_pending_validation: pendingValidation, anomalies,
        note: 'Les opérations en attente de synchronisation sont comptées sur l\'appareil (file locale).',
      };
    });
  }

  @Get('tasks/:id')
  @RequirePermissions('tasks:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const t = await this.load(c, id, req);
      const history = (await c.query(`SELECT h.id, h.from_status, h.to_status, h.note, h.actor_id, u.full_name AS actor_name, h.created_at
                                         FROM task_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.task_id = $1 ORDER BY h.id`, [id])).rows;
      const entries = (await c.query(`SELECT * FROM task_entries WHERE task_id = $1 ORDER BY recorded_at, created_at`, [id])).rows;
      const documents = (await c.query(`SELECT id, kind, filename, mime, size_bytes, version, uploaded_at FROM documents WHERE subject_type = 'task' AND subject_id = $1 ORDER BY uploaded_at`, [id])).rows;
      let producer: any = null, parcels: any[] = [], mapping: any = null;
      if (t.producer_id) {
        producer = (await c.query(`SELECT id, internal_code, last_name, first_names, village, section, phone FROM producers WHERE id = $1`, [t.producer_id])).rows[0];
        parcels = (await c.query(
          `SELECT p.id, p.code, p.declared_area_ha, p.geometry_area_ha, p.verification_status, (p.geometry IS NOT NULL) AS has_polygon,
                  (SELECT count(*) FROM parcel_anomalies a WHERE a.status = 'open' AND (a.parcel_a = p.id OR a.parcel_b = p.id))::int AS open_anomalies
             FROM parcels p WHERE p.producer_id = $1 AND p.status = 'active' ORDER BY p.code`, [t.producer_id])).rows;
        if (t.category === 'mapping') {
          // CDC §11.4 : jamais de doublon accidentel ; une géométrie existante est montrée, pas recréée
          const target = t.parcel_id ? parcels.filter((x) => x.id === t.parcel_id) : parcels;
          let action: string, message: string;
          if (!parcels.length) { action = 'create_parcel'; message = 'Aucune parcelle : en créer une, rattachée automatiquement à ce producteur'; }
          else if (target.some((x) => !x.has_polygon)) { action = 'complete_polygon'; message = 'Parcelle sans polygone : compléter sa cartographie'; }
          else { action = 'view_existing'; message = 'Polygone existant : afficher la géométrie. Toute nouvelle enquête ou correction est une opération distincte avec historique'; }
          mapping = { action, message, producer_id: t.producer_id, parcels: target.length ? target : parcels };
        }
      }
      return { ...t, history, entries, documents, producer, mapping, can_execute: this.isExecutor(t, req.user.id) && this.has(req, 'tasks:execute') };
    });
  }

  // ---- Instructions officielles et attribution ----
  @Post('tasks/:id/update')
  @RequirePermissions('tasks:update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateTaskDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const t = await this.load(c, id, req, true);
      if (!['draft', 'open', 'in_progress', 'to_correct', 'pending_sync'].includes(t.status)) throw new ConflictException('Les instructions ne sont plus modifiables à ce stade');
      const { reason, ...fields } = b;
      const keys = Object.keys(fields).filter((k) => (fields as any)[k] !== undefined);
      if (!keys.length) throw new BadRequestException('Aucune modification');
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const r = (await c.query(`UPDATE tasks SET ${sets}, updated_at = now(), updated_by = $${keys.length + 2}, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, ...keys.map((k) => (fields as any)[k]), req.user.id])).rows[0];
      const old: any = {}; for (const k of keys) old[k] = t[k];
      await this.history(c, req.org.id, id, t.status, t.status, req.user.id, `Instructions modifiées (${keys.join(', ')}) : ${reason}`);
      await this.log(req, 'task.update', id, { fields: keys, old, reason });
      return r;
    });
  }

  @Post('tasks/:id/assign')
  @RequirePermissions('tasks:assign')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const t = await this.load(c, id, req, true);
      if (CLOSED.includes(t.status) || ['validated', 'completed', 'submitted'].includes(t.status)) throw new ConflictException('Mission non réattribuable à ce stade');
      await this.checkRefs(c, { assignee_id: b.assignee_id, team_ids: b.team_ids }, req.org.id);
      const r = (await c.query(`UPDATE tasks SET assignee_id = $2, team_ids = $3, updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, b.assignee_id, b.team_ids ?? [], req.user.id])).rows[0];
      await this.history(c, req.org.id, id, t.status, t.status, req.user.id, 'Attribution modifiée');
      if (!['draft'].includes(t.status)) await this.notifyAssigned(c, req, r);
      await this.log(req, 'task.assign', id, { from: t.assignee_id, to: b.assignee_id });
      return r;
    });
  }

  // ---- Statuts ----
  private async moveTask(c: PoolClient, t: any, to: string, req: any, note?: string) {
    if (!TRANSITIONS[t.status]?.includes(to)) throw new ConflictException(`Passage de « ${t.status} » à « ${to} » impossible`);
    const uid = req.user.id;
    const need = (p: string) => { if (!this.has(req, p)) throw new ForbiddenException(`Permission manquante : ${p}`); };
    const exec = () => { need('tasks:execute'); if (!this.isExecutor(t, uid)) throw new ForbiddenException('Seul le responsable de la mission (ou son équipe) peut l\'exécuter'); };
    switch (to) {
      case 'open': need('tasks:create'); if (!t.assignee_id) throw new BadRequestException('Attribuer un responsable avant d\'ouvrir la mission'); break;
      case 'in_progress': exec(); break;
      case 'submitted': {
        exec();
        const n = (await c.query(`SELECT count(*)::int AS n FROM task_entries WHERE task_id = $1 AND kind = 'result'`, [t.id])).rows[0].n;
        if (!n) throw new UnprocessableEntityException('Enregistrer au moins un résultat avant de soumettre la mission (résultat attendu vérifiable)');
        break;
      }
      case 'validated': case 'to_correct':
        need('tasks:review');
        if (this.isExecutor(t, uid)) throw new ForbiddenException('Le contrôle doit être fait par une autre personne que l\'exécutant');
        if (to === 'to_correct' && !note) throw new BadRequestException('Indiquer ce qui doit être corrigé');
        break;
      case 'completed': case 'closed': need('tasks:close'); break;
      case 'cancelled': need('tasks:close'); if (!note) throw new BadRequestException('Motif d\'annulation obligatoire'); break;
    }
    const r = (await c.query(
      `UPDATE tasks SET status = $2, updated_at = now(), updated_by = $3, version = version + 1,
              started_at = CASE WHEN $2 = 'in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
              submitted_at = CASE WHEN $2 = 'submitted' THEN now() ELSE submitted_at END,
              reviewed_at = CASE WHEN $2 IN ('validated','to_correct') THEN now() ELSE reviewed_at END,
              review_note = CASE WHEN $2 IN ('validated','to_correct') THEN $4 ELSE review_note END,
              closed_at = CASE WHEN $2 IN ('closed','cancelled') THEN now() ELSE closed_at END
        WHERE id = $1 RETURNING *`, [t.id, to, uid, note ?? null])).rows[0];
    await this.history(c, req.org.id, t.id, t.status, to, uid, note);
    if (to === 'open') await this.notifyAssigned(c, req, r);
    if (to === 'submitted')
      await this.notif.notifyPermission(c, req.org.id, 'tasks:review', { kind: 'task_submitted', title: `Mission soumise pour vérification : ${t.code}`, body: t.title,
        entityType: 'task', entityId: t.id, dedupe: `task_submitted:${t.id}:${r.version}` }, uid);
    if (to === 'to_correct')
      await this.notif.notifyUsers(c, req.org.id, [t.assignee_id, ...(t.team_ids ?? [])], { kind: 'task_to_correct', severity: 'warning', title: `Correction demandée : ${t.code}`, body: note,
        entityType: 'task', entityId: t.id, dedupe: `task_to_correct:${t.id}:${r.version}` });
    await this.log(req, 'task.status', t.id, { from: t.status, to, note });
    return r;
  }

  @Post('tasks/:id/transition')
  @RequirePermissions('tasks:read')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() b: TransitionDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => this.moveTask(c, await this.load(c, id, req, true), b.to, req, b.note));
  }

  /** Démarrage / reprise (idempotent si déjà en cours) — utilisé aussi par la synchronisation. */
  async start(id: string, req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const t = await this.load(c, id, req, true);
      if (t.status === 'in_progress') return t;
      return this.moveTask(c, t, 'in_progress', req);
    });
  }
  async submit(id: string, req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const t = await this.load(c, id, req, true);
      if (t.status === 'submitted') return t;
      return this.moveTask(c, t, 'submitted', req);
    });
  }

  // ---- Saisies de l'exécutant ----
  @Post('tasks/:id/entries')
  @RequirePermissions('tasks:execute')
  addEntry(@Param('id', ParseUUIDPipe) id: string, @Body() b: TaskEntryDto, @Req() req: any) {
    return this.createEntry(id, b, req);
  }
  async createEntry(id: string, b: TaskEntryDto, req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM task_entries WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) {
        if (prior.task_id !== id) throw new ConflictException('Clé d\'idempotence déjà utilisée pour une autre mission');
        return prior;
      }
      const t = await this.load(c, id, req, true);
      if (!this.isExecutor(t, req.user.id)) throw new ForbiddenException('Seul le responsable de la mission (ou son équipe) peut y saisir des résultats');
      if (t.status !== 'in_progress' && t.status !== 'pending_sync') throw new ConflictException('Mission non en cours : la démarrer (ou la reprendre si à corriger) avant de saisir');
      if (b.kind === 'gps' && (b.latitude === undefined || b.longitude === undefined)) throw new BadRequestException('Position GPS : latitude et longitude requises');
      if ((b.kind === 'observation' || b.kind === 'result') && !b.content) throw new BadRequestException('Texte requis');
      if ((b.kind === 'photo' || b.kind === 'document') && !b.document_id) throw new BadRequestException('Téléverser d\'abord le fichier (document_id requis)');
      if (b.document_id) {
        const d = (await c.query(`SELECT subject_type, subject_id FROM documents WHERE id = $1`, [b.document_id])).rows[0];
        if (!d || d.subject_type !== 'task' || d.subject_id !== id) throw new BadRequestException('Le document doit être téléversé sur cette mission');
      }
      const rec = b.recorded_at ? new Date(b.recorded_at) : new Date();
      if (rec.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Date de saisie dans le futur');
      const r = (await c.query(
        `INSERT INTO task_entries(organization_id, idempotency_key, task_id, kind, content, latitude, longitude, accuracy_m, document_id, recorded_at, author_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.org.id, b.idempotency_key, id, b.kind, b.content ?? null, b.latitude ?? null, b.longitude ?? null, b.accuracy_m ?? null, b.document_id ?? null, rec, req.user.id])).rows[0];
      await this.log(req, 'task.entry', id, { kind: b.kind });
      return r;
    });
  }

  // ---- Demandes de mission (coach) ----
  @Post('task-requests')
  @RequirePermissions('tasks:request')
  async request(@Body() b: RequestDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM task_requests WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      await this.checkRefs(c, b, req.org.id);
      const r = (await c.query(
        `INSERT INTO task_requests(organization_id, idempotency_key, title, description, category, producer_id, parcel_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.org.id, b.idempotency_key, b.title, b.description ?? null, b.category ?? 'other', b.producer_id ?? null, b.parcel_id ?? null, req.user.id])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'tasks:decide_requests', { kind: 'task_request', title: 'Nouvelle demande de mission', body: b.title,
        entityType: 'task_request', entityId: r.id, dedupe: `task_request:${r.id}` }, req.user.id);
      await this.log(req, 'task_request.create', r.id, { title: b.title });
      return r;
    });
  }

  @Get('task-requests')
  @RequirePermissions('tasks:request')
  listRequests(@Req() req: any, @Query('status') status?: string) {
    const all = this.has(req, 'tasks:decide_requests');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.*, u.full_name AS requested_by_name FROM task_requests r LEFT JOIN users u ON u.id = r.created_by
        WHERE ($1::boolean OR r.created_by = $2) AND ($3::text IS NULL OR r.status = $3) ORDER BY r.created_at DESC LIMIT 200`,
      [all, req.user.id, status ?? null])).rows);
  }

  @Post('task-requests/:id/decide')
  @RequirePermissions('tasks:decide_requests')
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT * FROM task_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.status !== 'pending') throw new ConflictException('Demande déjà traitée');
      let task: any = null;
      if (b.decision === 'accept') {
        if (!this.has(req, 'tasks:create')) throw new ForbiddenException('Permission manquante : tasks:create');
        if (b.assignee_id && !this.has(req, 'tasks:assign')) throw new ForbiddenException('Permission manquante : tasks:assign');
        await this.checkRefs(c, { assignee_id: b.assignee_id, producer_id: r.producer_id ?? undefined, parcel_id: r.parcel_id ?? undefined }, req.org.id);
        const status = b.assignee_id ? 'open' : 'draft';
        const code = await this.nextCode(c, req.org.id);
        task = (await c.query(
          `INSERT INTO tasks(organization_id, idempotency_key, code, title, description, category, priority, due_date, producer_id, parcel_id, assignee_id, instructions, status, request_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [req.org.id, `req-${r.id}`, code, r.title, r.description, r.category, b.priority ?? 'normal', b.due_date ?? null, r.producer_id, r.parcel_id, b.assignee_id ?? null,
           b.instructions ?? null, status, r.id, req.user.id])).rows[0];
        await this.history(c, req.org.id, task.id, null, status, req.user.id, `Créée depuis la demande ${r.id}`);
      }
      const upd = (await c.query(
        `UPDATE task_requests SET status = $2, task_id = $3, decided_by = $4, decided_at = now(), decision_note = $5 WHERE id = $1 RETURNING *`,
        [id, b.decision === 'accept' ? 'accepted' : 'rejected', task?.id ?? null, req.user.id, b.note])).rows[0];
      await this.notif.notifyUsers(c, req.org.id, [r.created_by], { kind: 'task_request_decided', title: b.decision === 'accept' ? 'Demande de mission acceptée' : 'Demande de mission refusée',
        body: b.note, entityType: 'task_request', entityId: id, dedupe: `task_request_decided:${id}` });
      if (task?.status === 'open') await this.notifyAssigned(c, req, task);
      await this.log(req, 'task_request.decide', id, { decision: b.decision, task_id: task?.id });
      return { request: upd, task };
    });
  }
}
