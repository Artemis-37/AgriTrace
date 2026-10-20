import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe,
  Post, Query, Req, UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec, isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';
import { canSubmit, canTransition, REASON_REQUIRED } from './declaration-states';

export class CreateDeclarationDto {
  @IsUUID() id: string;                       // identifiant local stable (généré sur l'appareil)
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsOptional() @IsUUID() collector_id?: string;
  @IsUUID() producer_id: string;
  @IsUUID() value_chain_id: string;
  @IsUUID() campaign_id: string;
  @IsDateString() operation_date: string;
  @IsOptional() @IsInt() @Min(0) bags?: number;
  @Dec(3) quantity: string;
  @IsString() @Length(1, 20) unit: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
}
class TransitionDto {
  @IsString() to: string;
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

@ApiTags('déclarations')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('purchase-declarations')
export class DeclarationsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private async history(c: PoolClient, orgId: string, id: string, from: string | null, to: string, reason: string | undefined, actor: string) {
    await c.query(
      `INSERT INTO purchase_declaration_history(organization_id, declaration_id, from_status, to_status, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, id, from, to, reason ?? null, actor]);
  }

  /** Collecteur de l'utilisateur courant dans cette organisation (null s'il n'en a pas). */
  private async myCollector(c: PoolClient, userId: string) {
    const r = await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [userId]);
    return r.rows[0]?.id as string | undefined;
  }

  @Post()
  @RequirePermissions('declarations:create')
  async create(@Body() b: CreateDeclarationDto, @Req() req: any) {
    const canValidate = req.org.permissions.has('declarations:validate');
    try {
      const { row, replay } = await this.db.tx(req.org.id, async (c) => {
        // Rejeu d'une opération déjà reçue : on renvoie le résultat existant, sans doublon.
        const prev = await c.query(`SELECT * FROM purchase_declarations WHERE idempotency_key = $1`, [b.idempotency_key]);
        if (prev.rowCount) return { row: prev.rows[0], replay: true };

        const mine = await this.myCollector(c, req.user.id);
        const collectorId = canValidate && b.collector_id ? b.collector_id : mine;
        if (!collectorId) throw new ForbiddenException("Aucun compte collecteur actif pour cet utilisateur dans cette organisation");
        if (b.collector_id && b.collector_id !== collectorId) throw new ForbiddenException('Déclaration pour un autre collecteur non autorisée');

        const checks = await c.query(
          `SELECT
             (SELECT status FROM collectors WHERE id = $1) AS collector_status,
             EXISTS (SELECT 1 FROM producers WHERE id = $2 AND status = 'active') AS producer_ok,
             (SELECT status FROM campaigns WHERE id = $3 AND value_chain_id = $4) AS campaign_status,
             EXISTS (SELECT 1 FROM collector_assignments WHERE collector_id = $1 AND (value_chain_id IS NULL OR value_chain_id = $4)) AS assigned`,
          [collectorId, b.producer_id, b.campaign_id, b.value_chain_id]);
        const k = checks.rows[0];
        if (k.collector_status !== 'active') throw new BadRequestException('Collecteur inconnu ou inactif');
        if (!k.producer_ok) throw new BadRequestException('Producteur inconnu ou inactif');
        if (k.campaign_status !== 'open') throw new BadRequestException('Campagne inconnue, fermée ou étrangère à la filière');
        if (!k.assigned) throw new ForbiddenException("Collecteur non affecté à cette filière");

        const ins = await c.query(
          `INSERT INTO purchase_declarations(id, organization_id, idempotency_key, collector_id, producer_id, value_chain_id, campaign_id,
                                              operation_date, bags, quantity, unit, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [b.id, req.org.id, b.idempotency_key, collectorId, b.producer_id, b.value_chain_id, b.campaign_id,
           b.operation_date, b.bags ?? null, b.quantity, b.unit, b.notes ?? null, req.user.id]);
        await this.history(c, req.org.id, b.id, null, 'draft', undefined, req.user.id);
        return { row: ins.rows[0], replay: false };
      });
      if (!replay)
        await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.create', entityType: 'purchase_declaration', entityId: row.id });
      return { ...row, replayed: replay };
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException('Identifiant de déclaration déjà utilisé avec une autre clé d\'idempotence');
      throw e;
    }
  }

  @Get()
  @RequirePermissions('declarations:read')
  list(@Req() req: any, @Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const all = req.org.permissions.has('declarations:validate');
    return this.db.tx(req.org.id, async (c) => {
      const mine = all ? null : await this.myCollector(c, req.user.id);
      if (!all && !mine) return [];
      return (await c.query(
        `SELECT id, collector_id, producer_id, value_chain_id, campaign_id, operation_date, bags, quantity, unit,
                unit_price, currency, amount, status, status_reason, updated_at
           FROM purchase_declarations
          WHERE ($1::text IS NULL OR status = $1) AND ($2::uuid IS NULL OR collector_id = $2)
          ORDER BY operation_date DESC, created_at DESC LIMIT $3 OFFSET $4`,
        [status ?? null, mine ?? null, Math.min(Number(limit) || 50, 200), Number(offset) || 0])).rows;
    });
  }

  private async load(c: PoolClient, id: string, req: any, lock = false) {
    const r = await c.query(`SELECT * FROM purchase_declarations WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
    if (!r.rowCount) throw new NotFoundException();
    const d = r.rows[0];
    if (!req.org.permissions.has('declarations:validate')) {
      const mine = await this.myCollector(c, req.user.id);
      if (d.collector_id !== mine) throw new NotFoundException(); // les déclarations des autres restent invisibles
    }
    return d;
  }

  @Get(':id')
  @RequirePermissions('declarations:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req);
      const h = await c.query(`SELECT from_status, to_status, reason, actor_user_id, created_at FROM purchase_declaration_history WHERE declaration_id = $1 ORDER BY id`, [id]);
      return { ...d, history: h.rows };
    });
  }

  /**
   * Soumission : le serveur retient le prix applicable à la date de l'opération et calcule le montant
   * (arithmétique décimale exacte en base). Ce prix reste attaché à la déclaration même si le barème change ensuite.
   */
  @Post(':id/submit')
  @RequirePermissions('declarations:create')
  async submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req, true);
      if (!canSubmit(d.status)) throw new BadRequestException(`Soumission impossible depuis l'état « ${d.status} »`);

      const p = await c.query(
        `SELECT v.id AS version_id, v.unit_price, s.currency, s.unit AS price_unit
           FROM price_schedules s JOIN price_versions v ON v.schedule_id = s.id
          WHERE s.value_chain_id = $1 AND s.campaign_id = $2 AND s.status = 'active'
            AND v.valid_from <= $3 AND (v.valid_to IS NULL OR v.valid_to >= $3)
          ORDER BY (s.unit = $4) DESC, v.valid_from DESC, v.version_no DESC LIMIT 1`,
        [d.value_chain_id, d.campaign_id, d.operation_date, d.unit]);
      if (!p.rowCount) throw new UnprocessableEntityException('Aucun prix applicable à cette date pour cette filière et campagne');
      const price = p.rows[0];

      let factor = '1';
      if (price.price_unit !== d.unit) {
        const f = await c.query(
          `SELECT factor FROM unit_conversions WHERE value_chain_id = $1 AND from_unit = $2 AND to_unit = $3`,
          [d.value_chain_id, d.unit, price.price_unit]);
        if (!f.rowCount) throw new UnprocessableEntityException(`Conversion ${d.unit} → ${price.price_unit} non configurée`);
        factor = f.rows[0].factor;
      }
      const up = await c.query(
        `UPDATE purchase_declarations
            SET price_version_id = $2, unit_price = $3, currency = $4,
                amount = round($5::numeric * $6::numeric * $3::numeric, 4),
                status = 'received', status_reason = NULL, updated_at = now(), updated_by = $7, version = version + 1
          WHERE id = $1 RETURNING *`,
        [id, price.version_id, price.unit_price, price.currency, d.quantity, factor, req.user.id]);
      await this.history(c, req.org.id, id, d.status, 'received', undefined, req.user.id);
      return up.rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.submit', entityType: 'purchase_declaration', entityId: id, details: { amount: row.amount } });
    return row;
  }

  @Post(':id/transition')
  @RequirePermissions('declarations:validate')
  async transition(@Param('id', ParseUUIDPipe) id: string, @Body() b: TransitionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const d = await this.load(c, id, req, true);
      if (!canTransition(d.status, b.to)) throw new BadRequestException(`Transition « ${d.status} » → « ${b.to} » interdite`);
      if (REASON_REQUIRED.has(b.to) && !b.reason) throw new BadRequestException('Un motif est obligatoire');
      const up = await c.query(
        `UPDATE purchase_declarations SET status = $2, status_reason = $3, updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1 RETURNING *`,
        [id, b.to, b.reason ?? null, req.user.id]);
      await this.history(c, req.org.id, id, d.status, b.to, b.reason, req.user.id);
      return up.rows[0];
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'declaration.transition', entityType: 'purchase_declaration', entityId: id, details: { to: b.to } });
    return row;
  }
}
