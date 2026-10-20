import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

const SUBJECT_TABLE: Record<string, string> = {
  producer: 'producers', collector: 'collectors', lot: 'lots', weighing: 'weighings', warehouse: 'warehouses', parcel: 'parcels',
};
const DEC = /^-?\d{1,14}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class RuleDto {
  @Matches(/^[A-Z0-9_]{2,40}$/) code: string;
  @IsString() @Length(2, 150) label: string;
  @IsIn(['numeric', 'boolean']) kind: string;
  @IsOptional() @IsUUID() value_chain_id?: string;
  @IsOptional() @IsString() @Length(1, 60) market?: string;
  @IsOptional() @Matches(DEC) min_value?: string;
  @IsOptional() @Matches(DEC) max_value?: string;
  @IsOptional() @IsBoolean() expected_bool?: boolean;
  @IsOptional() @IsString() @Length(1, 20) unit?: string;
  @IsOptional() @IsBoolean() blocking?: boolean;
}
class InspectionDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(Object.keys(SUBJECT_TABLE)) subject_type: string;
  @IsUUID() subject_id: string;
  @IsIn(['field', 'quality', 'compliance']) kind: string;
  @IsOptional() @Matches(DATE) scheduled_for?: string;
  @IsOptional() @IsUUID() inspector_id?: string;
}
class ResultItemDto {
  @IsUUID() rule_id: string;
  @IsOptional() @Matches(DEC) value_num?: string;
  @IsOptional() @IsBoolean() value_bool?: boolean;
  @IsOptional() @IsString() @Length(1, 300) note?: string;
}
class ResultsDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ResultItemDto) results: ResultItemDto[]; }
class CompleteDto { @IsString() @Length(3, 1000) summary: string; }
class ActionDto {
  @IsString() @Length(3, 500) description: string;
  @IsOptional() @IsUUID() responsible_id?: string;
  @Matches(DATE) due_date: string;
}
class CloseActionDto { @IsIn(['done', 'cancelled']) status: string; @IsString() @Length(3, 300) note: string; }

@ApiTags('qualité et inspections')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class QualityController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }
  private async inspection(c: PoolClient, id: string) {
    const r = await c.query(`SELECT * FROM inspections WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0];
  }

  // ---- Règles configurables par filière / marché ----
  @Post('quality-rules')
  @RequirePermissions('quality:manage')
  async createRule(@Body() b: RuleDto, @Req() req: any) {
    if (b.kind === 'numeric' && b.min_value === undefined && b.max_value === undefined) throw new BadRequestException('Une règle numérique exige un minimum et/ou un maximum');
    if (b.kind === 'boolean' && b.expected_bool === undefined) throw new BadRequestException('Une règle booléenne exige la valeur attendue');
    if (b.min_value !== undefined && b.max_value !== undefined && Number(b.min_value) > Number(b.max_value)) throw new BadRequestException('Minimum supérieur au maximum');
    try {
      const row = await this.db.tx(req.org.id, async (c) => (await c.query(
        `INSERT INTO quality_rules(organization_id, value_chain_id, market, code, label, kind, min_value, max_value, expected_bool, unit, blocking, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, b.value_chain_id ?? null, b.market ?? null, b.code, b.label, b.kind, b.min_value ?? null, b.max_value ?? null,
         b.expected_bool ?? null, b.unit ?? null, b.blocking ?? false, req.user.id])).rows[0]);
      await this.log(req, 'quality_rule.create', 'quality_rule', row.id, { code: b.code });
      return row;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Code de règle déjà utilisé');
      if (e.code === '23503') throw new BadRequestException('Filière inconnue');
      throw e;
    }
  }

  @Get('quality-rules')
  @RequirePermissions('quality:read')
  rules(@Req() req: any, @Query('value_chain_id') vc?: string, @Query('market') market?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT * FROM quality_rules WHERE active AND ($1::uuid IS NULL OR value_chain_id IS NULL OR value_chain_id = $1::uuid)
          AND ($2::text IS NULL OR market IS NULL OR market = $2) ORDER BY code`, [vc ?? null, market ?? null])).rows);
  }

  @Post('quality-rules/:id/deactivate')
  @RequirePermissions('quality:manage')
  async deactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, (c) => c.query(`UPDATE quality_rules SET active = false WHERE id = $1`, [id]));
    if (!r.rowCount) throw new NotFoundException();
    await this.log(req, 'quality_rule.deactivate', 'quality_rule', id);
    return { id, active: false };
  }

  // ---- Inspections ----
  @Post('inspections')
  @RequirePermissions('inspections:perform')
  async plan(@Body() b: InspectionDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM inspections WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) {
        const p = prev.rows[0];
        if (p.subject_id !== b.subject_id || p.subject_type !== b.subject_type || p.kind !== b.kind)
          throw new ConflictException("Cette clé d'idempotence a déjà servi pour une autre inspection");
        return { row: p, replay: true };
      }
      const ok = await c.query(`SELECT 1 FROM ${SUBJECT_TABLE[b.subject_type]} WHERE id = $1`, [b.subject_id]);
      if (!ok.rowCount) throw new BadRequestException('Objet à inspecter inconnu dans cette coopérative');
      const row = (await c.query(
        `INSERT INTO inspections(organization_id, idempotency_key, subject_type, subject_id, kind, scheduled_for, inspector_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.org.id, b.idempotency_key, b.subject_type, b.subject_id, b.kind, b.scheduled_for ?? null, b.inspector_id ?? null, req.user.id])).rows[0];
      return { row, replay: false };
    });
    if (!out.replay) await this.log(req, 'inspection.plan', 'inspection', out.row.id);
    return { ...out.row, replayed: out.replay };
  }

  @Post('inspections/:id/start')
  @RequirePermissions('inspections:perform')
  async start(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const i = await this.inspection(c, id);
      if (i.status !== 'planned') throw new BadRequestException(`Statut ${i.status} : démarrage impossible`);
      return (await c.query(`UPDATE inspections SET status = 'in_progress', started_at = now(), inspector_id = coalesce(inspector_id, $2) WHERE id = $1 RETURNING *`, [id, req.user.id])).rows[0];
    });
    await this.log(req, 'inspection.start', 'inspection', id);
    return row;
  }

  /** Les résultats sont évalués par le serveur contre les seuils de la règle ; les seuils appliqués sont conservés. */
  @Post('inspections/:id/results')
  @RequirePermissions('inspections:perform')
  async results(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResultsDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const i = await this.inspection(c, id);
      if (i.status !== 'in_progress') throw new BadRequestException("L'inspection doit être en cours pour enregistrer des résultats");
      const rows: any[] = [];
      for (const it of b.results) {
        const r = (await c.query(`SELECT * FROM quality_rules WHERE id = $1 AND active`, [it.rule_id])).rows[0];
        if (!r) throw new BadRequestException(`Règle inconnue ou désactivée : ${it.rule_id}`);
        let passed: boolean;
        if (r.kind === 'numeric') {
          if (it.value_num === undefined) throw new BadRequestException(`Valeur numérique requise pour ${r.code}`);
          passed = (await c.query(
            `SELECT ($1::numeric >= coalesce($2::numeric, $1::numeric) AND $1::numeric <= coalesce($3::numeric, $1::numeric)) AS ok`,
            [it.value_num, r.min_value, r.max_value])).rows[0].ok;
        } else {
          if (it.value_bool === undefined) throw new BadRequestException(`Valeur oui/non requise pour ${r.code}`);
          passed = it.value_bool === r.expected_bool;
        }
        try {
          rows.push((await c.query(
            `INSERT INTO inspection_results(organization_id, inspection_id, rule_id, rule_code, rule_label, blocking, applied_min, applied_max, applied_expected,
                                            value_num, value_bool, passed, note, recorded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING rule_code, passed, blocking, value_num, value_bool`,
            [req.org.id, id, r.id, r.code, r.label, r.blocking, r.min_value, r.max_value, r.expected_bool,
             it.value_num ?? null, it.value_bool ?? null, passed, it.note ?? null, req.user.id])).rows[0]);
        } catch (e: any) {
          if (e.code === '23505') throw new ConflictException(`Règle ${r.code} déjà renseignée pour cette inspection`);
          throw e;
        }
      }
      return rows;
    });
    await this.log(req, 'inspection.results', 'inspection', id, { count: out.length, failed: out.filter((r) => !r.passed).length });
    return { recorded: out, anomalies: out.filter((r) => !r.passed) };
  }

  /** Clôture : issue calculée (règle bloquante en échec → non conforme ; autre échec → à examiner). */
  @Post('inspections/:id/complete')
  @RequirePermissions('inspections:perform')
  async complete(@Param('id', ParseUUIDPipe) id: string, @Body() b: CompleteDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const i = await this.inspection(c, id);
      if (i.status !== 'in_progress') throw new BadRequestException(`Statut ${i.status} : clôture impossible`);
      const res = (await c.query(`SELECT passed, blocking FROM inspection_results WHERE inspection_id = $1`, [id])).rows;
      if (!res.length) throw new UnprocessableEntityException('Aucun résultat enregistré : clôture impossible');
      const outcome = res.some((r: any) => !r.passed && r.blocking) ? 'non_compliant' : res.some((r: any) => !r.passed) ? 'to_review' : 'compliant';
      return (await c.query(`UPDATE inspections SET status = 'completed', completed_at = now(), outcome = $2, summary = $3 WHERE id = $1 RETURNING *`, [id, outcome, b.summary])).rows[0];
    });
    await this.log(req, 'inspection.complete', 'inspection', id, { outcome: row.outcome });
    return row;
  }

  @Post('inspections/:id/cancel')
  @RequirePermissions('inspections:perform')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const i = await this.inspection(c, id);
      if (!['planned', 'in_progress'].includes(i.status)) throw new BadRequestException(`Statut ${i.status} : annulation impossible`);
      await c.query(`UPDATE inspections SET status = 'cancelled' WHERE id = $1`, [id]);
    });
    await this.log(req, 'inspection.cancel', 'inspection', id);
    return { id, status: 'cancelled' };
  }

  // ---- Actions correctives ----
  @Post('inspections/:id/actions')
  @RequirePermissions('inspections:perform')
  async addAction(@Param('id', ParseUUIDPipe) id: string, @Body() b: ActionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const i = await this.inspection(c, id);
      if (i.status === 'cancelled') throw new BadRequestException('Inspection annulée');
      return (await c.query(
        `INSERT INTO corrective_actions(organization_id, inspection_id, description, responsible_id, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.org.id, id, b.description, b.responsible_id ?? null, b.due_date, req.user.id])).rows[0];
    });
    await this.log(req, 'corrective_action.create', 'corrective_action', row.id, { inspection: id });
    return row;
  }

  @Post('corrective-actions/:id/close')
  @RequirePermissions('inspections:perform')
  async closeAction(@Param('id', ParseUUIDPipe) id: string, @Body() b: CloseActionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const r = await c.query(`SELECT status FROM corrective_actions WHERE id = $1 FOR UPDATE`, [id]);
      if (!r.rowCount) throw new NotFoundException();
      if (r.rows[0].status !== 'open') throw new BadRequestException('Action déjà clôturée');
      return (await c.query(`UPDATE corrective_actions SET status = $2, closed_at = now(), closed_by = $3, closure_note = $4 WHERE id = $1 RETURNING *`, [id, b.status, req.user.id, b.note])).rows[0];
    });
    await this.log(req, 'corrective_action.close', 'corrective_action', id, { status: b.status });
    return row;
  }

  // ---- Consultation ----
  @Get('inspections')
  @RequirePermissions('inspections:read')
  list(@Req() req: any, @Query('subject_type') st?: string, @Query('subject_id') sid?: string, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, subject_type, subject_id, kind, status, scheduled_for, outcome, completed_at, inspector_id FROM inspections
        WHERE ($1::text IS NULL OR subject_type = $1) AND ($2::uuid IS NULL OR subject_id = $2::uuid) AND ($3::text IS NULL OR status = $3)
        ORDER BY coalesce(completed_at, created_at) DESC LIMIT 500`, [st ?? null, sid ?? null, status ?? null])).rows);
  }

  @Get('inspections/:id')
  @RequirePermissions('inspections:read')
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const i = (await c.query(`SELECT * FROM inspections WHERE id = $1`, [id])).rows[0];
      if (!i) throw new NotFoundException();
      const results = (await c.query(
        `SELECT rule_code, rule_label, blocking, applied_min, applied_max, applied_expected, value_num, value_bool, passed, note, recorded_at FROM inspection_results WHERE inspection_id = $1 ORDER BY rule_code`, [id])).rows;
      const actions = (await c.query(`SELECT * FROM corrective_actions WHERE inspection_id = $1 ORDER BY created_at`, [id])).rows;
      return { ...i, results, anomalies: results.filter((r: any) => !r.passed), corrective_actions: actions };
    });
  }
}
