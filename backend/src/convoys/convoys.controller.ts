import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, IsString, IsUUID, Length, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { accountingCodeOf, postEntry, today } from '../accounting/accounting.helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';

export class CreateConvoyDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  /** Numéro de connaissement intérieur du convoi : saisi par le collecteur. */
  @IsString() @Length(2, 60) convoy_no: string;
  @IsOptional() @IsUUID() collector_id?: string;
  @IsString() @Length(2, 120) driver_name: string;
  @IsString() @Length(2, 40) truck_no: string;
  @IsOptional() @IsInt() @Min(0) declared_bags?: number;
  @IsOptional() @Dec(3) declared_kg?: string;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
}
export class ReceiveConvoyDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() collector_id: string;
  @IsString() @Length(2, 60) convoy_no: string;
  @IsUUID() warehouse_id: string;
  @Dec(3) total_kg: string;
  @IsInt() @Min(1) bags: number;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
}
class SettleDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  /** P.U. : prix d'achat au kg. */
  @Dec(4) unit_price: string;
  /** Coût unitaire de transport au kg (par défaut : réglage de la coopérative). Ajouté au produit. */
  @IsOptional() @Dec(4) transport_unit?: string;
  /** Retenue au kg (par défaut : réglage de la coopérative). Déduite du total. */
  @IsOptional() @Dec(4) retention_per_kg?: string;
  /** Netting : part du net à payer compensée par les financements (409) non encore soldés. Omis = automatique (maximum possible) ; « 0 » = aucun. */
  @IsOptional() @Dec(4) net_advance?: string;
}
class SettingsDto {
  @Dec(4) transport_unit: string;
  @Dec(4) retention_per_kg: string;
}
export class AdvanceDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() collector_id: string;
  /** advance = financement remis en espèces (caisse) ; carry_forward = report du solde de la campagne précédente (sans mouvement de caisse). */
  @IsIn(['advance', 'carry_forward']) kind: string;
  @Dec(4) amount: string;
  @IsOptional() @IsString() @Length(1, 60) piece_no?: string;
  @IsOptional() @IsString() @Length(1, 200) label?: string;
  @IsOptional() @IsUUID() cash_session_id?: string;
  /** Pour reprendre une fiche papier : date réelle de l'opération (jamais dans le futur). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) operation_date?: string;
}

export class PayoutDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() collector_id: string;
  @IsUUID() cash_session_id: string;
  @Dec(4) amount: string;
}

@ApiTags('convois')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ConvoysController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private log(req: any, action: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: 'convoy', entityId: id, details });
  }

  @Post('convoys')
  @RequirePermissions('convoys:create')
  async create(@Body() b: CreateConvoyDto, @Req() req: any) {
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM convoys WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const own = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      const collectorId = own?.id ?? b.collector_id;
      if (!collectorId) throw new BadRequestException('Collecteur requis (le compte connecté n\'est pas un collecteur)');
      if (own && b.collector_id && b.collector_id !== own.id) throw new BadRequestException('Un collecteur ne peut déclarer que ses propres convois');
      if (!(await c.query(`SELECT 1 FROM collectors WHERE id = $1 AND status = 'active'`, [collectorId])).rowCount) throw new BadRequestException('Collecteur inconnu ou désactivé');
      if ((await c.query(`SELECT 1 FROM convoys WHERE convoy_no = $1`, [b.convoy_no.trim()])).rowCount)
        throw new ConflictException(`Le numéro de convoi « ${b.convoy_no.trim()} » existe déjà`);
      const ins = await c.query(
        `INSERT INTO convoys(organization_id, idempotency_key, convoy_no, collector_id, driver_name, truck_no, declared_bags, declared_kg, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.org.id, b.idempotency_key, b.convoy_no.trim(), collectorId, b.driver_name.trim(), b.truck_no.trim().toUpperCase(),
         b.declared_bags ?? null, b.declared_kg ?? null, b.notes ?? null, req.user.id]);
      const who = (await c.query(`SELECT u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [collectorId])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'convoys:receive', { kind: 'convoy_created', title: `Convoi en route : ${ins.rows[0].convoy_no}`,
        body: `${who?.full_name ?? 'Collecteur'} · camion ${ins.rows[0].truck_no} · chauffeur ${ins.rows[0].driver_name}`, entityType: 'convoy', entityId: ins.rows[0].id, dedupe: `convoy_created:${ins.rows[0].id}` }, req.user.id);
      return { row: ins.rows[0], replay: false };
    });
    if (!replay) await this.log(req, 'convoy.create', row.id, { convoy_no: row.convoy_no, truck_no: row.truck_no });
    return { ...row, replayed: replay };
  }

  @Get('convoys')
  @RequirePermissions('convoys:read')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.*, u.full_name AS collector_name, r.id AS reception_id, r.total_kg, r.bags, r.variance_kg, r.status AS reception_status, r.amount, r.unit_price
         FROM convoys v JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
         LEFT JOIN convoy_receptions r ON r.convoy_id = v.id
        WHERE ($1::text IS NULL OR v.status = $1)
          AND ($2::boolean OR k.user_id = $3)
        ORDER BY v.created_at DESC LIMIT 300`,
      [status ?? null, req.org.permissions.has('convoys:receive') || req.org.permissions.has('convoys:settle'), req.user.id])).rows);
  }

  /** Convois en route d'un collecteur donné : aide à la sélection par le magasinier. */
  @Get('convoys/expected')
  @RequirePermissions('convoys:receive')
  expected(@Req() req: any, @Query('collector_id') collectorId?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.id, v.convoy_no, v.collector_id, u.full_name AS collector_name, v.driver_name, v.truck_no, v.declared_bags, v.declared_kg, v.created_at
         FROM convoys v JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id WHERE v.status = 'in_transit' AND ($1::uuid IS NULL OR v.collector_id = $1) ORDER BY v.created_at`, [collectorId ?? null])).rows);
  }

  /** Stock acheté du collecteur connecté : achats déclarés, convois en route, livré au magasin central et solde du compte. */
  @Get('convoys/my-stock')
  @RequirePermissions('collector:stock')
  async myStock(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const k = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      if (!k) return { collector: false };
      const buy = (await c.query(
        `SELECT count(*)::int AS purchases,
                coalesce(sum(round(d.quantity * coalesce(CASE WHEN d.unit = 'kg' THEN 1 ELSE f.factor END, 0), 3)), 0) AS purchased_kg,
                coalesce(sum(d.bags), 0)::int AS purchased_bags,
                coalesce(sum(d.amount), 0) AS purchased_amount
           FROM purchase_declarations d LEFT JOIN unit_conversions f ON f.value_chain_id = d.value_chain_id AND f.from_unit = d.unit AND f.to_unit = 'kg'
          WHERE d.collector_id = $1 AND d.status IN ('received','in_review','accepted')`, [k.id])).rows[0];
      const cv = (await c.query(
        `SELECT coalesce(sum(v.declared_kg) FILTER (WHERE v.status = 'in_transit'), 0) AS in_transit_kg,
                count(*) FILTER (WHERE v.status = 'in_transit')::int AS in_transit_convoys,
                coalesce(sum(r.total_kg), 0) AS delivered_kg, coalesce(sum(r.bags), 0)::int AS delivered_bags,
                coalesce(sum(r.amount), 0) AS settled_amount,
                count(*) FILTER (WHERE r.status = 'pending_cashier')::int AS awaiting_cashier
           FROM convoys v LEFT JOIN convoy_receptions r ON r.convoy_id = v.id WHERE v.collector_id = $1`, [k.id])).rows[0];
      const bal = (await c.query(
        `SELECT coalesce(sum(CASE t.direction WHEN 'in' THEN t.amount ELSE -t.amount END), 0) AS balance
           FROM financial_accounts a JOIN financial_transactions t ON t.account_id = a.id WHERE a.owner_type = 'collector' AND a.owner_id = $1`, [k.id])).rows[0];
      const held = (await c.query(`SELECT greatest($1::numeric - $2::numeric, 0) AS kg`, [buy.purchased_kg, cv.delivered_kg])).rows[0].kg;
      return { collector: true, ...buy, ...cv, held_kg: held, balance: bal.balance };
    });
  }

  @Post('convoys/receive')
  @RequirePermissions('convoys:receive')
  async receive(@Body() b: ReceiveConvoyDto, @Req() req: any) {
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM convoy_receptions WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      if (Number(b.total_kg) <= 0) throw new BadRequestException('Poids total doit être supérieur à zéro');
      const v = (await c.query(`SELECT * FROM convoys WHERE collector_id = $1 AND convoy_no = $2 FOR UPDATE`, [b.collector_id, b.convoy_no.trim()])).rows[0];
      if (!v) throw new NotFoundException(`Aucun convoi « ${b.convoy_no.trim()} » pour ce collecteur`);
      if (v.status !== 'in_transit') throw new ConflictException('Ce convoi a déjà été réceptionné');
      const w = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!w || w.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');
      const variance = v.declared_kg == null ? null : (await c.query(`SELECT $1::numeric - $2::numeric AS d`, [b.total_kg, v.declared_kg])).rows[0].d;
      const ins = (await c.query(
        `INSERT INTO convoy_receptions(organization_id, idempotency_key, convoy_id, warehouse_id, total_kg, bags, variance_kg, received_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.org.id, b.idempotency_key, v.id, b.warehouse_id, b.total_kg, b.bags, variance, req.user.id, b.notes ?? null])).rows[0];
      await c.query(`UPDATE convoys SET status = 'received' WHERE id = $1`, [v.id]);
      await this.notif.notifyPermission(c, req.org.id, 'convoys:settle', { kind: 'convoy_received', severity: 'warning', title: `Réception à traiter en caisse : ${v.convoy_no}`,
        body: `${b.total_kg} kg · ${b.bags} sacs`, entityType: 'convoy', entityId: v.id, dedupe: `convoy_received:${v.id}` });
      await this.notif.notifyUsers(c, req.org.id, [(await c.query(`SELECT user_id FROM collectors WHERE id = $1`, [v.collector_id])).rows[0]?.user_id], { kind: 'convoy_received_mine',
        title: `Votre convoi ${v.convoy_no} a été reçu au magasin`, body: `${b.total_kg} kg · ${b.bags} sacs pesés`, entityType: 'convoy', entityId: v.id, dedupe: `convoy_received_mine:${v.id}` });
      return { row: ins, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.receive', row.convoy_id, { total_kg: row.total_kg, bags: row.bags, variance_kg: row.variance_kg });
    return { ...row, replayed: replay };
  }

  /** File d'attente de la caisse : réceptions en attente de traitement. */
  @Get('convoys/cashier-queue')
  @RequirePermissions('convoys:settle')
  queue(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.convoy_id, v.convoy_no, v.driver_name, v.truck_no, v.collector_id, u.full_name AS collector_name,
              r.total_kg, r.bags, r.variance_kg, r.received_at
         FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
        WHERE r.status = 'pending_cashier' ORDER BY r.received_at`)).rows);
  }

  /** La caisse traite la réception : calcule le montant (poids × prix) et crédite le compte du collecteur (écriture immuable). */
  @Post('convoy-receptions/:id/settle')
  @RequirePermissions('convoys:settle')
  async settle(@Param('id', ParseUUIDPipe) id: string, @Body() b: SettleDto, @Req() req: any) {
    if (Number(b.unit_price) <= 0) throw new BadRequestException('Prix unitaire doit être supérieur à zéro');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT * FROM convoy_receptions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.status === 'settled') return { row: r, replay: true };
      const v = (await c.query(`SELECT * FROM convoys WHERE id = $1`, [r.convoy_id])).rows[0];
      const u = (await c.query(`SELECT u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [v.collector_id])).rows[0];
      let acc = (await c.query(`SELECT id, currency, accounting_code FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [v.collector_id])).rows[0];
      if (!acc) acc = (await c.query(
        `INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, created_by) VALUES ($1,'collector',$2,$3,$4) RETURNING id, currency, accounting_code`,
        [req.org.id, v.collector_id, `Compte collecteur — ${u.full_name}`, req.user.id])).rows[0];
      const st = (await c.query(`SELECT convoy_transport_unit AS t, convoy_retention_per_kg AS r FROM org_settings`)).rows[0] ?? { t: '0', r: '0' };
      const tu = b.transport_unit ?? st.t, rt = b.retention_per_kg ?? st.r;
      const m = (await c.query(
        `SELECT round($1::numeric * $2::numeric, 4) AS gross, round($1::numeric * $3::numeric, 4) AS transport, round($1::numeric * $4::numeric, 4) AS retention`,
        [r.total_kg, b.unit_price, tu, rt])).rows[0];
      const amt = (await c.query(`SELECT $1::numeric + $2::numeric - $3::numeric AS n`, [m.gross, m.transport, m.retention])).rows[0].n;
      if (Number(amt) <= 0) throw new BadRequestException('La retenue dépasse le produit : net à payer nul ou négatif');
      const outstanding = (await c.query(
        `SELECT coalesce((SELECT sum(amount) FROM collector_advances WHERE collector_id = $1 AND kind = 'advance'), 0)
              - coalesce((SELECT sum(r2.advance_netted) FROM convoy_receptions r2 JOIN convoys v2 ON v2.id = r2.convoy_id WHERE v2.collector_id = $1), 0) AS o`, [v.collector_id])).rows[0].o;
      const maxNet = Math.max(0, Math.min(Number(outstanding), Number(amt)));
      const netted = b.net_advance === undefined ? maxNet : Number(b.net_advance);
      if (netted < 0 || netted > maxNet + 1e-9) throw new BadRequestException(`Netting supérieur au plafond possible (${maxNet} : avances non soldées ${Number(outstanding)}, net à payer ${Number(amt)})`);
      const tx = (await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,'in',$4,$5,$6,'convoy_reception',$7,$8) RETURNING id`,
        [req.org.id, 'convoy-' + b.idempotency_key, acc.id, amt, acc.currency, `Convoi ${v.convoy_no} : ${r.total_kg} kg × ${b.unit_price}`, r.id, req.user.id])).rows[0];
      await c.query(`INSERT INTO accounting_accounts(organization_id, code, label) VALUES ($1,'4781','Retenues sur règlements des collecteurs') ON CONFLICT DO NOTHING`, [req.org.id]);
      const lines: any[] = [{ code: '601', debit: m.gross }];
      if (Number(m.transport) > 0) lines.push({ code: '605', debit: m.transport, label: 'Transport' });
      lines.push({ code: acc.accounting_code ?? '401', credit: amt });
      if (Number(m.retention) > 0) lines.push({ code: '4781', credit: m.retention, label: 'Retenue' });
      await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'ACH', date: today(), label: `Achat convoi ${v.convoy_no} — ${u.full_name}`,
        lines, idempotencyKey: 'convoy-entry:' + r.id, referenceType: 'convoy_reception', referenceId: r.id,
      });
      let nettingNo: string | null = null;
      if (netted > 0) nettingNo = (await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'OD', date: today(), label: `Netting avances / dettes — convoi ${v.convoy_no} — ${u.full_name}`,
        lines: [{ code: acc.accounting_code ?? '401', debit: String(netted), label: 'Dette compensée' }, { code: '409', credit: String(netted), label: 'Avance imputée' }],
        idempotencyKey: 'convoy-netting:' + r.id, referenceType: 'convoy_reception', referenceId: r.id,
      })).number;
      const upd = (await c.query(
        `UPDATE convoy_receptions SET status = 'settled', unit_price = $2, amount = $3, tx_id = $4, settled_by = $5, settled_at = now(),
                gross_amount = $6, transport_unit = $7, transport_total = $8, retention_per_kg = $9, retention_amount = $10,
                advance_netted = $11, netting_entry_number = $12 WHERE id = $1 RETURNING *`,
        [id, b.unit_price, amt, tx.id, req.user.id, m.gross, tu, m.transport, rt, m.retention, netted, nettingNo])).rows[0];
      await c.query(`UPDATE convoys SET status = 'settled' WHERE id = $1`, [v.id]);
      await this.notif.notifyUsers(c, req.org.id, [(await c.query(`SELECT user_id FROM collectors WHERE id = $1`, [v.collector_id])).rows[0]?.user_id], { kind: 'convoy_settled',
        title: `Net à payer porté à votre compte : ${amt}`, body: `Convoi ${v.convoy_no} · ${r.total_kg} kg` + (netted > 0 ? ` · dont ${netted} imputés sur vos avances` : ''), entityType: 'convoy', entityId: v.id, dedupe: `convoy_settled:${v.id}` });
      return { row: upd, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.settle', row.convoy_id, { amount: row.amount, tx_id: row.tx_id });
    return { ...row, cash_due: Number(row.amount) - Number(row.advance_netted), replayed: replay };
  }


  /** Collecteurs actifs avec leur solde de fiche (financements − net à payer) : sélection pour la caisse. */
  @Get('convoys/collectors')
  @RequirePermissions('convoys:settle')
  collectors(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT k.id, u.full_name AS name,
              coalesce((SELECT sum(CASE t.direction WHEN 'out' THEN t.amount ELSE -t.amount END) FROM financial_accounts a JOIN financial_transactions t ON t.account_id = a.id
                         WHERE a.owner_type = 'collector' AND a.owner_id = k.id), 0) AS solde,
              coalesce((SELECT sum(amount) FROM collector_advances WHERE collector_id = k.id AND kind = 'advance'), 0)
                - coalesce((SELECT sum(r2.advance_netted) FROM convoy_receptions r2 JOIN convoys v2 ON v2.id = r2.convoy_id WHERE v2.collector_id = k.id), 0) AS advance_outstanding
         FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.status = 'active' ORDER BY u.full_name`)).rows);
  }

  @Get('convoys/settings')
  @RequirePermissions('convoys:settle')
  settings(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT coalesce((SELECT convoy_transport_unit FROM org_settings), 0) AS transport_unit, coalesce((SELECT convoy_retention_per_kg FROM org_settings), 0) AS retention_per_kg`)).rows[0]);
  }

  @Post('convoys/settings')
  @RequirePermissions('convoys:settle')
  async putSettings(@Body() b: SettingsDto, @Req() req: any) {
    await this.db.tx(req.org.id, (c) => c.query(
      `INSERT INTO org_settings(organization_id, convoy_transport_unit, convoy_retention_per_kg, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id) DO UPDATE SET convoy_transport_unit = EXCLUDED.convoy_transport_unit, convoy_retention_per_kg = EXCLUDED.convoy_retention_per_kg, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [req.org.id, b.transport_unit, b.retention_per_kg, req.user.id]));
    await this.log(req, 'convoy.settings', req.org.id, b);
    return b;
  }

  /** Financement remis au collecteur (« Finance cacao ») ou report du solde de campagne : augmente ce que le collecteur doit à la coopérative. */
  @Post('convoys/advances')
  @RequirePermissions('convoys:settle')
  async advance(@Body() b: AdvanceDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    if (b.operation_date && b.operation_date > today()) throw new BadRequestException("Date d'opération dans le futur");
    if (b.kind === 'advance' && !req.org.permissions.has('cash:operate')) throw new ForbiddenException('Un financement en espèces exige le droit « cash:operate »');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM collector_advances WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const k = (await c.query(`SELECT k.id, u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1 AND k.status = 'active'`, [b.collector_id])).rows[0];
      if (!k) throw new BadRequestException('Collecteur inconnu ou désactivé');
      let acc = (await c.query(`SELECT id, currency, accounting_code FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [k.id])).rows[0];
      if (!acc) acc = (await c.query(
        `INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, created_by) VALUES ($1,'collector',$2,$3,$4) RETURNING id, currency, accounting_code`,
        [req.org.id, k.id, `Compte collecteur — ${k.full_name}`, req.user.id])).rows[0];
      const label = b.label ?? (b.kind === 'advance' ? 'Finance cacao' : 'Solde de la campagne précédente');
      const when = b.operation_date ? `${b.operation_date}T12:00:00Z` : new Date().toISOString();
      const t1 = (await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, direction, amount, currency, reason, reference_type, reference_id, created_by, created_at)
         VALUES ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [req.org.id, 'adv-c:' + b.idempotency_key, acc.id, b.amount, acc.currency, label + (b.piece_no ? ` — pièce ${b.piece_no}` : ''),
         b.kind === 'advance' ? 'collector_advance' : 'collector_carry', k.id, req.user.id, when])).rows[0];
      if (b.kind === 'advance') {
        if (!b.cash_session_id) throw new BadRequestException('Un financement exige une session de caisse ouverte');
        const sess = (await c.query(`SELECT s.id, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 AND s.status = 'open'`, [b.cash_session_id])).rows[0];
        if (!sess) throw new BadRequestException('Session de caisse inconnue ou clôturée');
        const cash = (await c.query(`SELECT * FROM financial_accounts WHERE id = $1 FOR UPDATE`, [sess.account_id])).rows[0];
        const ok = (await c.query(
          `SELECT $2::numeric <= coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS ok, coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
             FROM financial_transactions WHERE account_id = $1`, [cash.id, b.amount])).rows[0];
        if (!ok.ok) throw new UnprocessableEntityException(`Solde de caisse insuffisant (${ok.balance})`);
        await c.query(
          `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by, created_at)
           VALUES ($1,$2,$3,$4,'out',$5,$6,$7,'collector_advance',$8,$9,$10)`,
          [req.org.id, 'adv-k:' + b.idempotency_key, cash.id, b.cash_session_id, b.amount, cash.currency, label, k.id, req.user.id, when]);
        await c.query(`SELECT accounting_seed($1::uuid)`, [req.org.id]);
        await postEntry(c, {
          orgId: req.org.id, userId: req.user.id, journal: 'CAI', date: b.operation_date ?? today(), label: `${label} — ${k.full_name}`,
          lines: [{ code: '409', debit: b.amount }, { code: accountingCodeOf(cash), credit: b.amount }],
          idempotencyKey: 'adv-entry:' + b.idempotency_key, referenceType: 'collector_advance', referenceId: t1.id,
        });
      }
      const ins = (await c.query(
        `INSERT INTO collector_advances(organization_id, idempotency_key, collector_id, kind, piece_no, label, amount, tx_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.org.id, b.idempotency_key, k.id, b.kind, b.piece_no ?? null, label, b.amount, t1.id, req.user.id, when])).rows[0];
      if (b.kind === 'advance')
        await this.notif.notifyUsers(c, req.org.id, [(await c.query(`SELECT user_id FROM collectors WHERE id = $1`, [k.id])).rows[0]?.user_id], { kind: 'collector_advance',
          title: `Financement de ${b.amount} enregistré sur votre fiche`, body: b.piece_no ? `Pièce ${b.piece_no}` : undefined, entityType: 'collector', entityId: k.id, dedupe: `collector_advance:${ins.id}` });
      return { row: ins, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.advance', row.id, { kind: b.kind, amount: b.amount, collector_id: b.collector_id });
    return { ...row, replayed: replay };
  }

  /**
   * Fiche de suivi du compte collecteur. Convention de la fiche papier : le solde est ce que le collecteur doit à la coopérative
   * (financements − net à payer des livraisons) ; un solde négatif est une somme due au collecteur.
   */
  @Get('convoys/statement')
  @RequirePermissions('convoys:read')
  async statement(@Req() req: any, @Query('collector_id') collectorId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.db.tx(req.org.id, async (c) => {
      const staff = req.org.permissions.has('convoys:settle');
      const mine = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      const cid = staff ? (collectorId ?? mine?.id) : mine?.id;
      if (!cid) throw new BadRequestException('Collecteur requis');
      if (!staff && collectorId && collectorId !== mine?.id) throw new ForbiddenException('Vous ne pouvez consulter que votre propre fiche');
      const who = (await c.query(`SELECT k.id, u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [cid])).rows[0];
      if (!who) throw new NotFoundException('Collecteur inconnu');
      const acc = (await c.query(`SELECT id FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1`, [cid])).rows[0];
      if (!acc) return { collector: who, opening: '0', rows: [], totals: { finance: '0', net: '0' }, solde: '0', advance_outstanding: '0' };
      const f = from ?? '1900-01-01', t = to ?? '2999-12-31';
      const opening = (await c.query(
        `SELECT coalesce(sum(CASE direction WHEN 'out' THEN amount ELSE -amount END), 0) AS o FROM financial_transactions WHERE account_id = $1 AND created_at < $2::date`, [acc.id, f])).rows[0].o;
      const rows = (await c.query(
        `SELECT x.id, x.created_at AS date, x.direction, x.amount, x.reason AS label, x.reference_type,
                coalesce(a.piece_no, v.convoy_no) AS piece, r.total_kg AS weight, r.unit_price, r.gross_amount, r.transport_unit, r.transport_total,
                (r.gross_amount + r.transport_total) AS product_total, r.retention_per_kg, r.retention_amount,
                r.advance_netted, CASE WHEN x.direction = 'in' THEN x.amount END AS net_payable, CASE WHEN x.direction = 'out' THEN x.amount END AS finance
           FROM financial_transactions x
           LEFT JOIN convoy_receptions r ON x.reference_type = 'convoy_reception' AND r.id = x.reference_id
           LEFT JOIN convoys v ON v.id = r.convoy_id
           LEFT JOIN collector_advances a ON a.tx_id = x.id
          WHERE x.account_id = $1 AND x.created_at >= $2::date AND x.created_at < ($3::date + 1)
          ORDER BY x.created_at, x.id`, [acc.id, f, t])).rows;
      const exact = (await c.query(
        `WITH o AS (SELECT $1::numeric AS o), r AS (SELECT x.id, CASE x.direction WHEN 'out' THEN x.amount ELSE -x.amount END AS d, x.created_at
           FROM financial_transactions x WHERE x.account_id = $2 AND x.created_at >= $3::date AND x.created_at < ($4::date + 1))
         SELECT r.id, (SELECT o FROM o) + sum(r.d) OVER (ORDER BY r.created_at, r.id) AS solde FROM r ORDER BY r.created_at, r.id`, [opening, acc.id, f, t])).rows;
      const by = new Map(exact.map((e: any) => [e.id, e.solde]));
      const withSolde = rows.map((r: any) => ({ ...r, solde: by.get(r.id) }));
      const totals = (await c.query(
        `SELECT coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0) AS finance, coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0) AS net
           FROM financial_transactions WHERE account_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)`, [acc.id, f, t])).rows[0];
      const end = withSolde.length ? withSolde[withSolde.length - 1].solde : opening;
      const advOut = (await c.query(
        `SELECT coalesce((SELECT sum(amount) FROM collector_advances WHERE collector_id = $1 AND kind = 'advance'), 0)
              - coalesce((SELECT sum(r2.advance_netted) FROM convoy_receptions r2 JOIN convoys v2 ON v2.id = r2.convoy_id WHERE v2.collector_id = $1), 0) AS o`, [cid])).rows[0].o;
      return { collector: who, opening, rows: withSolde, totals, solde: end, advance_outstanding: advOut };
    });
  }

  /** Paiement en espèces au collecteur : débite son compte et sort la somme de la caisse (session ouverte), avec l'écriture comptable. */
  @Post('convoys/payout')
  @RequirePermissions('convoys:settle', 'cash:operate')
  async payout(@Body() b: PayoutDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT id, amount FROM financial_transactions WHERE idempotency_key = $1`, ['payout-c:' + b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const acc = (await c.query(`SELECT * FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [b.collector_id])).rows[0];
      if (!acc) throw new NotFoundException('Ce collecteur n\'a pas encore de compte crédité');
      const sess = (await c.query(
        `SELECT s.id, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 AND s.status = 'open'`, [b.cash_session_id])).rows[0];
      if (!sess) throw new BadRequestException('Session de caisse inconnue ou clôturée');
      const cash = (await c.query(`SELECT * FROM financial_accounts WHERE id = $1 FOR UPDATE`, [sess.account_id])).rows[0];
      const bal = (account: string) => c.query(
        `SELECT $2::numeric <= coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS ok, coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
           FROM financial_transactions WHERE account_id = $1`, [account, b.amount]).then((r) => r.rows[0]);
      const bc = await bal(acc.id);
      if (!bc.ok) throw new UnprocessableEntityException(`Solde du compte du collecteur insuffisant (${bc.balance})`);
      const bk = await bal(cash.id);
      if (!bk.ok) throw new UnprocessableEntityException(`Solde de caisse insuffisant (${bk.balance})`);
      const reason = 'Paiement en espèces au collecteur';
      const t1 = (await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,'out',$4,$5,$6,'collector_payout',$7,$8) RETURNING id, amount`,
        [req.org.id, 'payout-c:' + b.idempotency_key, acc.id, b.amount, acc.currency, reason, b.collector_id, req.user.id])).rows[0];
      await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,$4,'out',$5,$6,$7,'collector_payout',$8,$9)`,
        [req.org.id, 'payout-k:' + b.idempotency_key, cash.id, b.cash_session_id, b.amount, cash.currency, reason, b.collector_id, req.user.id]);
      await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'CAI', date: today(), label: reason,
        lines: [{ code: acc.accounting_code ?? '401', debit: b.amount }, { code: accountingCodeOf(cash), credit: b.amount }],
        idempotencyKey: 'payout-entry:' + b.idempotency_key, referenceType: 'collector_payout', referenceId: t1.id,
      });
      return { row: t1, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.payout', row.id, { amount: b.amount, collector_id: b.collector_id });
    return { ...row, replayed: replay };
  }
}
