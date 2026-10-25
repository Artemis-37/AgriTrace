import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

export const KINDS = ['formation', 'distribution', 'tache'];
export class AssignTargetDto {
  @IsIn(KINDS) kind: string;
  @IsIn(['all', 'selected']) scope: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) producer_ids?: string[];
  @IsOptional() @IsISO8601({ strict: true }) due_date?: string;
  @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
}
export class AssignDto extends AssignTargetDto {
  @IsOptional() @IsUUID() module_id?: string;
  @IsOptional() @IsString() @Length(3, 200) title?: string;
  @IsOptional() @IsUUID() questionnaire_id?: string;
}

/** Crée l'affectation et une ligne par producteur ciblé (tous les producteurs actifs, ou la sélection). Appelé dans une transaction. */
export async function createAssignment(c: any, orgId: string, userId: string, notif: NotificationsService, a: { kind: string; scope: string; producer_ids?: string[]; due_date?: string; instructions?: string; title: string; module_id?: string | null; questionnaire_id?: string | null; submission_id?: string | null }) {
  let ids: string[];
  if (a.scope === 'all') ids = (await c.query(`SELECT id FROM producers WHERE status = 'active'`)).rows.map((r: any) => r.id);
  else {
    const want = [...new Set(a.producer_ids ?? [])];
    if (!want.length) throw new BadRequestException('Choisissez au moins un producteur');
    ids = (await c.query(`SELECT id FROM producers WHERE id = ANY($1::uuid[]) AND status = 'active'`, [want])).rows.map((r: any) => r.id);
    if (ids.length !== want.length) throw new BadRequestException('Producteur introuvable ou inactif dans la sélection');
  }
  if (!ids.length) throw new BadRequestException('Aucun producteur actif à cibler');
  const row = (await c.query(
    `INSERT INTO producer_assignments(organization_id, kind, scope, title, instructions, due_date, module_id, submission_id, created_by, questionnaire_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [orgId, a.kind, a.scope, a.title, (a.instructions ?? '').trim(), a.due_date ?? null, a.module_id ?? null, a.submission_id ?? null, userId, a.questionnaire_id ?? null])).rows[0];
  await c.query(`INSERT INTO producer_assignment_targets(organization_id, assignment_id, producer_id) SELECT $1, $2, unnest($3::uuid[])`, [orgId, row.id, ids]);
  const label = a.kind === 'formation' ? 'Module de formation' : a.kind === 'distribution' ? 'Distribution' : 'Tâche';
  await notif.notifyPermission(c, orgId, 'training:report', { kind: 'producer_assignment', title: `${label} ajouté(e) au profil de ${ids.length} producteur(s)`, body: a.title, entityType: 'producer_assignment', entityId: row.id }, userId);
  return { ...row, targets: ids.length };
}

@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('producer-assignments')
export class ProducerAssignmentsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  /** « Implémenter un modèle » : l'ADG affecte un module de la bibliothèque (ou une distribution / tâche libre) à tous les producteurs ou à certains. */
  @Post()
  @RequirePermissions('training:assign')
  async create(@Body() b: AssignDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      let title = b.title?.trim();
      if (b.questionnaire_id) {
        const q = (await c.query(`SELECT title FROM questionnaires WHERE id = $1 AND NOT archived`, [b.questionnaire_id])).rows[0];
        if (!q) throw new NotFoundException('Questionnaire introuvable ou archivé');
        title = title || q.title; b.kind = 'tache';
      } else if (b.module_id) {
        const m = (await c.query(`SELECT title FROM training_modules WHERE id = $1`, [b.module_id])).rows[0];
        if (!m) throw new NotFoundException('Module introuvable');
        title = title || m.title;
      } else if (b.kind === 'formation') throw new BadRequestException('Un module de formation doit être choisi dans la bibliothèque');
      if (!title) throw new BadRequestException('Titre requis');
      return createAssignment(c, req.org.id, req.user.id, this.notif, { ...b, title, module_id: b.module_id ?? null, questionnaire_id: b.questionnaire_id ?? null });
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer_assignment.create', entityType: 'producer_assignment', entityId: out.id, details: { kind: out.kind, scope: out.scope, targets: out.targets } });
    return out;
  }

  /** Éléments ajoutés au profil d'un producteur (ou liste des affectations avec leur avancement). */
  @Get()
  async list(@Req() req: any, @Query('producer_id') producerId?: string, @Query('mine') mine?: string) {
    const p = req.org.permissions;
    if (!['training:assign', 'training:report', 'training:read', 'producers:read'].some((x) => p.has(x))) throw new ForbiddenException('Droit insuffisant');
    if (producerId && !/^[0-9a-f-]{36}$/i.test(producerId)) throw new BadRequestException('producer_id invalide');
    if (mine === '1') {
      // Copie pour le travail hors connexion : tous les éléments ajoutés aux profils (à plat, avec le producteur).
      return this.db.tx(req.org.id, async (c) => (await c.query(
        `SELECT t.id AS target_id, t.producer_id, t.status, t.done_at, a.id, a.kind, a.title, a.instructions, a.due_date, a.created_at, a.questionnaire_id, q.questions, an.answers
         FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id LEFT JOIN questionnaires q ON q.id = a.questionnaire_id
         LEFT JOIN questionnaire_answers an ON an.target_id = t.id ORDER BY a.created_at DESC LIMIT 5000`)).rows);
    }
    return this.db.tx(req.org.id, async (c) => producerId
      ? (await c.query(
        `SELECT t.id AS target_id, t.status, t.done_at, a.id, a.kind, a.scope, a.title, a.instructions, a.due_date, a.module_id, a.created_at, a.questionnaire_id
         FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id WHERE t.producer_id = $1 ORDER BY (t.status = 'done'), a.created_at DESC`, [producerId])).rows
      : (await c.query(
        `SELECT a.*, count(t.id)::int AS targets, count(t.id) FILTER (WHERE t.status = 'done')::int AS done FROM producer_assignments a
         LEFT JOIN producer_assignment_targets t ON t.assignment_id = a.id GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`)).rows);
  }

  /** Le coach (ou l'ADG) marque l'élément comme fait pour ce producteur. */
  @Post('targets/:id/done')
  async done(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    if (!['training:report', 'training:assign'].some((x) => req.org.permissions.has(x))) throw new ForbiddenException('Droit insuffisant');
    const q = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT a.questionnaire_id FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id WHERE t.id = $1`, [id])).rows[0]);
    if (q?.questionnaire_id) throw new BadRequestException('Cette tâche est un questionnaire : renseignez les réponses du producteur');
    const r = await this.db.tx(req.org.id, async (c) =>
      (await c.query(`UPDATE producer_assignment_targets SET status = 'done', done_at = now(), done_by = $2 WHERE id = $1 AND status = 'pending' RETURNING id, assignment_id, producer_id`, [id, req.user.id])).rows[0]);
    if (!r) throw new NotFoundException('Élément introuvable ou déjà fait');
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer_assignment.done', entityType: 'producer_assignment', entityId: r.assignment_id, details: { producer_id: r.producer_id } });
    return { id, status: 'done' };
  }
}
