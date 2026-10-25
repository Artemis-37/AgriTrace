import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, Matches, IsString, IsUUID, Length, Min } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { accountingCodeOf, postEntry, today } from '../accounting/accounting.helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { nextConvoyNo } from './convoy-number';
import { effectiveBuyPrice } from '../products/price';
import { delegateRates } from '../collectors/rates';

export class CreateConvoyDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  /** Numéro de connaissement : généré par le logiciel dès que la coopérative a un code CCC (toute valeur envoyée est alors ignorée) ; saisi sinon. */
  @IsOptional() @IsString() @Length(2, 60) convoy_no?: string;
  @IsOptional() @IsUUID() collector_id?: string;
  @IsString() @Length(2, 120) driver_name: string;
  @IsString() @Length(2, 40) truck_no: string;
  @IsOptional() @IsInt() @Min(0) declared_bags?: number;
  @IsOptional() @Dec(3) declared_kg?: string;
  @IsOptional() @IsString() @Length(1, 40) trailer_no?: string;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
  /** Produit convoyé annoncé par le délégué ; le magasinier le confirme ou le change à la pesée. */
  @IsOptional() @IsUUID() product_id?: string;
  /** Achats chargés dans ce convoi (déclarations du délégué, une seule fois chacune). Sans poids/sacs annoncés, ils sont déduits de ces achats. */
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsUUID('all', { each: true }) declaration_ids?: string[];
}
const DECL_KG = `round(d.quantity * coalesce(CASE WHEN d.unit = 'kg' THEN 1 ELSE f.factor END, 0), 3)`;
const DECL_JOIN = `LEFT JOIN unit_conversions f ON f.value_chain_id = d.value_chain_id AND f.from_unit = d.unit AND f.to_unit = 'kg'`;
export class ReceiveConvoyDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() collector_id: string;
  @IsString() @Length(2, 60) convoy_no: string;
  @IsUUID() warehouse_id: string;
  /** Poids net retenu pour le paiement. Omis si la double pesée est fournie : calculé = entrée − sortie − tare des sacs − réfaction. */
  /** Produit et campagne de la pesée ; sans campagne, celle qui couvre la date du jour. */
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() campaign_id?: string;
  /** Poids pesé (brut) : le poids net payé = poids − nombre de sacs déchargés (1 kg par sac). */
  @IsOptional() @Dec(3) gross_kg?: string;
  @IsOptional() @Dec(3) total_kg?: string;
  @IsInt() @Min(1) bags: number;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
  // Bulletin de pesée (tout est facultatif)
  @IsOptional() @IsString() @Length(1, 40) trailer_no?: string;
  /** Saisie complète : si ce connaissement n'a pas été déclaré par le délégué, le magasinier le crée à la réception avec ces informations. */
  @IsOptional() @IsString() @Length(2, 120) driver_name?: string;
  @IsOptional() @IsString() @Length(2, 40) truck_no?: string;
  @IsOptional() @IsInt() @Min(0) declared_bags?: number;
  @IsOptional() @Dec(3) declared_kg?: string;
  @IsOptional() @Dec(3) weigh_in_kg?: string;
  @IsOptional() @IsString() @Length(1, 40) scale_in?: string;
  @IsOptional() @Dec(3) weigh_out_kg?: string;
  @IsOptional() @IsString() @Length(1, 40) scale_out?: string;
  @IsOptional() @Dec(3) bag_tare_kg?: string;
  @IsOptional() @Dec(3) refaction_kg?: string;
  @IsOptional() @IsString() @Length(1, 20) grade?: string;
  @IsOptional() @IsInt() @Min(0) bags_unloaded?: number;
  @IsOptional() @IsInt() @Min(0) bags_refused?: number;
  /** Analyse qualité : humidité, grainage, déchets, etc. (clé libre → valeur courte). */
  @IsOptional() @IsObject() analysis?: Record<string, string>;
}
class AnalysisDto {
  @IsObject() analysis: Record<string, string>;
  @IsOptional() @IsString() @Length(1, 20) grade?: string;
}
class SettleDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  /** P.U. : prix d'achat au kg. */
  @IsOptional() @Dec(4) unit_price?: string;
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
  /** Écart de poids toléré entre le connaissement et la pesée, en % du poids déclaré (défaut 2). */
  @IsOptional() @Dec(3) weight_tolerance_pct?: string;
}
class VarianceDto { @IsString() @Length(5, 500) comment: string; }
/** Motifs reconnus d'un financement remis à un délégué : libellé de l'écriture et classement des mouvements. */
export const ADVANCE_MOTIVES: Record<string, string> = {
  finance_cacao: 'Finance cacao (avance de campagne)',
  avance_achat: 'Avance pour achat de produits',
  frais_collecte: 'Frais de collecte et de transport',
  depannage: 'Dépannage / avance au délégué',
  autre: 'Autre motif',
};
export class AdvanceDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsUUID() collector_id: string;
  /** advance = financement remis en espèces (caisse) ; carry_forward = report du solde de la campagne précédente (sans mouvement de caisse). */
  @IsIn(['advance', 'carry_forward']) kind: string;
  @Dec(4) amount: string;
  @IsOptional() @IsString() @Length(1, 60) piece_no?: string;
  @IsOptional() @IsString() @Length(1, 200) label?: string;
  @IsOptional() @IsUUID() cash_session_id?: string;
  /** Mode de paiement : espèces (sortie de caisse) ou chèque (sortie du compte bancaire). */
  @IsOptional() @IsIn(['cash', 'cheque']) payment_mode?: string;
  /** N° du chèque : obligatoire si le paiement est fait par chèque. */
  @IsOptional() @IsString() @Length(1, 60) cheque_no?: string;
  @IsOptional() @IsString() @Length(1, 60) slip_no?: string;
  /** Motif codé (voir ADVANCE_MOTIVES) : le logiciel s'en sert pour classer et libeller le mouvement. */
  @IsOptional() @IsIn(Object.keys(ADVANCE_MOTIVES)) motive?: string;
  @IsOptional() @IsUUID() bank_account_id?: string;
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
      if (!collectorId) throw new BadRequestException('Délégué requis (le compte connecté n\'est pas un délégué)');
      if (own && b.collector_id && b.collector_id !== own.id) throw new BadRequestException('Un délégué ne peut déclarer que ses propres convois');
      if (!(await c.query(`SELECT 1 FROM collectors WHERE id = $1 AND status = 'active'`, [collectorId])).rowCount) throw new BadRequestException('Délégué inconnu ou désactivé');
      if (b.product_id && !(await c.query(`SELECT 1 FROM products WHERE id = $1 AND active`, [b.product_id])).rowCount) throw new BadRequestException('Produit inconnu ou inactif');
      const auto = await nextConvoyNo(c, req.org.id, collectorId, true);
      const convoyNo = auto ? auto.convoy_no : b.convoy_no?.trim();
      if (!convoyNo || convoyNo.length < 2) throw new BadRequestException('Numéro de connaissement requis (renseignez le code CCC de la coopérative pour le générer automatiquement)');
      if ((await c.query(`SELECT 1 FROM convoys WHERE convoy_no = $1`, [convoyNo])).rowCount)
        throw new ConflictException(`Le numéro de convoi « ${convoyNo} » existe déjà`);
      const ids = [...new Set(b.declaration_ids ?? [])];
      let linked: any[] = [];
      if (ids.length) {
        linked = (await c.query(
          `SELECT d.id, d.bags, d.status, d.collector_id, ${DECL_KG} AS kg, EXISTS (SELECT 1 FROM convoy_declarations x WHERE x.declaration_id = d.id) AS taken
             FROM purchase_declarations d ${DECL_JOIN} WHERE d.id = ANY($1::uuid[]) FOR UPDATE OF d`, [ids])).rows;
        if (linked.length !== ids.length) throw new BadRequestException('Achat inconnu parmi ceux du convoi');
        if (linked.some((d) => d.collector_id !== collectorId)) throw new BadRequestException('Un convoi ne peut contenir que les achats de son délégué');
        if (linked.some((d) => !['received', 'in_review', 'accepted'].includes(d.status))) throw new BadRequestException('Seuls les achats reçus par la coopérative (non rejetés) peuvent être chargés');
        if (linked.some((d) => d.taken)) throw new ConflictException('Un des achats est déjà chargé dans un autre convoi');
        if (linked.some((d) => Number(d.kg) <= 0)) throw new BadRequestException('Un des achats n\'a pas de conversion en kg : poids inconnu');
      }
      const linkedKg = linked.reduce((a, d) => a + Number(d.kg), 0), linkedBags = linked.reduce((a, d) => a + Number(d.bags ?? 0), 0);
      const ins = await c.query(
        `INSERT INTO convoys(organization_id, idempotency_key, convoy_no, collector_id, driver_name, truck_no, declared_bags, declared_kg, notes, created_by, trailer_no, product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.org.id, b.idempotency_key, convoyNo, collectorId, b.driver_name.trim(), b.truck_no.trim().toUpperCase(),
         b.declared_bags ?? (linked.length ? linkedBags : null), b.declared_kg ?? (linked.length ? linkedKg.toFixed(3) : null), b.notes ?? null, req.user.id, b.trailer_no?.trim() || null, b.product_id ?? null]);
      for (const d of linked) await c.query(`INSERT INTO convoy_declarations(organization_id, convoy_id, declaration_id, kg, bags) VALUES ($1,$2,$3,$4,$5)`, [req.org.id, ins.rows[0].id, d.id, d.kg, d.bags ?? 0]);
      const who = (await c.query(`SELECT u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [collectorId])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'convoys:receive', { kind: 'convoy_created', title: `Convoi en route : ${ins.rows[0].convoy_no}`,
        body: `${who?.full_name ?? 'Délégué'} · camion ${ins.rows[0].truck_no} · chauffeur ${ins.rows[0].driver_name}`, entityType: 'convoy', entityId: ins.rows[0].id, dedupe: `convoy_created:${ins.rows[0].id}` }, req.user.id);
      return { row: ins.rows[0], replay: false };
    });
    if (!replay) await this.log(req, 'convoy.create', row.id, { convoy_no: row.convoy_no, truck_no: row.truck_no });
    return { ...row, replayed: replay };
  }

  /** Prochain numéro de connaissement (aperçu, rien n'est réservé). `auto: false` : la coopérative n'a pas de code CCC, le numéro se saisit. `pending` : convois déjà en file d'attente sur l'appareil. */
  @Get('convoys/next-number')
  @RequirePermissions('convoys:create')
  nextNumber(@Req() req: any, @Query('collector_id') collectorId?: string, @Query('pending') pending?: string) {
    return this.db.tx(req.org.id, async (c) => {
      const own = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      const id = own?.id ?? collectorId;
      if (!id) throw new BadRequestException('Délégué requis');
      const r = await nextConvoyNo(c, req.org.id, id, false, Math.max(0, Math.min(50, parseInt(pending ?? '0', 10) || 0)));
      return r ? { auto: true, ...r } : { auto: false, convoy_no: null, ccc_code: null };
    });
  }

  /** Achats du délégué pas encore chargés dans un convoi (reçus, en revue ou acceptés). */
  @Get('convoys/available-declarations')
  @RequirePermissions('convoys:create')
  availableDeclarations(@Req() req: any, @Query('collector_id') collectorId?: string) {
    return this.db.tx(req.org.id, async (c) => {
      const own = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      const col = own?.id ?? collectorId;
      if (!col) return [];
      return (await c.query(
        `SELECT d.id, d.operation_date, d.bags, d.quantity, d.unit, ${DECL_KG} AS kg, p.last_name || ' ' || p.first_names AS producer_name, p.internal_code AS producer_code
           FROM purchase_declarations d ${DECL_JOIN} JOIN producers p ON p.id = d.producer_id
          WHERE d.collector_id = $1 AND d.status IN ('received','in_review','accepted') AND NOT EXISTS (SELECT 1 FROM convoy_declarations x WHERE x.declaration_id = d.id)
          ORDER BY d.operation_date, d.created_at`, [col])).rows;
    });
  }

  /** Achats chargés dans un convoi (pour la réception : ce que le camion est censé transporter). */
  @Get('convoys/:id/declarations')
  @RequirePermissions('convoys:read')
  convoyDeclarations(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const own = (await c.query(`SELECT id FROM collectors WHERE user_id = $1`, [req.user.id])).rows[0];
      const v = (await c.query(`SELECT collector_id FROM convoys WHERE id = $1`, [id])).rows[0];
      if (!v || (own && own.id !== v.collector_id && !req.org.permissions.has('convoys:receive') && !req.org.permissions.has('convoys:settle'))) throw new NotFoundException();
      return (await c.query(
        `SELECT x.declaration_id AS id, x.kg, x.bags, d.operation_date, p.last_name || ' ' || p.first_names AS producer_name, p.internal_code AS producer_code
           FROM convoy_declarations x JOIN purchase_declarations d ON d.id = x.declaration_id JOIN producers p ON p.id = d.producer_id
          WHERE x.convoy_id = $1 ORDER BY d.operation_date`, [id])).rows;
    });
  }

  @Get('convoys')
  @RequirePermissions('convoys:read')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.*, u.full_name AS collector_name, r.id AS reception_id, r.total_kg, r.bags, r.variance_kg, r.status AS reception_status, r.amount, r.unit_price, pr.name AS product, pr.buy_price_per_kg AS product_buy_price, v.product_id AS declared_product_id
         FROM convoys v JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
         LEFT JOIN convoy_receptions r ON r.convoy_id = v.id
         LEFT JOIN products pr ON pr.id = coalesce(r.product_id, v.product_id)
        WHERE ($1::text IS NULL OR v.status = $1)
          AND ($2::boolean OR k.user_id = $3)
        ORDER BY v.created_at DESC LIMIT 300`,
      [status ?? null, req.org.permissions.has('convoys:receive') || req.org.permissions.has('convoys:settle'), req.user.id])).rows);
  }

  /** Délégués actifs, pour la saisie d'une pesée : un délégué sans convoi déclaré peut aussi être pesé (connaissement saisi par le magasinier). */
  @Get('convoys/receivable-collectors')
  @RequirePermissions('convoys:receive')
  receivableCollectors(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT k.id AS collector_id, u.full_name AS collector_name, k.origin AS collector_origin,
              (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS collector_code
         FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.status = 'active' ORDER BY u.full_name`)).rows);
  }

  /** Convois en route d'un délégué donné : aide à la sélection par le magasinier. */
  @Get('convoys/expected')
  @RequirePermissions('convoys:receive')
  expected(@Req() req: any, @Query('collector_id') collectorId?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT v.id, v.trailer_no, k.origin AS collector_origin, v.convoy_no, v.collector_id, u.full_name AS collector_name, (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS collector_code, v.driver_name, v.truck_no, v.declared_bags, v.declared_kg, v.created_at, v.product_id, (SELECT name FROM products WHERE id = v.product_id) AS product,
              coalesce((SELECT convoy_weight_tolerance_pct FROM org_settings), 2) AS weight_tolerance_pct,
              (SELECT count(*)::int FROM convoy_declarations x WHERE x.convoy_id = v.id) AS declaration_count
         FROM convoys v JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id WHERE v.status = 'in_transit' AND ($1::uuid IS NULL OR v.collector_id = $1) ORDER BY v.created_at`, [collectorId ?? null])).rows);
  }

  /** Liste des pesées (réceptions) : filtre traité / non traité, recherche, période. Un délégué ne voit que les siennes. */
  @Get('convoys/receptions')
  @RequirePermissions('convoys:read')
  receptions(@Req() req: any, @Query('state') state?: string, @Query('q') q?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('campaign_id') campaignId?: string, @Query('product_id') productId?: string) {
    return this.receptionRows(req, req.org.permissions.has('convoys:receive') || req.org.permissions.has('convoys:settle'), state, q, from, to, campaignId, productId);
  }

  /** États comptables : toutes les pesées, en lecture, pour le comptable. */
  @Get('accounting/etats/pesees')
  @RequirePermissions('accounting:read')
  etatPesees(@Req() req: any, @Query('state') state?: string, @Query('q') q?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('campaign_id') campaignId?: string, @Query('product_id') productId?: string) {
    return this.receptionRows(req, true, state, q, from, to, campaignId, productId);
  }

  /** Soldes des délégués (code, contact, localité), en lecture, pour le comptable. */
  @Get('accounting/etats/delegues')
  @RequirePermissions('accounting:read')
  etatDelegues(@Req() req: any) { return this.collectors(req); }

  private receptionRows(req: any, all: boolean, state?: string, q?: string, from?: string, to?: string, campaignId?: string, productId?: string) {
    const u = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.bulletin_no, v.convoy_no, r.received_at, u.full_name AS collector_name,
              (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS collector_code,
              k.origin, r.bags, r.gross_kg, r.refaction_kg, r.total_kg, r.grade, r.status, r.unit_price, r.amount, r.settled_at, r.variance_kg, r.product_id, r.campaign_id, p.name AS product, cp.name AS campaign, cp.traite,
              (SELECT pp.buy_price_per_kg FROM product_prices pp WHERE pp.product_id = r.product_id AND pp.campaign_id = r.campaign_id AND pp.buy_price_per_kg IS NOT NULL ORDER BY pp.created_at DESC LIMIT 1) AS traite_price
         FROM convoy_receptions r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN campaigns cp ON cp.id = r.campaign_id JOIN convoys v ON v.id = r.convoy_id JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
        WHERE ($1::boolean OR k.user_id = $2)
          AND ($3::text IS NULL OR ($3 = 'settled' AND r.status = 'settled') OR ($3 = 'pending' AND r.status <> 'settled'))
          AND ($4::text IS NULL OR u.full_name ILIKE '%' || $4 || '%' OR v.convoy_no ILIKE '%' || $4 || '%' OR r.bulletin_no ILIKE '%' || $4 || '%'
               OR EXISTS (SELECT 1 FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id AND mc.code ILIKE '%' || $4 || '%'))
          AND ($5::date IS NULL OR r.received_at >= $5::date) AND ($6::date IS NULL OR r.received_at < $6::date + 1)
          AND ($7::uuid IS NULL OR r.campaign_id = $7) AND ($8::uuid IS NULL OR r.product_id = $8)
        ORDER BY r.received_at DESC LIMIT 500`,
      [all, req.user.id, state === 'settled' || state === 'pending' ? state : null, q?.trim().slice(0, 60) || null, d(from), d(to), u(campaignId), u(productId)])).rows);
  }

  /** Réceptions récentes du magasinier (analyses à compléter tant que la caisse n'a pas réglé). */
  @Get('convoys/receptions/recent')
  @RequirePermissions('convoys:receive')
  recentReceptions(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.bulletin_no, v.convoy_no, r.received_at, r.total_kg, r.status, r.grade, r.analysis
         FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id ORDER BY r.received_at DESC LIMIT 30`)).rows);
  }

  /** Résultats d'analyse saisis (ou corrigés) après la pesée, tant que la réception n'est pas réglée en caisse. Le poids net n'est pas modifié. */
  @Patch('convoys/receptions/:id/analysis')
  @RequirePermissions('convoys:receive')
  async setAnalysis(@Param('id', ParseUUIDPipe) id: string, @Body() b: AnalysisDto, @Req() req: any) {
    const an = Object.entries(b.analysis);
    if (an.length > 30 || an.some(([k, v]) => k.length > 40 || typeof v !== 'string' || v.length > 10)) throw new BadRequestException('Analyse invalide (30 lignes au plus, valeurs de 10 caractères au plus)');
    const row = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT id, status, convoy_id FROM convoy_receptions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!r) throw new NotFoundException('Réception introuvable');
      if (r.status === 'settled') throw new ConflictException('Réception déjà réglée en caisse : le bulletin ne peut plus être modifié');
      await c.query(`UPDATE convoy_receptions SET analysis = $2::jsonb, grade = coalesce($3, grade) WHERE id = $1`, [id, JSON.stringify(b.analysis), b.grade ?? null]);
      return r;
    });
    await this.log(req, 'convoy.analysis', row.convoy_id, { reception_id: id, lines: an.length });
    return { ok: true };
  }

  /** Stock acheté du délégué connecté : achats déclarés, convois en route, livré au magasin central et solde du compte. */
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
      // Double pesée : brut = entrée − sortie ; net payé = brut − tare des sacs − réfaction (calculs exacts en SQL).
      let gross: string | null = null;
      let net = b.total_kg ?? null;
      if (b.weigh_in_kg != null || b.weigh_out_kg != null) {
        if (b.weigh_in_kg == null || b.weigh_out_kg == null) throw new BadRequestException('Double pesée : indiquez le poids à l’entrée et à la sortie');
        const g = (await c.query(`SELECT $1::numeric - $2::numeric AS g`, [b.weigh_in_kg, b.weigh_out_kg])).rows[0].g;
        if (Number(g) <= 0) throw new BadRequestException('Le poids à l’entrée doit dépasser le poids à la sortie');
        gross = g;
        const n = (await c.query(`SELECT $1::numeric - coalesce($2::numeric,0) - coalesce($3::numeric,0) AS n`, [g, b.bag_tare_kg ?? null, b.refaction_kg ?? null])).rows[0].n;
        if (Number(n) <= 0) throw new BadRequestException('Le poids net doit être supérieur à zéro (tare et réfaction trop élevées)');
        if (b.total_kg != null && Number(b.total_kg) !== Number(n)) throw new BadRequestException(`Poids net incohérent : la double pesée donne ${Number(n)} kg`);
        net = n;
      }
      if (b.gross_kg != null) {
        // Poids net payé = poids − sacs déchargés (1 kg par sac) ; la réfaction enregistrée est ce nombre de sacs.
        if (b.bags_unloaded == null) throw new BadRequestException('Indiquez le nombre de sacs déchargés : il sert au calcul du poids net');
        const n = (await c.query(`SELECT $1::numeric - $2::numeric AS n`, [b.gross_kg, b.bags_unloaded])).rows[0].n;
        if (Number(n) <= 0) throw new BadRequestException('Le poids net doit être supérieur à zéro');
        if (b.total_kg != null && Number(b.total_kg) !== Number(n)) throw new BadRequestException(`Poids net incohérent : poids − sacs déchargés = ${Number(n)} kg`);
        gross = b.gross_kg; b.refaction_kg = String(b.bags_unloaded); net = n;
      }
      if (net == null || Number(net) <= 0) throw new BadRequestException('Poids total doit être supérieur à zéro');
      b.total_kg = net;
      const an = Object.entries(b.analysis ?? {});
      if (an.length > 30 || an.some(([k, v]) => k.length > 40 || typeof v !== 'string' || v.length > 10)) throw new BadRequestException('Analyse invalide (30 lignes au plus, valeurs de 10 caractères au plus)');
      if (b.bags_unloaded != null && b.bags_refused != null && b.bags_unloaded < b.bags_refused) throw new BadRequestException('Sacs refusés supérieurs aux sacs déchargés');
      let v = (await c.query(`SELECT * FROM convoys WHERE collector_id = $1 AND convoy_no = $2 FOR UPDATE`, [b.collector_id, b.convoy_no.trim()])).rows[0];
      if (!v) {
        // Saisie complète : connaissement non déclaré par le délégué, créé par le magasinier à la réception.
        if (!b.driver_name || !b.truck_no) throw new NotFoundException(`Aucun convoi « ${b.convoy_no.trim()} » pour ce délégué : saisissez le chauffeur et le camion pour l'enregistrer à la réception`);
        if (!(await c.query(`SELECT 1 FROM collectors WHERE id = $1 AND status = 'active'`, [b.collector_id])).rowCount) throw new BadRequestException('Délégué inconnu ou désactivé');
        if ((await c.query(`SELECT 1 FROM convoys WHERE convoy_no = $1`, [b.convoy_no.trim()])).rowCount) throw new ConflictException(`Le numéro de convoi « ${b.convoy_no.trim()} » existe déjà`);
        v = (await c.query(`INSERT INTO convoys(organization_id, idempotency_key, convoy_no, collector_id, driver_name, truck_no, declared_bags, declared_kg, created_by, trailer_no)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [req.org.id, `${b.idempotency_key}-cv`, b.convoy_no.trim(), b.collector_id, b.driver_name.trim(), b.truck_no.trim().toUpperCase(), b.declared_bags ?? null, b.declared_kg ?? null, req.user.id, b.trailer_no ?? null])).rows[0];
      }
      if (v.status !== 'in_transit') throw new ConflictException('Ce convoi a déjà été réceptionné');
      if (b.product_id && !(await c.query(`SELECT 1 FROM products WHERE id = $1 AND active`, [b.product_id])).rowCount) throw new BadRequestException('Produit inconnu ou inactif');
      let campaignId = b.campaign_id ?? null;
      if (campaignId && !(await c.query(`SELECT 1 FROM campaigns WHERE id = $1`, [campaignId])).rowCount) throw new BadRequestException('Campagne inconnue');
      // Traite en cours : celle de la filière du produit (grande ou petite traite selon la date), sinon n'importe quelle traite ouverte.
      if (!campaignId) campaignId = (await c.query(`SELECT id FROM campaigns WHERE status = 'open' AND current_date BETWEEN starts_on AND ends_on ORDER BY EXISTS (SELECT 1 FROM campaign_products cp WHERE cp.campaign_id = campaigns.id AND cp.product_id = $1) DESC, (value_chain_id IS NOT DISTINCT FROM (SELECT value_chain_id FROM products WHERE id = $1)) DESC, starts_on DESC LIMIT 1`, [b.product_id ?? null])).rows[0]?.id ?? null;
      const w = (await c.query(`SELECT status FROM warehouses WHERE id = $1`, [b.warehouse_id])).rows[0];
      if (!w || w.status !== 'active') throw new BadRequestException('Magasin inconnu ou fermé');
      const variance = v.declared_kg == null ? null : (await c.query(`SELECT $1::numeric - $2::numeric AS d`, [b.total_kg, v.declared_kg])).rows[0].d;
      // Écart au-delà de la tolérance : la caisse ne peut pas payer avant la validation d'un second utilisateur.
      const tol = (await c.query(`SELECT coalesce((SELECT convoy_weight_tolerance_pct FROM org_settings), 2) AS t`)).rows[0].t;
      const vpct = variance == null || Number(v.declared_kg) <= 0 ? null : (await c.query(`SELECT round(abs($1::numeric) * 100 / $2::numeric, 3) AS p`, [variance, v.declared_kg])).rows[0].p;
      const held = vpct != null && Number(vpct) > Number(tol);
      if (held && (!b.notes || b.notes.trim().length < 5)) throw new BadRequestException(`Écart de poids de ${vpct} % (tolérance ${Number(tol)} %) : précisez la cause dans les observations`);
      // N° de bulletin séquentiel par coopérative et par année (BP-2026-000001).
      const yr = new Date().getFullYear();
      const cnt = (await c.query(`INSERT INTO bulletin_counters(organization_id, year, last_no) VALUES ($1,$2,1)
        ON CONFLICT (organization_id, year) DO UPDATE SET last_no = bulletin_counters.last_no + 1 RETURNING last_no`, [req.org.id, yr])).rows[0].last_no;
      const bulletinNo = `BP-${yr}-${String(cnt).padStart(6, '0')}`;
      const ins = (await c.query(
        `INSERT INTO convoy_receptions(organization_id, idempotency_key, convoy_id, warehouse_id, total_kg, bags, variance_kg, variance_pct, received_by, notes, status,
           bulletin_no, trailer_no, origin, weigh_in_kg, weigh_in_at, scale_in, weigh_out_kg, weigh_out_at, scale_out, gross_kg, bag_tare_kg, refaction_kg, grade, bags_unloaded, bags_refused, analysis, product_id, campaign_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
           $12,$13,$14,$15,CASE WHEN $15::numeric IS NULL THEN NULL ELSE now() END,$16,$17,CASE WHEN $17::numeric IS NULL THEN NULL ELSE now() END,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`,
        [req.org.id, b.idempotency_key, v.id, b.warehouse_id, b.total_kg, b.bags, variance, vpct, req.user.id, b.notes ?? null, held ? 'pending_variance' : 'pending_cashier',
         bulletinNo, b.trailer_no ?? v.trailer_no ?? null, (await c.query(`SELECT origin FROM collectors WHERE id = $1`, [v.collector_id])).rows[0]?.origin ?? null, b.weigh_in_kg ?? null, b.scale_in ?? null, b.weigh_out_kg ?? null, b.scale_out ?? null, gross, b.bag_tare_kg ?? null, b.refaction_kg ?? null,
         b.grade ?? null, b.bags_unloaded ?? null, b.bags_refused ?? null, JSON.stringify(b.analysis ?? {}), b.product_id ?? v.product_id ?? null, campaignId])).rows[0];
      await c.query(`UPDATE convoys SET status = 'received' WHERE id = $1`, [v.id]);
      if (held) await this.notif.notifyPermission(c, req.org.id, 'weighings:approve', { kind: 'convoy_variance', severity: 'warning', title: `Écart de poids à valider : convoi ${v.convoy_no}`,
        body: `${variance} kg (${vpct} %) · ${b.notes}`, entityType: 'convoy', entityId: v.id, dedupe: `convoy_variance:${v.id}` });
      else await this.notif.notifyPermission(c, req.org.id, 'convoys:settle', { kind: 'convoy_received', severity: 'warning', title: `Réception à traiter en caisse : ${v.convoy_no}`,
        body: `${b.total_kg} kg · ${b.bags} sacs`, entityType: 'convoy', entityId: v.id, dedupe: `convoy_received:${v.id}` });
      await this.notif.notifyUsers(c, req.org.id, [(await c.query(`SELECT user_id FROM collectors WHERE id = $1`, [v.collector_id])).rows[0]?.user_id], { kind: 'convoy_received_mine',
        title: `Votre convoi ${v.convoy_no} a été reçu au magasin`, body: `${b.total_kg} kg · ${b.bags} sacs pesés`, entityType: 'convoy', entityId: v.id, dedupe: `convoy_received_mine:${v.id}` });
      return { row: ins, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.receive', row.convoy_id, { total_kg: row.total_kg, bags: row.bags, variance_kg: row.variance_kg });
    return { ...row, replayed: replay };
  }

  /** Écarts de poids en attente de validation (au-delà de la tolérance). */
  @Get('convoys/variance-queue')
  @RequirePermissions('weighings:approve')
  varianceQueue(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT r.id, r.convoy_id, v.convoy_no, v.collector_id, u.full_name AS collector_name, v.declared_kg, r.total_kg, r.variance_kg, r.variance_pct, r.notes, r.received_at
         FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
        WHERE r.status = 'pending_variance' ORDER BY r.received_at`)).rows);
  }

  /** Validation de l'écart par un autre utilisateur que celui qui a réceptionné : la réception passe alors en caisse. */
  @Post('convoy-receptions/:id/approve-variance')
  @RequirePermissions('weighings:approve')
  async approveVariance(@Param('id', ParseUUIDPipe) id: string, @Body() b: VarianceDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const cur = (await c.query(`SELECT * FROM convoy_receptions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!cur) throw new NotFoundException();
      if (cur.status !== 'pending_variance') throw new ConflictException('Cette réception n\'attend pas de validation d\'écart');
      if (cur.received_by === req.user.id) throw new ForbiddenException('L\'écart doit être validé par un autre utilisateur que celui qui a réceptionné le convoi');
      const upd = (await c.query(
        `UPDATE convoy_receptions SET status = 'pending_cashier', variance_approved_by = $2, variance_approved_at = now(), variance_comment = $3 WHERE id = $1 RETURNING *`,
        [id, req.user.id, b.comment])).rows[0];
      const v = (await c.query(`SELECT convoy_no FROM convoys WHERE id = $1`, [cur.convoy_id])).rows[0];
      await c.query(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE kind = 'convoy_variance' AND entity_type = 'convoy' AND entity_id = $1`, [cur.convoy_id]);
      await this.notif.notifyPermission(c, req.org.id, 'convoys:settle', { kind: 'convoy_received', severity: 'warning', title: `Réception à traiter en caisse : ${v.convoy_no}`,
        body: `${cur.total_kg} kg · ${cur.bags} sacs · écart validé`, entityType: 'convoy', entityId: cur.convoy_id, dedupe: `convoy_received:${cur.convoy_id}` });
      return upd;
    });
    await this.log(req, 'convoy.variance_approved', r.convoy_id, { variance_kg: r.variance_kg, variance_pct: r.variance_pct });
    return r;
  }

  /** File d'attente de la caisse : réceptions en attente de traitement. */
  @Get('convoys/cashier-queue')
  @RequirePermissions('convoys:settle')
  queue(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const rows = (await c.query(
        `SELECT r.id, r.convoy_id, v.convoy_no, v.driver_name, v.truck_no, v.collector_id, u.full_name AS collector_name,
                r.total_kg, r.bags, r.variance_kg, r.received_at, r.product_id, r.campaign_id, (SELECT name FROM products WHERE id = r.product_id) AS product
           FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id JOIN collectors k ON k.id = v.collector_id JOIN users u ON u.id = k.user_id
          WHERE r.status = 'pending_cashier' ORDER BY r.received_at`)).rows;
      // Prix au kilo fixé par l'administrateur (traite en cours) : repris tel quel par la caisse.
      const st = (await c.query(`SELECT coalesce((SELECT convoy_transport_unit FROM org_settings), 0) AS t, coalesce((SELECT convoy_retention_per_kg FROM org_settings), 0) AS r`)).rows[0];
      for (const r of rows) {
        r.official_price = await effectiveBuyPrice(c, r.product_id, r.campaign_id);
        const k = await delegateRates(c, r.collector_id, r.product_id);
        r.transport_unit = k.t; r.retention_per_kg = k.r; r.retention_type = k.rtype;
      }
      return rows;
    });
  }

  /** La caisse traite la réception : calcule le montant (poids × prix) et crédite le compte du délégué (écriture immuable). */
  @Post('convoy-receptions/:id/settle')
  @RequirePermissions('convoys:settle')
  async settle(@Param('id', ParseUUIDPipe) id: string, @Body() b: SettleDto, @Req() req: any) {
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT * FROM convoy_receptions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.status === 'settled') return { row: r, replay: true };
      // Le prix au kilo est celui de la traite, fixé par l'administrateur : le caissier ne le saisit pas.
      const official = await effectiveBuyPrice(c, r.product_id, r.campaign_id);
      const mayPrice = req.org.permissions.has('prices:manage') || req.org.permissions.has('products:manage');
      if (b.unit_price !== undefined && Number(b.unit_price) !== Number(official ?? NaN) && !mayPrice)
        throw new ForbiddenException("Le prix au kilo est fixé par l'administrateur de la coopérative : il ne peut pas être saisi en caisse");
      const unitPrice = mayPrice && b.unit_price !== undefined ? b.unit_price : official;
      if (unitPrice == null) throw new ConflictException("Prix au kilo non fixé pour ce produit dans cette traite : l'administrateur doit le renseigner dans Paramètres → Produits et prix → Traites (bouton « Prix »)");
      if (Number(unitPrice) <= 0) throw new BadRequestException('Prix unitaire doit être supérieur à zéro');
      if (r.status === 'pending_variance') throw new ConflictException('Écart de poids non validé : la réception doit d\'abord être validée par un responsable');
      const v = (await c.query(`SELECT * FROM convoys WHERE id = $1`, [r.convoy_id])).rows[0];
      const u = (await c.query(`SELECT u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [v.collector_id])).rows[0];
      let acc = (await c.query(`SELECT id, currency, accounting_code FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [v.collector_id])).rows[0];
      if (!acc) acc = (await c.query(
        `INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, created_by) VALUES ($1,'collector',$2,$3,$4) RETURNING id, currency, accounting_code`,
        [req.org.id, v.collector_id, `Compte délégué — ${u.full_name}`, req.user.id])).rows[0];
      const st = (await c.query(`SELECT convoy_transport_unit AS t, convoy_retention_per_kg AS r FROM org_settings`)).rows[0] ?? { t: '0', r: '0' };
      // Transport et retenue au kilo : préenregistrés dans le profil du délégué par l'administrateur (sinon tarif de la coopérative) ; la caisse ne les saisit pas.
      const rates = await delegateRates(c, v.collector_id, r.product_id); // tarif de la filière du produit, sinon général du délégué, sinon coopérative
      const offT = rates.t, offR = rates.r;
      const mayRates = req.org.permissions.has('collectors:rates');
      if (!mayRates && ((b.transport_unit !== undefined && Number(b.transport_unit) !== Number(offT)) || (b.retention_per_kg !== undefined && Number(b.retention_per_kg) !== Number(offR))))
        throw new ForbiddenException("Le coût de transport et la retenue au kilo sont fixés par l'administrateur dans le profil du délégué : ils ne se saisissent pas en caisse");
      const tu = mayRates ? (b.transport_unit ?? offT) : offT, rt = mayRates ? (b.retention_per_kg ?? offR) : offR;
      const m = (await c.query(
        `SELECT round($1::numeric * $2::numeric, 4) AS gross, round($1::numeric * $3::numeric, 4) AS transport, round($1::numeric * $4::numeric, 4) AS retention`,
        [r.total_kg, unitPrice, tu, rt])).rows[0];
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
        [req.org.id, 'convoy-' + b.idempotency_key + (r.settle_attempts ? ':' + r.settle_attempts : ''), acc.id, amt, acc.currency, `Convoi ${v.convoy_no} : ${r.total_kg} kg × ${unitPrice}`, r.id, req.user.id])).rows[0];
      await c.query(`INSERT INTO accounting_accounts(organization_id, code, label) VALUES ($1,'4781','Retenues sur règlements des délégués') ON CONFLICT DO NOTHING`, [req.org.id]);
      const lines: any[] = [{ code: '601', debit: m.gross }];
      if (Number(m.transport) > 0) lines.push({ code: '605', debit: m.transport, label: 'Transport' });
      lines.push({ code: acc.accounting_code ?? '401', credit: amt });
      if (Number(m.retention) > 0) lines.push({ code: '4781', credit: m.retention, label: 'Retenue' });
      await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'ACH', date: today(), label: `Achat convoi ${v.convoy_no} — ${u.full_name}`,
        lines, idempotencyKey: 'convoy-entry:' + r.id + (r.settle_attempts ? ':' + r.settle_attempts : ''), referenceType: 'convoy_reception', referenceId: r.id,
      });
      let nettingNo: string | null = null;
      if (netted > 0) nettingNo = (await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: 'OD', date: today(), label: `Netting avances / dettes — convoi ${v.convoy_no} — ${u.full_name}`,
        lines: [{ code: acc.accounting_code ?? '401', debit: String(netted), label: 'Dette compensée' }, { code: '409', credit: String(netted), label: 'Avance imputée' }],
        idempotencyKey: 'convoy-netting:' + r.id + (r.settle_attempts ? ':' + r.settle_attempts : ''), referenceType: 'convoy_reception', referenceId: r.id,
      })).number;
      const upd = (await c.query(
        `UPDATE convoy_receptions SET status = 'settled', unit_price = $2, amount = $3, tx_id = $4, settled_by = $5, settled_at = now(),
                gross_amount = $6, transport_unit = $7, transport_total = $8, retention_per_kg = $9, retention_amount = $10,
                advance_netted = $11, netting_entry_number = $12, retention_type = $13 WHERE id = $1 RETURNING *`,
        [id, unitPrice, amt, tx.id, req.user.id, m.gross, tu, m.transport, rt, m.retention, netted, nettingNo, rates.rtype])).rows[0];
      await c.query(`UPDATE convoys SET status = 'settled' WHERE id = $1`, [v.id]);
      await c.query(`UPDATE collectors SET account_closed_at = NULL WHERE id = $1`, [v.collector_id]); // une nouvelle livraison rouvre l'accumulation de la mise en compte
      // Le traitement en caisse est fait : l'alerte « réception à traiter » n'a plus lieu d'être pour personne.
      await c.query(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE kind = 'convoy_received' AND entity_type = 'convoy' AND entity_id = $1`, [v.id]);
      await this.notif.notifyUsers(c, req.org.id, [(await c.query(`SELECT user_id FROM collectors WHERE id = $1`, [v.collector_id])).rows[0]?.user_id], { kind: 'convoy_settled',
        title: `Net à payer porté à votre compte : ${amt}`, body: `Convoi ${v.convoy_no} · ${r.total_kg} kg` + (netted > 0 ? ` · dont ${netted} imputés sur vos avances` : ''), entityType: 'convoy', entityId: v.id, dedupe: `convoy_settled:${v.id}` });
      return { row: upd, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.settle', row.convoy_id, { amount: row.amount, tx_id: row.tx_id });
    return { ...row, cash_due: Number(row.amount) - Number(row.advance_netted), replayed: replay };
  }


  /** Délégués actifs avec leur solde de fiche (financements − net à payer) : sélection pour la caisse. */
  @Get('convoys/collectors')
  @RequirePermissions('convoys:settle')
  collectors(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT k.id, u.full_name AS name, u.phone, k.origin, (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS member_code,
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
      `SELECT coalesce((SELECT convoy_transport_unit FROM org_settings), 0) AS transport_unit, coalesce((SELECT convoy_retention_per_kg FROM org_settings), 0) AS retention_per_kg, coalesce((SELECT convoy_weight_tolerance_pct FROM org_settings), 2) AS weight_tolerance_pct`)).rows[0]);
  }

  @Post('convoys/settings')
  @RequirePermissions('convoys:settle')
  async putSettings(@Body() b: SettingsDto, @Req() req: any) {
    // Tarifs par défaut (transport, retenue) : administrateur seul ; la tolérance de poids reste réglable par la caisse.
    if (!req.org.permissions.has('collectors:rates')) {
      const cur = (await this.db.tx(req.org.id, (c) => c.query(`SELECT coalesce((SELECT convoy_transport_unit FROM org_settings), 0) AS t, coalesce((SELECT convoy_retention_per_kg FROM org_settings), 0) AS r`))).rows[0];
      if (Number(b.transport_unit) !== Number(cur.t) || Number(b.retention_per_kg) !== Number(cur.r)) throw new ForbiddenException("Le coût de transport et la retenue au kilo sont fixés par l'administrateur de la coopérative");
    }
    await this.db.tx(req.org.id, (c) => c.query(
      `INSERT INTO org_settings(organization_id, convoy_transport_unit, convoy_retention_per_kg, convoy_weight_tolerance_pct, updated_by) VALUES ($1,$2,$3,coalesce($5::numeric, 2),$4)
       ON CONFLICT (organization_id) DO UPDATE SET convoy_transport_unit = EXCLUDED.convoy_transport_unit, convoy_retention_per_kg = EXCLUDED.convoy_retention_per_kg,
         convoy_weight_tolerance_pct = coalesce($5::numeric, org_settings.convoy_weight_tolerance_pct), updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [req.org.id, b.transport_unit, b.retention_per_kg, req.user.id, b.weight_tolerance_pct ?? null]));
    await this.log(req, 'convoy.settings', req.org.id, b);
    return b;
  }

  /** Financement remis au délégué (« Finance cacao ») ou report du solde de campagne : augmente ce que le délégué doit à la coopérative. */
  /** Motifs proposés pour un financement (codes compris par le logiciel). */
  @Get('convoys/advance-motives')
  @RequirePermissions('convoys:read')
  advanceMotives() { return Object.entries(ADVANCE_MOTIVES).map(([code, label]) => ({ code, label })); }

  @Post('convoys/advances')
  @RequirePermissions('convoys:settle')
  async advance(@Body() b: AdvanceDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    if (b.operation_date && b.operation_date > today()) throw new BadRequestException("Date d'opération dans le futur");
    if (b.kind === 'advance' && !req.org.permissions.has('cash:operate')) throw new ForbiddenException('Un financement exige le droit « cash:operate »');
    const mode = b.payment_mode ?? 'cash';
    if (b.kind === 'advance' && mode === 'cheque' && !b.cheque_no?.trim()) throw new BadRequestException('Le n° de chèque est obligatoire pour un paiement par chèque');
    if (b.kind === 'advance' && b.motive === 'autre' && !b.label?.trim()) throw new BadRequestException('Précisez le motif');
    const cheque = b.cheque_no?.trim() || b.piece_no?.trim() || null;
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT * FROM collector_advances WHERE idempotency_key = $1`, [b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const k = (await c.query(`SELECT k.id, u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1 AND k.status = 'active'`, [b.collector_id])).rows[0];
      if (!k) throw new BadRequestException('Délégué inconnu ou désactivé');
      let acc = (await c.query(`SELECT id, currency, accounting_code FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [k.id])).rows[0];
      if (!acc) acc = (await c.query(
        `INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, created_by) VALUES ($1,'collector',$2,$3,$4) RETURNING id, currency, accounting_code`,
        [req.org.id, k.id, `Compte délégué — ${k.full_name}`, req.user.id])).rows[0];
      const motiveText = b.motive ? ADVANCE_MOTIVES[b.motive] : null;
      const label = b.kind === 'carry_forward' ? (b.label ?? 'Solde de la campagne précédente')
        : [motiveText, b.label?.trim() && b.motive !== 'autre' ? b.label.trim() : b.motive === 'autre' ? b.label!.trim() : null].filter(Boolean).join(' — ') || 'Finance cacao';
      const when = b.operation_date ? `${b.operation_date}T12:00:00Z` : new Date().toISOString();
      const t1 = (await c.query(
        `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, direction, amount, currency, reason, reference_type, reference_id, created_by, created_at)
         VALUES ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [req.org.id, 'adv-c:' + b.idempotency_key, acc.id, b.amount, acc.currency, label + (cheque ? ` — ${mode === 'cheque' ? 'chèque' : 'pièce'} ${cheque}` : '') + (b.slip_no ? ` — bordereau ${b.slip_no}` : ''),
         b.kind === 'advance' ? 'collector_advance' : 'collector_carry', k.id, req.user.id, when])).rows[0];
      if (b.kind === 'advance') {
        await c.query(`SELECT accounting_seed($1::uuid)`, [req.org.id]);
        let source: any; let sessionId: string | null = null; let journal = 'CAI';
        if (mode === 'cheque') {
          // Chèque : la somme sort du compte bancaire de la coopérative (celui indiqué, sinon le premier compte bancaire actif).
          source = (await c.query(
            `SELECT * FROM financial_accounts WHERE owner_type = 'other' AND status = 'active' AND ($1::uuid IS NULL OR id = $1) ORDER BY created_at LIMIT 1 FOR UPDATE`, [b.bank_account_id ?? null])).rows[0];
          if (!source) throw new UnprocessableEntityException("Aucun compte bancaire de la coopérative : créez-en un dans Trésorerie avant de payer par chèque");
          journal = 'BQ';
        } else {
          // Espèces : la caisse du caissier connecté (celle de l'utilisateur, sinon la seule caisse ouverte).
          const sess = (await c.query(
            `SELECT s.id, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
              WHERE s.status = 'open' AND ($2::uuid IS NULL OR s.id = $2) ORDER BY (s.opened_by = $1) DESC, s.opened_at DESC LIMIT 1`, [req.user.id, b.cash_session_id ?? null])).rows[0];
          if (!sess) throw new BadRequestException('Aucune caisse ouverte : le caissier doit être connecté à la caisse');
          sessionId = sess.id;
          source = (await c.query(`SELECT * FROM financial_accounts WHERE id = $1 FOR UPDATE`, [sess.account_id])).rows[0];
          const ok = (await c.query(
            `SELECT $2::numeric <= coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS ok, coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
               FROM financial_transactions WHERE account_id = $1`, [source.id, b.amount])).rows[0];
          if (!ok.ok) throw new UnprocessableEntityException(`Solde de caisse insuffisant (${ok.balance})`);
        }
        await c.query(
          `INSERT INTO financial_transactions(organization_id, idempotency_key, account_id, cash_session_id, direction, amount, currency, reason, reference_type, reference_id, created_by, created_at)
           VALUES ($1,$2,$3,$4,'out',$5,$6,$7,'collector_advance',$8,$9,$10)`,
          [req.org.id, 'adv-k:' + b.idempotency_key, source.id, sessionId, b.amount, source.currency, label + (mode === 'cheque' ? ` — chèque ${cheque}` : ''), k.id, req.user.id, when]);
        await postEntry(c, {
          orgId: req.org.id, userId: req.user.id, journal, date: b.operation_date ?? today(), label: `${label} — ${k.full_name}${mode === 'cheque' ? ` (chèque ${cheque})` : ''}${b.slip_no ? ` (bordereau ${b.slip_no})` : ''}`,
          lines: [{ code: '409', debit: b.amount }, { code: accountingCodeOf(source), credit: b.amount }],
          idempotencyKey: 'adv-entry:' + b.idempotency_key, referenceType: 'collector_advance', referenceId: t1.id,
        });
      }
      const ins = (await c.query(
        `INSERT INTO collector_advances(organization_id, idempotency_key, collector_id, kind, piece_no, label, amount, tx_id, created_by, created_at, payment_mode, cheque_no, slip_no, motive)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [req.org.id, b.idempotency_key, k.id, b.kind, cheque, label, b.amount, t1.id, req.user.id, when, b.kind === 'advance' ? mode : 'cash', mode === 'cheque' ? cheque : (b.cheque_no?.trim() || null), b.slip_no?.trim() || null, b.kind === 'advance' ? (b.motive ?? null) : null])).rows[0];
      if (b.kind === 'advance')
        await this.notif.notifyUsers(c, req.org.id, [(await c.query(`SELECT user_id FROM collectors WHERE id = $1`, [k.id])).rows[0]?.user_id], { kind: 'collector_advance',
          title: `Financement de ${b.amount} enregistré sur votre fiche`, body: cheque ? `${mode === 'cheque' ? 'Chèque' : 'Pièce'} ${cheque}` : undefined, entityType: 'collector', entityId: k.id, dedupe: `collector_advance:${ins.id}` });
      return { row: ins, replay: false };
    });
    if (!replay) await this.log(req, 'convoy.advance', row.id, { kind: b.kind, amount: b.amount, collector_id: b.collector_id });
    return { ...row, replayed: replay };
  }

  /**
   * Fiche de suivi du compte délégué. Convention de la fiche papier : le solde est ce que le délégué doit à la coopérative
   * (financements − net à payer des livraisons) ; un solde négatif est une somme due au délégué.
   */
  @Get('convoys/statement')
  @RequirePermissions('convoys:read')
  async statement(@Req() req: any, @Query('collector_id') collectorId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.db.tx(req.org.id, async (c) => {
      const staff = req.org.permissions.has('convoys:settle');
      const mine = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0];
      const cid = staff ? (collectorId ?? mine?.id) : mine?.id;
      if (!cid) throw new BadRequestException('Délégué requis');
      if (!staff && collectorId && collectorId !== mine?.id) throw new ForbiddenException('Vous ne pouvez consulter que votre propre fiche');
      const who = (await c.query(`SELECT k.id, u.full_name FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [cid])).rows[0];
      if (!who) throw new NotFoundException('Délégué inconnu');
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

  /** Paiement en espèces au délégué : débite son compte et sort la somme de la caisse (session ouverte), avec l'écriture comptable. */
  @Post('convoys/payout')
  @RequirePermissions('convoys:settle', 'cash:operate')
  async payout(@Body() b: PayoutDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    const { row, replay } = await this.db.tx(req.org.id, async (c) => {
      const prev = await c.query(`SELECT id, amount FROM financial_transactions WHERE idempotency_key = $1`, ['payout-c:' + b.idempotency_key]);
      if (prev.rowCount) return { row: prev.rows[0], replay: true };
      const acc = (await c.query(`SELECT * FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active' FOR UPDATE`, [b.collector_id])).rows[0];
      if (!acc) throw new NotFoundException('Ce délégué n\'a pas encore de compte crédité');
      const sess = (await c.query(
        `SELECT s.id, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 AND s.status = 'open'`, [b.cash_session_id])).rows[0];
      if (!sess) throw new BadRequestException('Caisse inconnue ou caissier déconnecté');
      const cash = (await c.query(`SELECT * FROM financial_accounts WHERE id = $1 FOR UPDATE`, [sess.account_id])).rows[0];
      const bal = (account: string) => c.query(
        `SELECT $2::numeric <= coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS ok, coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS balance
           FROM financial_transactions WHERE account_id = $1`, [account, b.amount]).then((r) => r.rows[0]);
      const bc = await bal(acc.id);
      if (!bc.ok) throw new UnprocessableEntityException(`Solde du compte du délégué insuffisant (${bc.balance})`);
      const bk = await bal(cash.id);
      if (!bk.ok) throw new UnprocessableEntityException(`Solde de caisse insuffisant (${bk.balance})`);
      const reason = 'Paiement en espèces au délégué';
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
