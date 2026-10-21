import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { DEFAULT_TRAINING_MODULES, TrainingContent } from './training-defaults';

const CROPS = ['cacao', 'cafe'];
const LEVELS = ['base', 'intermediaire', 'avance'];

export class SaveModuleDto {
  @IsString() @Length(1, 120) theme: string;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(0, 1000) summary?: string;
  @IsOptional() @IsArray() @IsIn(CROPS, { each: true }) crops?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) certifications?: string[];
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsInt() @Min(5) @Max(600) duration_min?: number;
  @IsObject() content: Record<string, unknown>;
}

/** Vérifie et normalise le contenu d'un module : objectifs, sections (titre + points), à éviter, questions de vérification. */
export function cleanContent(d: any): { error?: string; value?: TrainingContent } {
  const list = (x: any, max: number, len: number) => (Array.isArray(x) ? x.map((v) => String(v ?? '').trim()).filter(Boolean) : []).slice(0, max).map((v) => v.slice(0, len));
  if (!d || typeof d !== 'object') return { error: 'Contenu manquant' };
  const objectifs = list(d.objectifs, 10, 300);
  const sections = (Array.isArray(d.sections) ? d.sections : []).slice(0, 15).map((s: any) => ({ titre: String(s?.titre ?? '').trim().slice(0, 150), points: list(s?.points, 20, 600) })).filter((s: any) => s.titre && s.points.length);
  if (!objectifs.length) return { error: 'Au moins un objectif pédagogique est requis' };
  if (!sections.length) return { error: 'Au moins une section (titre et points) est requise' };
  return { value: { objectifs, sections, a_eviter: list(d.a_eviter, 15, 400), verifier: list(d.verifier, 15, 400), materiel: list(d.materiel, 10, 200) } };
}

/** Bibliothèque de modules de formation agricole : chargée par défaut (cacao d'abord, café ensuite), relue et adaptée par l'ADG, consultée par les coachs. */
@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('training-modules')
export class TrainingController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'training_module', entityId: id, details });
  }

  /** Charge les modules par défaut la première fois seulement (le gagnant d'une éventuelle course est celui qui crée la ligne d'état). */
  private async ensureSeeded(c: any, orgId: string) {
    const first = await c.query(`INSERT INTO training_library_state(organization_id) VALUES ($1) ON CONFLICT DO NOTHING`, [orgId]);
    if (first.rowCount) await this.insertDefaults(c, orgId, false);
  }

  private async insertDefaults(c: any, orgId: string, onlyMissing: boolean): Promise<number> {
    let n = 0;
    for (const [i, m] of DEFAULT_TRAINING_MODULES.entries()) {
      const r = await c.query(
        `INSERT INTO training_modules(organization_id, code, theme, title, summary, crops, certifications, level, duration_min, content, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (organization_id, code) DO NOTHING`,
        [orgId, m.code, m.theme, m.title, m.summary, m.crops, m.certifications, m.level, m.duration_min, JSON.stringify(m.content), i + 1]);
      n += r.rowCount ?? 0;
    }
    return n;
  }

  /** Un module venu d'un exportateur est transmis tel quel : l'ADG ne le modifie ni ne le supprime. */
  private async assertNotExporter(c: any, id: string) {
    const r = (await c.query(`SELECT submission_id FROM training_modules WHERE id = $1`, [id])).rows[0];
    if (r?.submission_id) throw new ConflictException('Module proposé par un exportateur : il est transmis tel quel et ne peut être ni modifié ni supprimé');
  }

  @Get()
  @RequirePermissions('training:read')
  list(@Req() req: any, @Query('crop') crop?: string, @Query('theme') theme?: string, @Query('certification') cert?: string, @Query('q') q?: string) {
    if (crop && !CROPS.includes(crop)) throw new BadRequestException('Culture inconnue');
    return this.db.tx(req.org.id, async (c) => {
      await this.ensureSeeded(c, req.org.id);
      return (await c.query(
        `SELECT m.id, m.code, m.theme, m.title, m.summary, m.crops, m.certifications, m.level, m.duration_min, m.content, m.review_state, m.version, m.reviewed_at, m.updated_at, m.submission_id,
                u.full_name AS reviewed_by_name, (SELECT x.full_name FROM training_submissions s JOIN users x ON x.id = s.submitted_by WHERE s.id = m.submission_id) AS proposed_by_name
           FROM training_modules m LEFT JOIN users u ON u.id = m.reviewed_by
          WHERE ($1::text IS NULL OR $1 = ANY(m.crops)) AND ($2::text IS NULL OR m.theme = $2) AND ($3::text IS NULL OR $3 = ANY(m.certifications))
            AND ($4::text IS NULL OR m.title ILIKE '%' || $4 || '%' OR m.summary ILIKE '%' || $4 || '%')
          ORDER BY m.sort, m.title`, [crop ?? null, theme ?? null, cert ?? null, q?.trim() || null])).rows;
    });
  }

  @Get(':id')
  @RequirePermissions('training:read')
  async one(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = (await this.db.tx(req.org.id, (c) => c.query(`SELECT * FROM training_modules WHERE id = $1`, [id]))).rows[0];
    if (!r) throw new NotFoundException('Module introuvable');
    return r;
  }

  @Post()
  @RequirePermissions('training:manage')
  async create(@Body() b: SaveModuleDto, @Req() req: any) {
    const cc = cleanContent(b.content); if (cc.error) throw new BadRequestException(cc.error);
    const row = (await this.db.tx(req.org.id, async (c) => {
      await this.ensureSeeded(c, req.org.id);
      return c.query(
        `INSERT INTO training_modules(organization_id, theme, title, summary, crops, certifications, level, duration_min, content, sort, review_state, updated_by, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(sort),0)+1 FROM training_modules),'custom',$10,$10,now()) RETURNING *`,
        [req.org.id, b.theme.trim(), b.title.trim(), (b.summary ?? '').trim(), b.crops?.length ? [...new Set(b.crops)] : ['cacao'], [...new Set((b.certifications ?? []).map((x) => x.trim()).filter(Boolean))], b.level ?? 'base', b.duration_min ?? 45, JSON.stringify(cc.value), req.user.id]);
    })).rows[0];
    await this.log(req, 'training_module.create', row.id, { title: row.title });
    return row;
  }

  @Put(':id')
  @RequirePermissions('training:manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() b: SaveModuleDto, @Req() req: any) {
    const cc = cleanContent(b.content); if (cc.error) throw new BadRequestException(cc.error);
    const row = (await this.db.tx(req.org.id, async (c) => { await this.assertNotExporter(c, id); return c.query(
      `UPDATE training_modules SET theme = $2, title = $3, summary = $4, crops = $5, certifications = $6, level = $7, duration_min = $8, content = $9,
              review_state = CASE WHEN review_state = 'custom' THEN 'custom' ELSE 'edited' END, version = version + 1, updated_by = $10, reviewed_by = $10, reviewed_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, b.theme.trim(), b.title.trim(), (b.summary ?? '').trim(), b.crops?.length ? [...new Set(b.crops)] : ['cacao'], [...new Set((b.certifications ?? []).map((x) => x.trim()).filter(Boolean))], b.level ?? 'base', b.duration_min ?? 45, JSON.stringify(cc.value), req.user.id]); })).rows[0];
    if (!row) throw new NotFoundException('Module introuvable');
    await this.log(req, 'training_module.update', id, { title: row.title, version: row.version });
    return row;
  }

  /** « Conserver » : l'ADG a relu le module et le garde tel quel. */
  @Post(':id/keep')
  @RequirePermissions('training:manage')
  async keep(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const row = (await this.db.tx(req.org.id, (c) => c.query(
      `UPDATE training_modules SET review_state = CASE WHEN review_state = 'to_review' THEN 'kept' ELSE review_state END, reviewed_by = $2, reviewed_at = now() WHERE id = $1 RETURNING id, review_state, reviewed_at`, [id, req.user.id]))).rows[0];
    if (!row) throw new NotFoundException('Module introuvable');
    await this.log(req, 'training_module.keep', id);
    return row;
  }

  @Delete(':id')
  @RequirePermissions('training:manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const row = (await this.db.tx(req.org.id, async (c) => { await this.assertNotExporter(c, id); return c.query(`DELETE FROM training_modules WHERE id = $1 RETURNING id, title, code`, [id]); })).rows[0];
    if (!row) throw new NotFoundException('Module introuvable');
    await this.log(req, 'training_module.delete', id, { title: row.title, code: row.code });
    return { deleted: true };
  }

  /** Recharge les modules par défaut qui ont disparu (les modules existants, même modifiés, ne sont jamais touchés). */
  @Post('restore-defaults')
  @RequirePermissions('training:manage')
  async restore(@Req() req: any) {
    const n = await this.db.tx(req.org.id, async (c) => { await this.ensureSeeded(c, req.org.id); return this.insertDefaults(c, req.org.id, true); });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'training_module.restore_defaults', entityType: 'organization', entityId: req.org.id, details: { restored: n } });
    return { restored: n };
  }
}
