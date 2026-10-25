import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/dto';
import { DbService } from '../db/db.service';

const PRICE = /^\d{1,12}(\.\d{1,2})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
class ProductDto {
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @Matches(PRICE) buy_price_per_kg?: string;
  @IsOptional() @Matches(PRICE) sell_price_per_kg?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Campagne (traite) à laquelle s'applique le prix saisi ; sans campagne, le prix est général. */
  @IsOptional() @IsUUID() campaign_id?: string;
  /** Filière dont les déclarations d'achat utilisent le prix officiel de ce produit (null = aucune). */
  @IsOptional() @IsUUID() value_chain_id?: string | null;
}
class PriceDto {
  @IsOptional() @IsUUID() campaign_id?: string;
  @IsOptional() @Matches(PRICE) buy_price_per_kg?: string;
  @IsOptional() @Matches(PRICE) sell_price_per_kg?: string;
}
@ApiTags('produits et campagnes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ProductsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}
  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  @Get('products')
  @RequirePermissions('products:read')
  products(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT id, name, buy_price_per_kg, sell_price_per_kg, active, value_chain_id FROM products ORDER BY name`)).rows);
  }

  @Post('products')
  @RequirePermissions('products:manage')
  async createProduct(@Body() b: ProductDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => (await c.query(
        `INSERT INTO products(organization_id, name, buy_price_per_kg, sell_price_per_kg, active, created_by, value_chain_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, buy_price_per_kg, sell_price_per_kg, active, value_chain_id`,
        [req.org.id, b.name.trim(), b.buy_price_per_kg ?? null, b.sell_price_per_kg ?? null, b.active ?? true, req.user.id, b.value_chain_id ?? null])).rows[0]);
      if (row.buy_price_per_kg != null || row.sell_price_per_kg != null) await this.db.tx(req.org.id, (c) => c.query(`INSERT INTO product_prices(organization_id, product_id, campaign_id, buy_price_per_kg, sell_price_per_kg, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [req.org.id, row.id, b.campaign_id ?? null, row.buy_price_per_kg, row.sell_price_per_kg, req.user.id]));
      await this.log(req, 'product.create', 'product', row.id, { name: row.name });
      return row;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Ce produit existe déjà'); throw e; }
  }

  @Put('products/:id')
  @RequirePermissions('products:manage')
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() b: ProductDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => {
        const before = (await c.query(`SELECT buy_price_per_kg AS b, sell_price_per_kg AS s FROM products WHERE id = $1`, [id])).rows[0];
        const u = (await c.query(
        `UPDATE products SET name = $2, buy_price_per_kg = $3, sell_price_per_kg = $4, active = coalesce($5, active), updated_at = now(), updated_by = $6, value_chain_id = CASE WHEN $8::boolean THEN $7::uuid ELSE value_chain_id END WHERE id = $1
         RETURNING id, name, buy_price_per_kg, sell_price_per_kg, active, value_chain_id`, [id, b.name.trim(), b.buy_price_per_kg ?? null, b.sell_price_per_kg ?? null, b.active ?? null, req.user.id, b.value_chain_id ?? null, b.value_chain_id !== undefined])).rows[0];
        if (u && before && (String(before.b ?? '') !== String(u.buy_price_per_kg ?? '') || String(before.s ?? '') !== String(u.sell_price_per_kg ?? '')))
          await c.query(`INSERT INTO product_prices(organization_id, product_id, campaign_id, buy_price_per_kg, sell_price_per_kg, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [req.org.id, id, b.campaign_id ?? null, u.buy_price_per_kg, u.sell_price_per_kg, req.user.id]);
        return u;
      });
      if (!row) throw new NotFoundException();
      await this.log(req, 'product.update', 'product', id, { buy: row.buy_price_per_kg, sell: row.sell_price_per_kg, active: row.active });
      return row;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Ce produit existe déjà'); throw e; }
  }

  /** Historique des prix d'un produit (campagne, prix d'achat et de vente, date, auteur). */
  @Get('products/:id/prices')
  @RequirePermissions('products:read')
  prices(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT p.id, p.campaign_id, k.name AS campaign_name, p.buy_price_per_kg, p.sell_price_per_kg, p.valid_from, p.created_at, u.full_name AS set_by
         FROM product_prices p LEFT JOIN campaigns k ON k.id = p.campaign_id LEFT JOIN users u ON u.id = p.created_by
        WHERE p.product_id = $1 ORDER BY p.created_at DESC`, [id])).rows);
  }

  /** Fixe ou actualise le prix au kilo (à l'ouverture de la traite, puis à chaque révision) : seul l'administrateur de la coopérative. */
  @Post('products/:id/prices')
  @RequirePermissions('products:manage')
  async setPrice(@Param('id', ParseUUIDPipe) id: string, @Body() b: PriceDto, @Req() req: any) {
    if (b.buy_price_per_kg === undefined && b.sell_price_per_kg === undefined) throw new BadRequestException("Indiquez un prix d'achat ou de vente");
    const row = await this.db.tx(req.org.id, async (c) => {
      const p = (await c.query(`SELECT id, buy_price_per_kg AS b, sell_price_per_kg AS s FROM products WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!p) throw new NotFoundException();
      // Pour une traite : la valeur non précisée reprend le dernier prix de CETTE traite (jamais le prix général du produit).
      const last = b.campaign_id ? (await c.query(`SELECT buy_price_per_kg AS b, sell_price_per_kg AS s FROM product_prices WHERE product_id = $1 AND campaign_id = $2 ORDER BY created_at DESC LIMIT 1`, [id, b.campaign_id])).rows[0] : null;
      const buy = b.buy_price_per_kg ?? (b.campaign_id ? last?.b ?? null : p.b), sell = b.sell_price_per_kg ?? (b.campaign_id ? last?.s ?? null : p.s);
      await c.query(`INSERT INTO product_prices(organization_id, product_id, campaign_id, buy_price_per_kg, sell_price_per_kg, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [req.org.id, id, b.campaign_id ?? null, buy, sell, req.user.id]);
      // Le prix d'une traite ne change pas le prix par défaut du produit (hors traite). Il associe le produit à la traite et se répercute sur les achats pas encore pesés.
      if (b.campaign_id) {
        await c.query(`INSERT INTO campaign_products(organization_id, campaign_id, product_id, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [req.org.id, b.campaign_id, id, req.user.id]);
        if (buy != null && Number(buy) > 0) {
          await c.query(
            `UPDATE purchase_declarations d SET unit_price = $3, amount = round(d.amount * $3::numeric / d.unit_price, 4), updated_at = now(), version = version + 1
              WHERE d.campaign_id = $1 AND d.unit_price > 0 AND d.price_version_id IS NULL AND d.amount IS NOT NULL AND d.unit_price <> $3::numeric
                AND d.value_chain_id = (SELECT value_chain_id FROM products WHERE id = $2) AND d.status IN ('received','received_confirmed','in_review','accepted')
                AND NOT EXISTS (SELECT 1 FROM weighings w WHERE w.declaration_id = d.id)`, [b.campaign_id, id, buy]);
        }
      }
      if (b.campaign_id) return { ...(await c.query(`SELECT id, name, active FROM products WHERE id = $1`, [id])).rows[0], campaign_id: b.campaign_id, buy_price_per_kg: buy, sell_price_per_kg: sell };
      return (await c.query(`UPDATE products SET buy_price_per_kg = $2, sell_price_per_kg = $3, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING id, name, buy_price_per_kg, sell_price_per_kg, active`, [id, buy, sell, req.user.id])).rows[0];
    });
    await this.log(req, 'product.price', 'product', id, { campaign_id: b.campaign_id ?? null, buy: b.buy_price_per_kg, sell: b.sell_price_per_kg });
    return row;
  }

  /** Suppression possible tant qu'aucune pesée n'utilise le produit ; sinon on le désactive. */
  @Delete('products/:id')
  @RequirePermissions('products:manage')
  async deleteProduct(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      if ((await c.query(`SELECT 1 FROM convoy_receptions WHERE product_id = $1 LIMIT 1`, [id])).rowCount) throw new ConflictException('Ce produit est utilisé par des pesées : désactivez-le plutôt');
      if (!(await c.query(`DELETE FROM products WHERE id = $1`, [id])).rowCount) throw new NotFoundException();
    });
    await this.log(req, 'product.delete', 'product', id);
    return { id };
  }

  /** État du stock d'une campagne : sacs et poids net reçus au magasin (pesées), par produit, sur une période. */
  @Get('stock-state')
  @RequirePermissions('warehouses:read')
  stockState(@Req() req: any, @Query('campaign_id') campaignId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const d = (v?: string) => (v && DAY.test(v) ? v : null);
    if (campaignId && !/^[0-9a-f-]{36}$/i.test(campaignId)) throw new BadRequestException('Campagne invalide');
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT coalesce(p.name, 'Non précisé') AS product, count(*)::int AS receptions,
              coalesce(sum(coalesce(r.bags_unloaded, r.bags)), 0)::int AS bags, coalesce(sum(r.total_kg), 0) AS received_kg,
              coalesce(sum(r.total_kg) FILTER (WHERE EXISTS (SELECT 1 FROM dispatch_sheet_convoys sc JOIN dispatch_sheets s ON s.id = sc.sheet_id
                 WHERE sc.convoy_id = r.convoy_id AND s.status = 'transmitted' AND s.returned_at IS NULL)), 0) AS shipped_kg,
              coalesce(sum(r.total_kg) FILTER (WHERE EXISTS (SELECT 1 FROM dispatch_sheet_convoys sc JOIN dispatch_sheets s ON s.id = sc.sheet_id
                 WHERE sc.convoy_id = r.convoy_id AND s.returned_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM dispatch_sheet_convoys sc JOIN dispatch_sheets s ON s.id = sc.sheet_id
                 WHERE sc.convoy_id = r.convoy_id AND s.status = 'transmitted' AND s.returned_at IS NULL)), 0) AS returned_kg
         FROM convoy_receptions r LEFT JOIN products p ON p.id = r.product_id
        WHERE ($1::uuid IS NULL OR r.campaign_id = $1) AND ($2::date IS NULL OR r.received_at >= $2::date) AND ($3::date IS NULL OR r.received_at < $3::date + 1)
        GROUP BY p.name ORDER BY 1`, [campaignId ?? null, d(from), d(to)])).rows.map((r) => ({ ...r, kg: Number(r.received_kg) - Number(r.shipped_kg) })));
  }
}
