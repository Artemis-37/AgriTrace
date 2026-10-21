import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

export const FIELD_KINDS = ['social_infrastructure', 'training', 'distribution'] as const;

export class CreateFieldRecordDto {
  /** Identifiant fourni par l'appareil. */
  @IsUUID() id: string;
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(FIELD_KINDS as unknown as string[]) kind: string;
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsObject() data: Record<string, unknown>;
}

export class CreateArticleDto {
  @IsString() @Length(1, 80) category: string;
  @IsString() @Length(1, 80) group_name: string;
  @IsString() @Length(1, 150) name: string;
  @IsOptional() @IsString() @Length(1, 30) unit?: string;
}

const MAX_DATA_BYTES = 20_000;

/** Enregistrements de terrain : infrastructures sociales, formations, distributions, et catalogue des articles distribuables. */
@ApiTags('terrain')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class FieldRecordsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  /** Appelé aussi par la synchronisation (`field_record.create`) : idempotent sur l'identifiant et la clé. */
  async create(b: CreateFieldRecordDto, req: any) {
    if (JSON.stringify(b.data).length > MAX_DATA_BYTES) throw new BadRequestException('Données trop volumineuses');
    const row = await this.db.tx(req.org.id, async (c) => (await c.query(
      `INSERT INTO field_records(id, organization_id, idempotency_key, kind, title, latitude, longitude, data, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (organization_id, idempotency_key) DO UPDATE SET idempotency_key = field_records.idempotency_key RETURNING *`,
      [b.id, req.org.id, b.idempotency_key, b.kind, b.title, b.latitude ?? null, b.longitude ?? null, JSON.stringify(b.data), req.user.id])).rows[0]);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'field_record.create', entityType: 'field_record', entityId: row.id });
    return row;
  }

  @Post('field-records')
  @RequirePermissions('field_records:create')
  post(@Body() b: CreateFieldRecordDto, @Req() req: any) { return this.create(b, req); }

  @Get('field-records')
  @RequirePermissions('field_records:read')
  list(@Req() req: any, @Query('kind') kind?: string) {
    if (kind && !(FIELD_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Type inconnu');
    const all = req.org.permissions.has('field_records:manage');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT f.id, f.kind, f.title, f.latitude, f.longitude, f.data, f.created_by, u.full_name AS created_by_name, f.created_at
         FROM field_records f LEFT JOIN users u ON u.id = f.created_by
        WHERE ($1::text IS NULL OR f.kind = $1) AND ($2::boolean OR f.created_by = $3)
        ORDER BY f.created_at DESC LIMIT 200`, [kind ?? null, all, req.user.id])).rows);
  }

  @Get('distribution-articles')
  @RequirePermissions('field_records:read')
  articles(@Req() req: any, @Query('category') category?: string, @Query('group') group?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, category, group_name, name, unit FROM distribution_articles
        WHERE active AND ($1::text IS NULL OR category = $1) AND ($2::text IS NULL OR group_name = $2) ORDER BY category, group_name, name LIMIT 500`,
      [category ?? null, group ?? null])).rows);
  }

  @Post('distribution-articles')
  @RequirePermissions('field_records:manage')
  async addArticle(@Body() b: CreateArticleDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `INSERT INTO distribution_articles(organization_id, category, group_name, name, unit) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, category, group_name, name) DO UPDATE SET active = true, unit = EXCLUDED.unit RETURNING *`,
      [req.org.id, b.category, b.group_name, b.name, b.unit ?? null])).rows[0]);
  }

  /** Retire un article du catalogue (il reste dans les distributions déjà enregistrées). */
  @Post('distribution-articles/:id/retirer')
  @RequirePermissions('field_records:manage')
  async retireArticle(@Param('id') id: string, @Req() req: any) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('Identifiant invalide');
    const r = await this.db.tx(req.org.id, (c) => c.query(`UPDATE distribution_articles SET active = false WHERE id = $1`, [id]));
    if (!r.rowCount) throw new NotFoundException('Article introuvable');
    return { ok: true };
  }
}
