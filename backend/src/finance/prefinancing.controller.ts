import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { nextNumber, pad } from '../stock/stock.helpers';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
class PrefinDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsString() @Length(2, 200) funder: string;
  @Dec(2) amount: string;
  @Matches(/^[A-Z]{3}$/) currency: string;
  @Matches(DATE) received_on: string;
  @IsOptional() @IsString() @Length(1, 2000) conditions?: string;
  @IsOptional() @IsUUID() campaign_id?: string;
  @IsOptional() @IsUUID() value_chain_id?: string;
  @IsOptional() @Matches(DATE) due_date?: string;
}
class UseDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsIn(['purchase', 'expense', 'advance', 'other']) kind: string;
  @Dec(2) amount: string;
  @Matches(DATE) used_on: string;
  @IsString() @Length(3, 300) purpose: string;
  @IsOptional() @IsUUID() declaration_id?: string;
  @IsOptional() @IsString() @Length(1, 100) document_ref?: string;
}
class RepayDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @Dec(2) amount: string;
  @Matches(DATE) paid_on: string;
  @IsOptional() @IsString() @Length(1, 100) reference?: string;
}

/** Préfinancement reçu par la coopérative : fonds, conditions, utilisation, justificatifs, remboursements, soldes (CDC §20.3). */
@ApiTags('préfinancement')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('prefinancings')
export class PrefinancingController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}
  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'prefinancing', entityId: id, details });
  }
  private static SUMMARY = `SELECT p.*, coalesce((SELECT sum(amount) FROM prefinancing_uses u WHERE u.prefinancing_id = p.id),0)::numeric(18,2) AS used,
      (p.amount - coalesce((SELECT sum(amount) FROM prefinancing_uses u WHERE u.prefinancing_id = p.id),0))::numeric(18,2) AS available,
      coalesce((SELECT sum(amount) FROM prefinancing_repayments r WHERE r.prefinancing_id = p.id),0)::numeric(18,2) AS repaid,
      (p.amount - coalesce((SELECT sum(amount) FROM prefinancing_repayments r WHERE r.prefinancing_id = p.id),0))::numeric(18,2) AS outstanding,
      coalesce((SELECT sum(amount) FROM prefinancing_uses u WHERE u.prefinancing_id = p.id AND u.kind = 'purchase'),0)::numeric(18,2) AS purchases_financed,
      (p.status = 'active' AND p.due_date < current_date) AS overdue
    FROM prefinancings p`;
  private async lock(c: PoolClient, id: string) {
    const p = (await c.query(`SELECT * FROM prefinancings WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!p) throw new NotFoundException();
    return p;
  }

  @Post()
  @RequirePermissions('prefinancing:manage')
  async create(@Body() b: PrefinDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const dup = (await c.query(`SELECT * FROM prefinancings WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (dup) return dup;
      if (b.due_date && b.due_date < b.received_on) throw new BadRequestException('Échéance antérieure à la date de réception');
      for (const [tbl, id, label] of [['campaigns', b.campaign_id, 'Campagne'], ['value_chains', b.value_chain_id, 'Filière']] as const)
        if (id && !(await c.query(`SELECT 1 FROM ${tbl} WHERE id = $1`, [id])).rowCount) throw new BadRequestException(`${label} inconnue`);
      const n = await nextNumber(c, req.org.id, 'prefinancing');
      const r = (await c.query(
        `INSERT INTO prefinancings(organization_id, idempotency_key, number, funder, amount, currency, received_on, conditions, campaign_id, value_chain_id, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, b.idempotency_key, `PF-${new Date().getUTCFullYear()}-${pad(n, 4)}`, b.funder, b.amount, b.currency, b.received_on, b.conditions ?? null, b.campaign_id ?? null, b.value_chain_id ?? null, b.due_date ?? null, req.user.id])).rows[0];
      await this.log(req, 'prefinancing.create', r.id, { number: r.number, amount: b.amount });
      return r;
    });
  }

  @Get()
  @RequirePermissions('prefinancing:read')
  list(@Req() req: any) { return this.db.tx(req.org.id, async (c) => (await c.query(`${PrefinancingController.SUMMARY} ORDER BY p.received_on DESC LIMIT 200`)).rows); }

  /** Rapport de suivi : totaux, solde disponible, reste à rembourser, retards. */
  @Get('report')
  @RequirePermissions('prefinancing:read')
  async report(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const rows = (await c.query(`${PrefinancingController.SUMMARY} WHERE p.status <> 'cancelled'`)).rows;
      const sum = (k: string, cur: string) => rows.filter((r) => r.currency === cur).reduce((s, r) => s + Number(r[k]), 0).toFixed(2);
      const byCurrency = [...new Set(rows.map((r) => r.currency))].map((cur) => ({ currency: cur, received: sum('amount', cur), used: sum('used', cur), available: sum('available', cur),
        repaid: sum('repaid', cur), outstanding: sum('outstanding', cur), purchases_financed: sum('purchases_financed', cur) }));
      return { by_currency: byCurrency, overdue: rows.filter((r) => r.overdue).map((r) => ({ id: r.id, number: r.number, funder: r.funder, due_date: r.due_date, outstanding: r.outstanding })) };
    });
  }

  @Get(':id')
  @RequirePermissions('prefinancing:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const p = (await c.query(`${PrefinancingController.SUMMARY} WHERE p.id = $1`, [id])).rows[0];
      if (!p) throw new NotFoundException();
      const uses = (await c.query(`SELECT * FROM prefinancing_uses WHERE prefinancing_id = $1 ORDER BY used_on, created_at`, [id])).rows;
      const repayments = (await c.query(`SELECT * FROM prefinancing_repayments WHERE prefinancing_id = $1 ORDER BY paid_on, created_at`, [id])).rows;
      return { ...p, uses, repayments };
    });
  }

  @Post(':id/uses')
  @RequirePermissions('prefinancing:manage')
  async use(@Param('id', ParseUUIDPipe) id: string, @Body() b: UseDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM prefinancing_uses WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) return prior;
      const p = await this.lock(c, id);
      if (p.status !== 'active') throw new ConflictException('Préfinancement clos ou annulé');
      if (b.kind === 'purchase' && !b.declaration_id) throw new BadRequestException('Un achat financé doit référencer sa déclaration d\'achat');
      if (b.declaration_id && !(await c.query(`SELECT 1 FROM purchase_declarations WHERE id = $1`, [b.declaration_id])).rowCount) throw new BadRequestException('Déclaration d\'achat inconnue');
      if (!b.document_ref) throw new BadRequestException('Justificatif obligatoire (référence de la pièce)');
      const used = (await c.query(`SELECT coalesce(sum(amount),0) AS u FROM prefinancing_uses WHERE prefinancing_id = $1`, [id])).rows[0].u;
      const left = (await c.query(`SELECT ($1::numeric - $2::numeric) AS l`, [p.amount, used])).rows[0].l;
      if (Number(b.amount) > Number(left)) throw new BadRequestException(`Montant supérieur aux fonds disponibles (${left})`);
      if (b.used_on > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Date d\'utilisation dans le futur');
      const r = (await c.query(`INSERT INTO prefinancing_uses(organization_id, idempotency_key, prefinancing_id, kind, amount, used_on, purpose, declaration_id, document_ref, created_by)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.org.id, b.idempotency_key, id, b.kind, b.amount, b.used_on, b.purpose, b.declaration_id ?? null, b.document_ref, req.user.id])).rows[0];
      await this.log(req, 'prefinancing.use', id, { amount: b.amount, kind: b.kind });
      return r;
    });
  }

  @Post(':id/repayments')
  @RequirePermissions('prefinancing:manage')
  async repay(@Param('id', ParseUUIDPipe) id: string, @Body() b: RepayDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const prior = (await c.query(`SELECT * FROM prefinancing_repayments WHERE idempotency_key = $1`, [b.idempotency_key])).rows[0];
      if (prior) return prior;
      const p = await this.lock(c, id);
      if (p.status === 'cancelled') throw new ConflictException('Préfinancement annulé');
      const repaid = (await c.query(`SELECT coalesce(sum(amount),0) AS r FROM prefinancing_repayments WHERE prefinancing_id = $1`, [id])).rows[0].r;
      const out = (await c.query(`SELECT ($1::numeric - $2::numeric) AS o`, [p.amount, repaid])).rows[0].o;
      if (Number(b.amount) > Number(out)) throw new BadRequestException(`Montant supérieur au reste à rembourser (${out})`);
      if (b.paid_on > new Date().toISOString().slice(0, 10)) throw new BadRequestException('Date de remboursement dans le futur');
      const r = (await c.query(`INSERT INTO prefinancing_repayments(organization_id, idempotency_key, prefinancing_id, amount, paid_on, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.org.id, b.idempotency_key, id, b.amount, b.paid_on, b.reference ?? null, req.user.id])).rows[0];
      const rest = (await c.query(`SELECT ($1::numeric - $2::numeric - $3::numeric) AS r`, [p.amount, repaid, b.amount])).rows[0].r;
      if (Number(rest) === 0) await c.query(`UPDATE prefinancings SET status = 'repaid' WHERE id = $1`, [id]);
      await this.log(req, 'prefinancing.repayment', id, { amount: b.amount });
      return { ...r, outstanding: rest };
    });
  }
}
