import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as ExcelJS from 'exceljs';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ASSIGNMENT_TEMPLATES } from './assignment-templates';

const KIND_FR: Record<string, string> = { formation: 'Formation', distribution: 'Distribution', tache: 'Tâche', inspection: 'Inspection interne', service: 'Service' };
export const KINDS = ['formation', 'distribution', 'tache', 'inspection', 'service'];
export class AssignTargetDto {
  @IsIn(KINDS) kind: string;
  @IsIn(['all', 'selected']) scope: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) producer_ids?: string[];
  @IsOptional() @IsISO8601({ strict: true }) due_date?: string;
  @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
}
export class CoachingProgramDto {
  @IsIn(['all', 'selected']) scope: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) producer_ids?: string[];
  @IsOptional() @IsISO8601({ strict: true }) start_date?: string;
  @IsOptional() @IsInt() @Min(7) @Max(180) interval_days?: number;
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
  const label = a.kind === 'formation' ? 'Module de formation' : a.kind === 'distribution' ? 'Distribution' : a.kind === 'inspection' ? 'Inspection interne' : a.kind === 'service' ? 'Service' : 'Tâche';
  await notif.notifyPermission(c, orgId, 'training:report', { kind: 'producer_assignment', title: `${label} ajouté(e) au profil de ${ids.length} producteur(s)`, body: a.title, entityType: 'producer_assignment', entityId: row.id }, userId);
  return { ...row, targets: ids.length };
}

@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('producer-assignments')
export class ProducerAssignmentsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  /** Modèles préchargés de distributions et de services (à adapter à l'envoi). */
  /** Toutes les tâches (formations, distributions, tâches, inspections, services) avec leur avancement, une ligne par producteur. */
  @Get('export')
  @RequirePermissions('training:assign')
  async exportAll(@Req() req: any) {
    const rows = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT a.kind, a.title, a.instructions, a.due_date, a.created_at, q.title AS questionnaire, p.internal_code, p.last_name, p.first_names, p.village,
              t.status, t.done_at, t.needs_redo, an.score
         FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id JOIN producers p ON p.id = t.producer_id
         LEFT JOIN questionnaires q ON q.id = a.questionnaire_id LEFT JOIN questionnaire_answers an ON an.target_id = t.id
        ORDER BY a.created_at DESC, p.last_name, p.first_names LIMIT 50000`)).rows);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Tâches');
    ws.addRow(['Titre', 'Type', 'Questionnaire', 'Échéance', 'Consignes', 'Code producteur', 'Nom', 'Prénoms', 'Village', 'Statut', 'Fait le', 'Score de conformité (%)']); ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow([r.title, KIND_FR[r.kind] ?? r.kind, r.questionnaire ?? '', r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '', r.instructions, r.internal_code, r.last_name, r.first_names, r.village ?? '',
      r.status === 'done' ? 'Fait' : r.needs_redo ? 'À reprendre' : 'À faire', r.done_at ? new Date(r.done_at).toISOString().slice(0, 10) : '', r.score ?? '']);
    ws.columns.forEach((c) => (c.width = 24));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer_assignment.export', entityType: 'producer_assignment', entityId: req.org.id, details: { rows: rows.length } });
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="taches.xlsx"' });
  }

  @Get('import-template')
  @RequirePermissions('training:assign')
  async importTemplate() {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Tâches');
    ws.addRow(['Titre', 'Type', 'Questionnaire ou module', 'Échéance (AAAA-MM-JJ)', 'Consignes', 'Codes producteurs (séparés par ;, vide = tous)']); ws.getRow(1).font = { bold: true };
    ws.addRow(['Visite de suivi de la parcelle', 'Tâche', 'Titre exact du questionnaire', '2026-12-15', 'Passer avant la récolte', 'P00001; P00002']);
    ws.addRow(['Distribution de plants', 'Distribution', '', '', 'Selon la liste de la coopérative', '']);
    ws.columns.forEach((c) => (c.width = 34));
    const help = wb.addWorksheet('Instructions');
    for (const l of ['Une ligne = une tâche. Les producteurs sont désignés par leur code producteur (colonne vide = tous les producteurs actifs).',
      'Type : Tâche, Formation, Distribution, Inspection interne ou Service.',
      'Questionnaire ou module : titre exact d\'un questionnaire existant (tâche, inspection) ou d\'un module de la bibliothèque (formation).',
      'Une formation exige un module existant. Les lignes en erreur sont ignorées et listées dans le compte rendu.']) help.addRow([l]);
    help.getColumn(1).width = 120;
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="modele-import-taches.xlsx"' });
  }

  /** Importation de tâches : une ligne par tâche, affectée aux producteurs désignés par leur code (ou à tous). */
  @Post('import')
  @RequirePermissions('training:assign')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async importFile(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier requis (champ « file »)');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer as any); } catch { throw new BadRequestException('Fichier illisible (Excel .xlsx attendu)'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Fichier vide');
    const txt = (v: ExcelJS.CellValue): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? String((v as any).text ?? (v as any).result ?? '') : String(v)).trim();
    const flat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const heads: string[] = []; ws.getRow(1).eachCell((cell, n) => (heads[n - 1] = flat(txt(cell.value))));
    const col = (...names: string[]) => heads.findIndex((h) => h && names.some((n) => h.startsWith(n)));
    const cT = col('titre'), cK = col('type'), cQ = col('questionnaire', 'module'), cD = col('echeance'), cI = col('consigne'), cP = col('code');
    if (cT < 0) throw new BadRequestException('Colonne « Titre » introuvable : utilisez le modèle.');
    const kindOf: Record<string, string> = { tache: 'tache', formation: 'formation', distribution: 'distribution', inspection: 'inspection', 'inspection interne': 'inspection', service: 'service' };
    const issues: { row: number; message: string }[] = []; let created = 0;
    const lines: { n: number; title: string; kind: string; ref: string; due: string; instr: string; codes: string[] }[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const title = txt(row.getCell(cT + 1).value); if (!title) return;
      lines.push({ n, title, kind: kindOf[flat(cK >= 0 ? txt(row.getCell(cK + 1).value) : 'tache') || 'tache'] ?? '', ref: cQ >= 0 ? txt(row.getCell(cQ + 1).value) : '', due: cD >= 0 ? txt(row.getCell(cD + 1).value) : '',
        instr: cI >= 0 ? txt(row.getCell(cI + 1).value) : '', codes: cP >= 0 ? txt(row.getCell(cP + 1).value).split(/[;,\n]/).map((x) => x.trim()).filter(Boolean) : [] });
    });
    if (lines.length > 500) throw new BadRequestException('500 tâches au maximum par fichier');
    await this.db.tx(req.org.id, async (c) => {
      for (const l of lines) {
        try {
          if (!l.kind) throw new BadRequestException('Type inconnu (Tâche, Formation, Distribution, Inspection interne, Service)');
          if (l.due && !/^\d{4}-\d{2}-\d{2}$/.test(l.due)) throw new BadRequestException('Échéance : format AAAA-MM-JJ attendu');
          let questionnaire_id: string | null = null, module_id: string | null = null, kind = l.kind;
          if (l.ref) {
            const q = (await c.query(`SELECT id, template_code FROM questionnaires WHERE lower(title) = lower($1) AND NOT archived LIMIT 1`, [l.ref])).rows[0];
            if (q) { questionnaire_id = q.id; kind = String(q.template_code ?? '').startsWith('ii-') ? 'inspection' : kind === 'inspection' ? 'inspection' : 'tache'; }
            else { const m = (await c.query(`SELECT id FROM training_modules WHERE lower(title) = lower($1) LIMIT 1`, [l.ref])).rows[0]; if (m) module_id = m.id; else throw new BadRequestException(`« ${l.ref} » : aucun questionnaire ni module de ce titre`); }
          }
          if (kind === 'formation' && !module_id) throw new BadRequestException('Une formation exige un module de la bibliothèque');
          let producer_ids: string[] | undefined;
          if (l.codes.length) {
            const found = (await c.query(`SELECT id, internal_code FROM producers WHERE internal_code = ANY($1::text[])`, [l.codes])).rows;
            const missing = l.codes.filter((x) => !found.some((f: any) => f.internal_code === x));
            if (missing.length) throw new BadRequestException(`Code(s) producteur inconnu(s) : ${missing.join(', ')}`);
            producer_ids = found.map((f: any) => f.id);
          }
          await c.query('SAVEPOINT imp');
          try { await createAssignment(c, req.org.id, req.user.id, this.notif, { kind, scope: producer_ids ? 'selected' : 'all', producer_ids, due_date: l.due || undefined, instructions: l.instr, title: l.title, module_id, questionnaire_id }); await c.query('RELEASE SAVEPOINT imp'); created++; }
          catch (e) { await c.query('ROLLBACK TO SAVEPOINT imp'); throw e; }
        } catch (e: any) { issues.push({ row: l.n, message: String(e?.response?.message ?? e?.message ?? e) }); }
      }
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer_assignment.import', entityType: 'producer_assignment', entityId: req.org.id, details: { created, issues: issues.length } });
    return { created, skipped: issues.length, issues };
  }

  @Get('templates')
  @RequirePermissions('training:assign')
  templates(@Query('kind') kind?: string) {
    return ASSIGNMENT_TEMPLATES.filter((t) => !kind || t.kind === kind);
  }

  /** « Implémenter un modèle » : l'ADG affecte un module de la bibliothèque (ou une distribution / tâche libre) à tous les producteurs ou à certains. */
  @Post()
  @RequirePermissions('training:assign')
  async create(@Body() b: AssignDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      let title = b.title?.trim();
      if (b.questionnaire_id) {
        const q = (await c.query(`SELECT title, template_code FROM questionnaires WHERE id = $1 AND NOT archived`, [b.questionnaire_id])).rows[0];
        if (!q) throw new NotFoundException('Questionnaire introuvable ou archivé');
        title = title || q.title; b.kind = String(q.template_code ?? '').startsWith('ii-') ? 'inspection' : 'tache'; // les fiches d'inspection interne apparaissent comme telles dans les tâches du producteur
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

  /** Programme de coaching agricole en six étapes (diagnostic, PDE, formation BPA, champ école, suivi, évaluation) : six tâches espacées, créées d'un coup pour les mêmes producteurs. */
  @Post('coaching-program')
  @RequirePermissions('training:assign')
  async coachingProgram(@Body() b: CoachingProgramDto, @Req() req: any) {
    const codes = ['coaching-1-diagnostic', 'coaching-2-pde', 'coaching-3-bpa', 'coaching-4-cep', 'coaching-5-suivi', 'coaching-6-evaluation'];
    const gap = b.interval_days ?? 30;
    const start = b.start_date ? new Date(b.start_date) : new Date(Date.now() + 7 * 86400000);
    const out = await this.db.tx(req.org.id, async (c) => {
      const qs = (await c.query(`SELECT id, title, template_code, archived FROM questionnaires WHERE template_code = ANY($1::text[])`, [codes])).rows;
      const steps = codes.map((code) => qs.find((q: any) => q.template_code === code));
      if (steps.some((q: any) => !q)) throw new NotFoundException('Les questionnaires du coaching ne sont pas chargés : ouvrez la page « Questionnaires » puis réessayez.');
      if (steps.some((q: any) => q.archived)) throw new BadRequestException('Une étape du coaching est archivée : réactivez-la dans « Questionnaires ».');
      const made: any[] = [];
      for (const [i, q] of steps.entries()) {
        const due = new Date(start.getTime() + i * gap * 86400000).toISOString().slice(0, 10);
        made.push(await createAssignment(c, req.org.id, req.user.id, this.notif, {
          kind: 'tache', scope: b.scope, producer_ids: b.producer_ids, due_date: due, title: q.title, module_id: null, questionnaire_id: q.id,
          instructions: `${b.instructions ? b.instructions.trim() + ' — ' : ''}Étape ${i + 1} sur 6 du coaching agricole.`,
        } as any));
      }
      return made;
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'producer_assignment.coaching_program', entityType: 'producer_assignment', entityId: out[0].id, details: { scope: b.scope, steps: codes.length, interval_days: gap } });
    return { assignments: out.map((o: any) => ({ id: o.id, title: o.title, due_date: o.due_date })) };
  }

  /** Éléments ajoutés au profil d'un producteur (ou liste des affectations avec leur avancement). */
  @Get()
  async list(@Req() req: any, @Query('producer_id') producerId?: string, @Query('mine') mine?: string, @Query('compact') compact?: string) {
    const p = req.org.permissions;
    if (!['training:assign', 'training:report', 'training:read', 'producers:read'].some((x) => p.has(x))) throw new ForbiddenException('Droit insuffisant');
    if (producerId && !/^[0-9a-f-]{36}$/i.test(producerId)) throw new BadRequestException('producer_id invalide');
    if (mine === '1') {
      // Copie pour le travail hors connexion : tous les éléments à faire des profils (et les faits récents), à plat, avec le producteur.
      if (compact === '1') {
        // Format léger : les questions de chaque questionnaire ne sont envoyées qu'une fois (et non répétées pour chaque producteur ciblé).
        return this.db.tx(req.org.id, async (c) => {
          const assignments = (await c.query(
            `SELECT t.id AS target_id, t.producer_id, t.status, t.needs_redo, t.redo_reason, t.done_at, a.id, a.kind, a.title, a.instructions, a.due_date, a.created_at, a.questionnaire_id, an.answers
             FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id
             LEFT JOIN questionnaire_answers an ON an.target_id = t.id
            WHERE t.status = 'pending' OR t.done_at > now() - interval '60 days'
            ORDER BY a.created_at DESC LIMIT 20000`)).rows;
          const ids = [...new Set(assignments.map((r: any) => r.questionnaire_id).filter(Boolean))];
          const questionnaires: Record<string, unknown> = {};
          if (ids.length) for (const r of (await c.query(`SELECT id, questions FROM questionnaires WHERE id = ANY($1::uuid[])`, [ids])).rows) questionnaires[r.id] = r.questions;
          return { assignments, questionnaires };
        });
      }
      return this.db.tx(req.org.id, async (c) => (await c.query(
        `SELECT t.id AS target_id, t.producer_id, t.status, t.needs_redo, t.redo_reason, t.done_at, a.id, a.kind, a.title, a.instructions, a.due_date, a.created_at, a.questionnaire_id, q.questions, an.answers
         FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id LEFT JOIN questionnaires q ON q.id = a.questionnaire_id
         LEFT JOIN questionnaire_answers an ON an.target_id = t.id ORDER BY a.created_at DESC LIMIT 5000`)).rows);
    }
    return this.db.tx(req.org.id, async (c) => producerId
      ? (await c.query(
        `SELECT t.id AS target_id, t.status, t.needs_redo, t.redo_reason, t.done_at, a.id, a.kind, a.scope, a.title, a.instructions, a.due_date, a.module_id, a.created_at, a.questionnaire_id, q.questions, an.answers
         FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id LEFT JOIN questionnaires q ON q.id = a.questionnaire_id
         LEFT JOIN questionnaire_answers an ON an.target_id = t.id WHERE t.producer_id = $1 ORDER BY (t.status = 'done'), a.created_at DESC`, [producerId])).rows
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
