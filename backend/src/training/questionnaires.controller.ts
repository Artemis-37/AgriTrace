import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString, Length } from 'class-validator';
import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { QUESTIONNAIRE_TEMPLATES } from './questionnaire-templates';

export type QType = 'text' | 'number' | 'yesno' | 'choice' | 'multi' | 'date';
export interface Question { id: string; label: string; type: QType; options?: string[]; required: boolean }
export const QTYPES: Record<QType, string> = { text: 'Texte', number: 'Nombre', yesno: 'Oui / Non', choice: 'Choix unique', multi: 'Choix multiple', date: 'Date' };

const TYPE_ALIASES: Record<string, QType> = {
  texte: 'text', text: 'text', libre: 'text', nombre: 'number', number: 'number', numerique: 'number', numérique: 'number',
  'oui/non': 'yesno', 'oui / non': 'yesno', ouinon: 'yesno', yesno: 'yesno', booleen: 'yesno', booléen: 'yesno',
  choix: 'choice', 'choix unique': 'choice', choice: 'choice', liste: 'choice', 'choix multiple': 'multi', multiple: 'multi', multi: 'multi', date: 'date',
};
const flat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Contrôle et normalise les questions (identifiants q1, q2… attribués dans l'ordre). */
export function cleanQuestions(raw: any[]): Question[] {
  if (!Array.isArray(raw) || !raw.length) throw new BadRequestException('Ajoutez au moins une question');
  if (raw.length > 200) throw new BadRequestException('200 questions au maximum');
  return raw.map((q, i) => {
    const label = String(q?.label ?? '').trim();
    if (label.length < 2 || label.length > 300) throw new BadRequestException(`Question ${i + 1} : intitulé de 2 à 300 caractères`);
    const type = (TYPE_ALIASES[flat(String(q?.type ?? 'text'))] ?? null) as QType | null;
    if (!type) throw new BadRequestException(`Question ${i + 1} : type inconnu « ${q?.type} » (texte, nombre, oui/non, choix, choix multiple, date)`);
    let options: string[] | undefined;
    if (type === 'choice' || type === 'multi') {
      options = [...new Set((Array.isArray(q.options) ? q.options : String(q.options ?? '').split(/[;|\n]/)).map((o: any) => String(o).trim()).filter(Boolean))] as string[];
      if (options.length < 2) throw new BadRequestException(`Question ${i + 1} : au moins deux choix sont nécessaires`);
    }
    return { id: `q${i + 1}`, label, type, ...(options ? { options } : {}), required: q?.required === true || /^(oui|o|yes|true|1|x)$/i.test(String(q?.required ?? '').trim()) };
  });
}

/** Valide les réponses d'un coach par rapport au questionnaire. */
export function checkAnswers(questions: Question[], answers: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const q of questions) {
    let v = answers?.[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required) throw new BadRequestException(`Réponse obligatoire : « ${q.label} »`); continue; }
    if (q.type === 'text') { v = String(v).trim().slice(0, 2000); }
    else if (q.type === 'number') { const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) throw new BadRequestException(`« ${q.label} » : un nombre est attendu`); v = n; }
    else if (q.type === 'yesno') { if (!['oui', 'non'].includes(String(v).toLowerCase())) throw new BadRequestException(`« ${q.label} » : répondre oui ou non`); v = String(v).toLowerCase(); }
    else if (q.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new BadRequestException(`« ${q.label} » : date AAAA-MM-JJ attendue`); v = String(v); }
    else if (q.type === 'choice') { if (!q.options!.includes(String(v))) throw new BadRequestException(`« ${q.label} » : choix invalide`); v = String(v); }
    else if (q.type === 'multi') { const a = (Array.isArray(v) ? v : [v]).map(String); if (a.some((x) => !q.options!.includes(x))) throw new BadRequestException(`« ${q.label} » : choix invalide`); v = a; }
    out[q.id] = v;
  }
  return out;
}

export class CreateQuestionnaireDto {
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsArray() questions: any[];
}
export class AnswerDto { @IsObject() answers: Record<string, any>; }

@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('questionnaires')
export class QuestionnairesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private readAccess(req: any) {
    if (!['questionnaires:manage', 'training:assign', 'training:report', 'training:read'].some((x) => req.org.permissions.has(x))) throw new ForbiddenException('Droit insuffisant');
  }

  @Get()
  async list(@Req() req: any) {
    this.readAccess(req);
    await this.ensureTemplates(req);
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT q.id, q.title, q.description, jsonb_array_length(q.questions)::int AS question_count, q.archived, q.created_at, q.template_code, q.updated_at,
              (SELECT count(*)::int FROM producer_assignments a WHERE a.questionnaire_id = q.id) AS assignments
         FROM questionnaires q ORDER BY q.archived, q.created_at DESC LIMIT 300`)).rows);
  }

  /** Charge les questionnaires types qui manquent (un modèle déjà chargé, même modifié ou archivé, n'est jamais refait ni écrasé). */
  private async ensureTemplates(req: any, force = false): Promise<number> {
    if (!force && !req.org.permissions.has('questionnaires:manage')) return 0;
    return this.db.tx(req.org.id, async (c) => {
      const have = new Set((await c.query(`SELECT template_code FROM questionnaires WHERE template_code IS NOT NULL`)).rows.map((r: any) => r.template_code));
      let n = 0;
      for (const t of QUESTIONNAIRE_TEMPLATES) {
        if (have.has(t.code)) continue;
        const r = await c.query(
          `INSERT INTO questionnaires(organization_id, title, description, questions, created_by, template_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [req.org.id, t.title, t.description, JSON.stringify(t.questions), req.user.id, t.code]);
        n += r.rowCount ?? 0;
      }
      return n;
    });
  }

  /** Recharge les modèles types manquants (ceux déjà présents, modifiés ou archivés, ne sont pas touchés). */
  @Post('defaults')
  @RequirePermissions('questionnaires:manage')
  async defaults(@Req() req: any) {
    const added = await this.ensureTemplates(req, true);
    if (added) await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'questionnaire.defaults', entityType: 'questionnaire', entityId: req.org.id, details: { added } });
    return { added };
  }

  /** Modèle Excel pour l'importation : une ligne par question. */
  @Get('template')
  @RequirePermissions('questionnaires:manage')
  async template() {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Questionnaire');
    ws.addRow(['Question', 'Type', 'Choix (séparés par ;)', 'Obligatoire']); ws.getRow(1).font = { bold: true };
    ws.addRow(['Combien de parcelles de cacao exploitez-vous ?', 'Nombre', '', 'oui']);
    ws.addRow(['Utilisez-vous des engrais ?', 'Oui/Non', '', 'oui']);
    ws.addRow(['Quelle est votre principale difficulté ?', 'Choix', 'Maladies; Manque de main-d\'œuvre; Prix; Autre', 'non']);
    ws.addRow(['Quels équipements possédez-vous ?', 'Choix multiple', 'Sécateur; Pulvérisateur; Bâche de séchage', 'non']);
    ws.addRow(['Date de la dernière récolte', 'Date', '', 'non']);
    ws.addRow(['Observations du coach', 'Texte', '', 'non']);
    ws.columns.forEach((c) => (c.width = 36));
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment; filename="modele-questionnaire.xlsx"' });
  }

  @Post()
  @RequirePermissions('questionnaires:manage')
  async create(@Body() b: CreateQuestionnaireDto, @Req() req: any) {
    const questions = cleanQuestions(b.questions);
    return this.insert(req, b.title.trim(), (b.description ?? '').trim(), questions, 'create');
  }

  /** Importation : Excel (.xlsx) ou CSV ; colonnes Question, Type, Choix, Obligatoire. */
  @Post('import')
  @RequirePermissions('questionnaires:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async importFile(@UploadedFile() file: Express.Multer.File, @Body('title') title: string, @Body('description') description: string, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier requis (champ « file »)');
    const name = (title ?? '').trim() || file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const wb = new ExcelJS.Workbook();
    try {
      if (/\.csv$/i.test(file.originalname)) {
        const text = file.buffer.toString('utf8');
        await wb.csv.read(Readable.from([text]), { parserOptions: { delimiter: text.split('\n')[0].includes(';') ? ';' : ',' } });
      } else await wb.xlsx.load(file.buffer as any);
    } catch { throw new BadRequestException('Fichier illisible (Excel .xlsx ou CSV attendu)'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Fichier vide');
    const txt = (v: ExcelJS.CellValue): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? String((v as any).text ?? (v as any).result ?? '') : String(v)).trim();
    const heads: string[] = []; ws.getRow(1).eachCell((cell, n) => (heads[n - 1] = flat(txt(cell.value))));
    const col = (...names: string[]) => heads.findIndex((h) => h && names.some((n) => h.startsWith(n)));
    const cQ = col('question', 'intitule', 'libelle'), cT = col('type'), cO = col('choix', 'option'), cR = col('obligatoire', 'requis');
    if (cQ < 0) throw new BadRequestException({ message: 'Colonne « Question » introuvable : utilisez le modèle.', headers: heads.filter(Boolean) });
    const raw: any[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const label = txt(row.getCell(cQ + 1).value); if (!label) return;
      raw.push({ label, type: cT >= 0 ? txt(row.getCell(cT + 1).value) || 'texte' : 'texte', options: cO >= 0 ? txt(row.getCell(cO + 1).value) : '', required: cR >= 0 ? txt(row.getCell(cR + 1).value) : '' });
    });
    return this.insert(req, name.slice(0, 200).padEnd(3, ' '), (description ?? '').trim(), cleanQuestions(raw), 'import');
  }

  private async insert(req: any, title: string, description: string, questions: Question[], how: string) {
    const row = await this.db.tx(req.org.id, async (c) => (await c.query(
      `INSERT INTO questionnaires(organization_id, title, description, questions, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.org.id, title, description, JSON.stringify(questions), req.user.id])).rows[0]);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: `questionnaire.${how}`, entityType: 'questionnaire', entityId: row.id, details: { questions: questions.length } });
    return row;
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.readAccess(req);
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, title, description, questions, archived, template_code, created_at, updated_at,
              (SELECT count(*)::int FROM producer_assignments a WHERE a.questionnaire_id = questionnaires.id) AS assignments FROM questionnaires WHERE id = $1`, [id])).rows[0]);
    if (!r) throw new NotFoundException();
    return r;
  }

  /** Modification : le titre et la description sont libres ; les questions ne changent plus une fois le questionnaire envoyé (les réponses reçues resteraient incohérentes) — il faut alors le dupliquer. */
  @Post(':id/update')
  @RequirePermissions('questionnaires:manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: CreateQuestionnaireDto, @Req() req: any) {
    const questions = cleanQuestions(b.questions);
    const r = await this.db.tx(req.org.id, async (c) => {
      const cur = (await c.query(`SELECT questions, (SELECT count(*)::int FROM producer_assignments a WHERE a.questionnaire_id = questionnaires.id) AS sent FROM questionnaires WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw new NotFoundException();
      if (cur.sent > 0 && JSON.stringify(cur.questions) !== JSON.stringify(questions))
        throw new BadRequestException('Ce questionnaire a déjà été envoyé : ses questions ne peuvent plus changer. Dupliquez-le pour en créer une nouvelle version.');
      return (await c.query(`UPDATE questionnaires SET title = $2, description = $3, questions = $4, updated_at = now() WHERE id = $1 RETURNING *`, [id, b.title.trim(), (b.description ?? '').trim(), JSON.stringify(questions)])).rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'questionnaire.update', entityType: 'questionnaire', entityId: id, details: { questions: questions.length } });
    return r;
  }

  @Post(':id/duplicate')
  @RequirePermissions('questionnaires:manage')
  async duplicate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const src = await this.db.tx(req.org.id, async (c) => (await c.query(`SELECT title, description, questions FROM questionnaires WHERE id = $1`, [id])).rows[0]);
    if (!src) throw new NotFoundException();
    return this.insert(req, `${src.title} (copie)`.slice(0, 200), src.description, src.questions, 'duplicate');
  }

  @Post(':id/archive')
  @RequirePermissions('questionnaires:manage')
  async archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE questionnaires SET archived = NOT archived WHERE id = $1 RETURNING id, archived`, [id])).rows[0]);
    if (!r) throw new NotFoundException();
    return r;
  }

  /** Questionnaire et réponse éventuelle pour un producteur ciblé (le coach le remplit auprès du producteur). */
  @Get('targets/:targetId')
  async target(@Param('targetId', ParseUUIDPipe) targetId: string, @Req() req: any) {
    this.readAccess(req);
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT t.id AS target_id, t.status, t.producer_id, a.id AS assignment_id, a.title, a.instructions, a.due_date, q.id AS questionnaire_id, q.questions,
              an.answers, an.answered_at, p.internal_code, p.last_name, p.first_names
         FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id JOIN questionnaires q ON q.id = a.questionnaire_id
         JOIN producers p ON p.id = t.producer_id LEFT JOIN questionnaire_answers an ON an.target_id = t.id WHERE t.id = $1`, [targetId])).rows[0]);
    if (!r) throw new NotFoundException('Questionnaire introuvable');
    return r;
  }

  @Post('targets/:targetId/answers')
  async answer(@Param('targetId', ParseUUIDPipe) targetId: string, @Body() b: AnswerDto, @Req() req: any) {
    if (!['training:report', 'training:assign'].some((x) => req.org.permissions.has(x))) throw new ForbiddenException('Droit insuffisant');
    const out = await this.db.tx(req.org.id, async (c) => {
      const t = (await c.query(
        `SELECT t.id, t.status, t.assignment_id, t.producer_id, q.questions FROM producer_assignment_targets t JOIN producer_assignments a ON a.id = t.assignment_id
           JOIN questionnaires q ON q.id = a.questionnaire_id WHERE t.id = $1 FOR UPDATE OF t`, [targetId])).rows[0];
      if (!t) throw new NotFoundException('Questionnaire introuvable');
      if (t.status === 'done') throw new BadRequestException('Ce questionnaire a déjà été renseigné pour ce producteur');
      const answers = checkAnswers(t.questions, b.answers);
      await c.query(`INSERT INTO questionnaire_answers(organization_id, target_id, assignment_id, producer_id, answers, answered_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.org.id, targetId, t.assignment_id, t.producer_id, JSON.stringify(answers), req.user.id]);
      await c.query(`UPDATE producer_assignment_targets SET status = 'done', done_at = now(), done_by = $2 WHERE id = $1`, [targetId, req.user.id]);
      return { target_id: targetId, status: 'done', answered: Object.keys(answers).length, assignment_id: t.assignment_id, producer_id: t.producer_id };
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'questionnaire.answer', entityType: 'producer_assignment', entityId: out.assignment_id, details: { producer_id: out.producer_id } });
    return out;
  }

  /** Résultats d'une affectation : une ligne par producteur, une colonne par question (JSON ou ?format=csv). */
  @Get('assignments/:assignmentId/results')
  async results(@Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Req() req: any, @Query('format') format?: string) {
    this.readAccess(req);
    const d = await this.db.tx(req.org.id, async (c) => {
      const a = (await c.query(`SELECT a.id, a.title, q.questions FROM producer_assignments a JOIN questionnaires q ON q.id = a.questionnaire_id WHERE a.id = $1`, [assignmentId])).rows[0];
      if (!a) throw new NotFoundException('Affectation introuvable');
      const rows = (await c.query(
        `SELECT p.internal_code, p.last_name, p.first_names, p.village, t.status, an.answers, an.answered_at, u.full_name AS answered_by
           FROM producer_assignment_targets t JOIN producers p ON p.id = t.producer_id LEFT JOIN questionnaire_answers an ON an.target_id = t.id
           LEFT JOIN users u ON u.id = an.answered_by WHERE t.assignment_id = $1 ORDER BY p.last_name, p.first_names`, [assignmentId])).rows;
      return { ...a, rows };
    });
    if (format !== 'csv') return d;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const val = (v: any) => (Array.isArray(v) ? v.join(' ; ') : v);
    const lines = [['Code', 'Nom', 'Prénoms', 'Village', 'État', 'Renseigné le', 'Par', ...d.questions.map((q: Question) => q.label)].map(esc).join(';')];
    for (const r of d.rows) lines.push([r.internal_code, r.last_name, r.first_names, r.village, r.status === 'done' ? 'Fait' : 'À faire', r.answered_at ? new Date(r.answered_at).toISOString().slice(0, 10) : '', r.answered_by, ...d.questions.map((q: Question) => val(r.answers?.[q.id]))].map(esc).join(';'));
    return new StreamableFile(Buffer.from('﻿' + lines.join('\r\n')), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="resultats-questionnaire.csv"` });
  }
}
