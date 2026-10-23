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
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT id, name, buy_price_per_kg, sell_price_per_kg, active FROM products ORDER BY name`)).rows);
  }

  @Post('products')
  @RequirePermissions('products:manage')
  async createProduct(@Body() b: ProductDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => (await c.query(
        `INSERT INTO products(organization_id, name, buy_price_per_kg, sell_price_per_kg, active, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, buy_price_per_kg, sell_price_per_kg, active`,
        [req.org.id, b.name.trim(), b.buy_price_per_kg ?? null, b.sell_price_per_kg ?? null, b.active ?? true, req.user.id])).rows[0]);
      await this.log(req, 'product.create', 'product', row.id, { name: row.name });
      return row;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Ce produit existe déjà'); throw e; }
  }

  @Put('products/:id')
  @RequirePermissions('products:manage')
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() b: ProductDto, @Req() req: any) {
    try {
      const row = await this.db.tx(req.org.id, async (c) => (await c.query(
        `UPDATE products SET name = $2, buy_price_per_kg = $3, sell_price_per_kg = $4, active = coalesce($5, active), updated_at = now(), updated_by = $6 WHERE id = $1
         RETURNING id, name, buy_price_per_kg, sell_price_per_kg, active`, [id, b.name.trim(), b.buy_price_per_kg ?? null, b.sell_price_per_kg ?? null, b.active ?? null, req.user.id])).rows[0]);
      if (!row) throw new NotFoundException();
      await this.log(req, 'product.update', 'product', id, { buy: row.buy_price_per_kg, sell: row.sell_price_per_kg, active: row.active });
      return row;
    } catch (e) { if (isUniqueViolation(e)) throw new ConflictException('Ce produit existe déjà'); throw e; }
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
              coalesce(sum(coalesce(r.bags_unloaded, r.bags)), 0)::int AS bags, coalesce(sum(r.total_kg), 0) AS kg
         FROM convoy_receptions r LEFT JOIN products p ON p.id = r.product_id
        WHERE ($1::uuid IS NULL OR r.campaign_id = $1) AND ($2::date IS NULL OR r.received_at >= $2::date) AND ($3::date IS NULL OR r.received_at < $3::date + 1)
        GROUP BY p.name ORDER BY 1`, [campaignId ?? null, d(from), d(to)])).rows);
  }
}
