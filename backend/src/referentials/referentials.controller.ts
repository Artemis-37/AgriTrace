import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec, isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';

class ValueChainDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/) code: string;
  @IsString() @Length(2, 100) name: string;
  @IsOptional() @IsString() @Length(1, 20) default_unit?: string;
}
class ConversionDto {
  @IsUUID() value_chain_id: string;
  @IsString() @Length(1, 20) from_unit: string;
  @IsString() @Length(1, 20) to_unit: string;
  @Dec(6) factor: string;
}
class CampaignDto {
  @IsUUID() value_chain_id: string;
  @Matches(/^[A-Z0-9_-]{2,30}$/) code: string;
  @IsString() @Length(2, 100) name: string;
  @IsDateString() starts_on: string;
  @IsDateString() ends_on: string;
  @IsOptional() @IsIn(['planned', 'open', 'closed']) status?: string;
  /** Grande traite (octobre–mars) ou petite traite (avril–septembre) ; dates libres. */
  @IsOptional() @IsIn(['grande', 'petite']) traite?: string;
}
class CampaignUpdateDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsDateString() starts_on?: string;
  @IsOptional() @IsDateString() ends_on?: string;
  @IsOptional() @IsIn(['planned', 'open', 'closed']) status?: string;
}
class ScheduleDto {
  @IsUUID() value_chain_id: string;
  @IsUUID() campaign_id: string;
  @IsString() @Length(1, 20) unit: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}
class PriceVersionDto {
  @Dec(4) unit_price: string;
  @IsDateString() valid_from: string;
  @IsOptional() @IsDateString() valid_to?: string;
}

@ApiTags('référentiels')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ReferentialsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private async audited(req: any, action: string, entityType: string, entityId: string, details?: any) {
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType, entityId, details });
  }

  // ---- Filières ----
  @Get('value-chains')
  @RequirePermissions('value_chains:read')
  listChains(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT id, code, name, default_unit, status FROM value_chains ORDER BY name`)).rows);
  }

  @Post('value-chains')
  @RequirePermissions('value_chains:manage')
  async createChain(@Body() b: ValueChainDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) =>
        (await c.query(
          `INSERT INTO value_chains(organization_id, code, name, default_unit, created_by) VALUES ($1,$2,$3,$4,$5)
           RETURNING id, code, name, default_unit, status`,
          [req.org.id, b.code, b.name, b.default_unit ?? 'kg', req.user.id],
        )).rows[0]);
      await this.audited(req, 'value_chain.create', 'value_chain', row.id);
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Code de filière déjà utilisé');
      throw e;
    }
  }

  @Get('unit-conversions')
  @RequirePermissions('value_chains:read')
  listConversions(@Req() req: any, @Query('value_chain_id') vc?: string) {
    return this.db.tx(req.org.id, async (c) =>
      (await c.query(`SELECT id, value_chain_id, from_unit, to_unit, factor FROM unit_conversions WHERE ($1::uuid IS NULL OR value_chain_id = $1) ORDER BY from_unit`, [vc ?? null])).rows);
  }

  @Post('unit-conversions')
  @RequirePermissions('value_chains:manage')
  async upsertConversion(@Body() b: ConversionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const vc = await c.query(`SELECT 1 FROM value_chains WHERE id=$1`, [b.value_chain_id]);
      if (!vc.rowCount) throw new BadRequestException('Filière inconnue');
      return (await c.query(
        `INSERT INTO unit_conversions(organization_id, value_chain_id, from_unit, to_unit, factor, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (organization_id, value_chain_id, from_unit, to_unit) DO UPDATE SET factor = EXCLUDED.factor, updated_at = now()
         RETURNING id, value_chain_id, from_unit, to_unit, factor`,
        [req.org.id, b.value_chain_id, b.from_unit, b.to_unit, b.factor, req.user.id])).rows[0];
    });
    await this.audited(req, 'unit_conversion.upsert', 'unit_conversion', row.id, { factor: b.factor });
    return row;
  }

  // ---- Campagnes ----
  @Get('campaigns')
  @RequirePermissions('campaigns:read')
  listCampaigns(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) =>
      (await c.query(`SELECT k.id, k.value_chain_id, k.code, k.name, k.starts_on, k.ends_on, k.status, k.traite,
        coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', p.name,
            'buy_price_per_kg', (SELECT x.buy_price_per_kg FROM product_prices x WHERE x.product_id = p.id AND x.campaign_id = k.id AND x.buy_price_per_kg IS NOT NULL ORDER BY x.created_at DESC LIMIT 1),
            'sell_price_per_kg', (SELECT x.sell_price_per_kg FROM product_prices x WHERE x.product_id = p.id AND x.campaign_id = k.id AND x.sell_price_per_kg IS NOT NULL ORDER BY x.created_at DESC LIMIT 1)) ORDER BY p.name)
          FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = k.id), '[]'::json) AS products
       FROM campaigns k ORDER BY k.starts_on DESC`)).rows);
  }

  /** Associe un produit à une traite (le prix s'y fixe ensuite). */
  @Post('campaigns/:id/products/:productId')
  @RequirePermissions('campaigns:manage')
  async addCampaignProduct(@Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      if (!(await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [id])).rowCount) throw new NotFoundException('Traite introuvable');
      if (!(await c.query(`SELECT 1 FROM products WHERE id = $1`, [productId])).rowCount) throw new NotFoundException('Produit introuvable');
      await c.query(`INSERT INTO campaign_products(organization_id, campaign_id, product_id, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [req.org.id, id, productId, req.user.id]);
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'campaign.product_add', entityType: 'campaign', entityId: id, details: { product_id: productId } });
    return { ok: true };
  }

  /** Retire un produit d'une traite, tant qu'aucune pesée ne s'y rattache. */
  @Delete('campaigns/:id/products/:productId')
  @RequirePermissions('campaigns:manage')
  async removeCampaignProduct(@Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      if ((await c.query(`SELECT 1 FROM convoy_receptions WHERE campaign_id = $1 AND product_id = $2 LIMIT 1`, [id, productId])).rowCount)
        throw new ConflictException('Des pesées existent déjà pour ce produit dans cette traite : il ne peut plus en être retiré');
      await c.query(`DELETE FROM product_prices WHERE campaign_id = $1 AND product_id = $2`, [id, productId]);
      await c.query(`DELETE FROM campaign_products WHERE campaign_id = $1 AND product_id = $2`, [id, productId]);
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'campaign.product_remove', entityType: 'campaign', entityId: id, details: { product_id: productId } });
    return { ok: true };
  }

  @Post('campaigns')
  @RequirePermissions('campaigns:manage')
  async createCampaign(@Body() b: CampaignDto, @Req() req: any) {
    if (b.ends_on < b.starts_on) throw new BadRequestException('La fin précède le début');
    try {
      const row = await this.db.tx(req.org.id, async (c) => {
        const vc = await c.query(`SELECT 1 FROM value_chains WHERE id=$1`, [b.value_chain_id]);
        if (!vc.rowCount) throw new BadRequestException('Filière inconnue');
        // Deux traites d'une même filière ne se chevauchent pas : à une date donnée, une seule traite fixe le prix.
        if (b.traite) {
          const over = await c.query(`SELECT name FROM campaigns WHERE value_chain_id = $1 AND traite IS NOT NULL AND status <> 'closed' AND starts_on <= $3::date AND ends_on >= $2::date LIMIT 1`, [b.value_chain_id, b.starts_on, b.ends_on]);
          if (over.rowCount) throw new BadRequestException(`Ces dates chevauchent la traite « ${over.rows[0].name} » de la même filière`);
        }
        return (await c.query(
          `INSERT INTO campaigns(organization_id, value_chain_id, code, name, starts_on, ends_on, status, created_by, traite)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, value_chain_id, code, name, starts_on, ends_on, status, traite`,
          [req.org.id, b.value_chain_id, b.code, b.name, b.starts_on, b.ends_on, b.status ?? 'open', req.user.id, b.traite ?? null])).rows[0];
      });
      await this.audited(req, 'campaign.create', 'campaign', row.id);
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Code de campagne déjà utilisé');
      throw e;
    }
  }

  /** Modification d'une traite : nom, dates de début et de fin, état. */
  @Put('campaigns/:id')
  @RequirePermissions('campaigns:manage')
  async updateCampaign(@Param('id', ParseUUIDPipe) id: string, @Body() b: CampaignUpdateDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const row = (await c.query(`UPDATE campaigns SET name = coalesce($2, name), starts_on = coalesce($3::date, starts_on), ends_on = coalesce($4::date, ends_on), status = coalesce($5, status), updated_at = now(), updated_by = $6, version = version + 1 WHERE id = $1 RETURNING id, value_chain_id, code, name, starts_on, ends_on, status, traite`, [id, b.name ?? null, b.starts_on ?? null, b.ends_on ?? null, b.status ?? null, req.user.id])).rows[0];
      if (!row) throw new NotFoundException('Traite introuvable');
      if (row.ends_on < row.starts_on) throw new BadRequestException('La fin précède le début');
      if (row.traite && row.status !== 'closed') {
        const over = await c.query(`SELECT name FROM campaigns WHERE id <> $1 AND value_chain_id = $2 AND traite IS NOT NULL AND status <> 'closed' AND starts_on <= $4::date AND ends_on >= $3::date LIMIT 1`, [id, row.value_chain_id, row.starts_on, row.ends_on]);
        if (over.rowCount) throw new BadRequestException(`Ces dates chevauchent la traite « ${over.rows[0].name} » de la même filière`);
      }
      return row;
    });
    await this.audited(req, 'campaign.update', 'campaign', id);
    return row;
  }

  // ---- Prix : barèmes et versions immuables ----
  @Post('price-schedules')
  @RequirePermissions('prices:manage')
  async createSchedule(@Body() b: ScheduleDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => {
        const ok = await c.query(`SELECT 1 FROM campaigns WHERE id=$1 AND value_chain_id=$2`, [b.campaign_id, b.value_chain_id]);
        if (!ok.rowCount) throw new BadRequestException('Campagne inconnue ou étrangère à la filière');
        return (await c.query(
          `INSERT INTO price_schedules(organization_id, value_chain_id, campaign_id, unit, currency, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, value_chain_id, campaign_id, unit, currency`,
          [req.org.id, b.value_chain_id, b.campaign_id, b.unit, b.currency ?? 'XOF', req.user.id])).rows[0];
      });
      await this.audited(req, 'price_schedule.create', 'price_schedule', row.id);
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Un barème existe déjà pour cette filière, campagne et unité');
      throw e;
    }
  }

  /** Un changement de prix crée une nouvelle version ; les anciennes ne sont jamais modifiées. */
  @Post('price-schedules/:id/versions')
  @RequirePermissions('prices:manage')
  async addVersion(@Param('id', ParseUUIDPipe) id: string, @Body() b: PriceVersionDto, @Req() req: any) {
    const row = await this.db.tx(req.org.id, async (c) => {
      const s = await c.query(`SELECT id FROM price_schedules WHERE id=$1 FOR UPDATE`, [id]);
      if (!s.rowCount) throw new NotFoundException();
      const n = await c.query(`SELECT coalesce(max(version_no),0)+1 AS n FROM price_versions WHERE schedule_id=$1`, [id]);
      return (await c.query(
        `INSERT INTO price_versions(organization_id, schedule_id, version_no, unit_price, valid_from, valid_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, schedule_id, version_no, unit_price, valid_from, valid_to`,
        [req.org.id, id, n.rows[0].n, b.unit_price, b.valid_from, b.valid_to ?? null, req.user.id])).rows[0];
    });
    await this.audited(req, 'price_version.create', 'price_version', row.id, { unit_price: b.unit_price, valid_from: b.valid_from });
    return row;
  }

  @Get('prices')
  @RequirePermissions('prices:read')
  listPrices(@Req() req: any, @Query('campaign_id') campaign?: string, @Query('value_chain_id') vc?: string) {
    return this.db.tx(req.org.id, async (c) =>
      (await c.query(
        `SELECT s.id AS schedule_id, s.value_chain_id, s.campaign_id, s.unit, s.currency,
                v.id AS version_id, v.version_no, v.unit_price, v.valid_from, v.valid_to
           FROM price_schedules s JOIN price_versions v ON v.schedule_id = s.id
          WHERE ($1::uuid IS NULL OR s.campaign_id = $1) AND ($2::uuid IS NULL OR s.value_chain_id = $2)
          ORDER BY s.id, v.version_no DESC`, [campaign ?? null, vc ?? null])).rows);
  }
}
