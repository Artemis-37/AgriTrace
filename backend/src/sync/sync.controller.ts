import { BadRequestException, Body, Controller, Get, HttpException, Post, Query, Req } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { plainToInstance, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsObject, IsString, Length, validate, ValidateNested } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { DbService } from '../db/db.service';
import { CreateDeclarationDto, DeclarationsController } from '../declarations/declarations.controller';
import { CreateParcelDto, ParcelsController, SyncUpdateParcelDto, UpdateParcelDto } from '../parcels/parcels.controller';
import { FinanceController, TransactionDto } from '../finance/finance.controller';
import { TaskEntryDto, TasksController } from '../tasks/tasks.controller';
import { MessagesController, SendMessageDto } from '../messages/messages.controller';
import { ConvoysController, CreateConvoyDto, ReceiveConvoyDto } from '../convoys/convoys.controller';
import { CreateWeighingDto, ReceptionController } from '../reception/reception.controller';

class SyncOperationDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  @IsString() type: string;
  @IsObject() payload: Record<string, any>;
}
class SyncBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}

type OpResult = { idempotency_key: string; status: string; result?: any; error?: string; retry?: boolean };

/** Statuts définitifs : un renvoi de la même clé retourne le résultat enregistré. */
const TERMINAL = new Set(['accepted', 'rejected', 'to_correct', 'conflict']);

interface Handler {
  permission: string;
  dto?: new () => object;
  run: (ctl: any, payload: any, req: any) => Promise<any>;
}

@ApiTags('synchronisation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('sync')
export class SyncController {
  private readonly handlers: Record<string, Handler & { controller: any }>;

  constructor(private readonly db: DbService, private readonly moduleRef: ModuleRef) {
    this.handlers = {
      'purchase_declaration.create': { controller: DeclarationsController, permission: 'declarations:create', dto: CreateDeclarationDto,
        run: (ctl, p, req) => ctl.create(p, req) },
      'purchase_declaration.submit': { controller: DeclarationsController, permission: 'declarations:create',
        run: (ctl, p, req) => {
          if (typeof p?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.id)) throw new BadRequestException('payload.id (uuid) requis');
          return ctl.submit(p.id, req);
        } },
      'parcel.create': { controller: ParcelsController, permission: 'parcels:create', dto: CreateParcelDto, run: (ctl, p, req) => ctl.create(p, req) },
      'parcel.update': { controller: ParcelsController, permission: 'parcels:update', dto: SyncUpdateParcelDto, run: (ctl, p, req) => {
        const { id, ...rest } = p ?? {};
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('payload.id (uuid) requis');
        return ctl.update(id, plainToInstance(UpdateParcelDto, rest), req);
      } },
      'message.send': { controller: MessagesController, permission: 'messages:use', dto: SendMessageDto, run: (ctl, p, req) => ctl.send(p, req) },
      'weighing.create': { controller: ReceptionController, permission: 'weighings:create', dto: CreateWeighingDto,
        run: (ctl, p, req) => ctl.createWeighing(p, req) },
      'convoy.create': { controller: ConvoysController, permission: 'convoys:create', dto: CreateConvoyDto, run: (ctl, p, req) => ctl.create(p, req) },
      'convoy.receive': { controller: ConvoysController, permission: 'convoys:receive', dto: ReceiveConvoyDto, run: (ctl, p, req) => ctl.receive(p, req) },
      'task.start': { controller: TasksController, permission: 'tasks:execute', run: (ctl, p, req) => ctl.start(this.uuid(p), req) },
      'task.submit': { controller: TasksController, permission: 'tasks:execute', run: (ctl, p, req) => ctl.submit(this.uuid(p), req) },
      'task.entry': { controller: TasksController, permission: 'tasks:execute', run: (ctl, p, req) => {
        const { task_id, ...rest } = p ?? {};
        if (typeof task_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(task_id)) throw new BadRequestException('payload.task_id (uuid) requis');
        return ctl.createEntry(task_id, plainToInstance(TaskEntryDto, rest), req);
      } },
      'financial_transaction.create': { controller: FinanceController, permission: 'cash:operate', dto: TransactionDto,
        run: (ctl, p, req) => ctl.createTx(p, req) },
    };
  }

  private uuid(p: any): string {
    if (typeof p?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.id)) throw new BadRequestException('payload.id (uuid) requis');
    return p.id;
  }

  /**
   * Réception d'un lot d'opérations enregistrées hors connexion. Chaque opération est traitée indépendamment,
   * idempotente (clé fournie par l'appareil) et revérifiée côté serveur : le client ne déclare jamais un état validé.
   */
  @Post('batch')
  @RequirePermissions('sync:use')
  async batch(@Body() b: SyncBatchDto, @Req() req: any) {
    const results: OpResult[] = [];
    for (const op of b.operations) results.push(await this.processOne(op, req));
    return { results };
  }

  private async processOne(op: SyncOperationDto, req: any): Promise<OpResult> {
    const key = op.idempotency_key;
    const h = this.handlers[op.type];
    if (!h) return { idempotency_key: key, status: 'rejected', error: `Type d'opération inconnu : ${op.type}` };

    // 1. Enregistrer l'opération (ou retrouver celle déjà reçue)
    const prior = await this.db.tx(req.org.id, async (c) => {
      const ins = await c.query(
        `INSERT INTO sync_operations(organization_id, user_id, idempotency_key, op_type, payload, status)
         VALUES ($1,$2,$3,$4,$5,'received') ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
        [req.org.id, req.user.id, key, op.type, JSON.stringify(op.payload)]);
      if (ins.rowCount) return null;
      const ex = (await c.query(
        `SELECT status, result, error, user_id, op_type, payload = $2::jsonb AS same FROM sync_operations WHERE idempotency_key = $1`,
        [key, JSON.stringify(op.payload)])).rows[0];
      return ex;
    });
    if (prior) {
      if (prior.user_id !== req.user.id || prior.op_type !== op.type || !prior.same)
        return { idempotency_key: key, status: 'conflict', error: "Cette clé d'idempotence a déjà été utilisée pour une autre opération" };
      if (TERMINAL.has(prior.status)) return { idempotency_key: key, status: prior.status, result: prior.result ?? undefined, error: prior.error ?? undefined };
      // 'received' (interruption) ou 'pending_validation' : on retente
    }

    // 2. Permissions et validation du contenu
    let status: string, result: any, error: string | undefined;
    if (!req.org.permissions.has(h.permission)) {
      status = 'rejected'; error = `Permission manquante : ${h.permission}`;
    } else {
      let payload = op.payload;
      let invalid: string | undefined;
      if (h.dto) {
        const inst: any = plainToInstance(h.dto, op.payload);
        const errs = await validate(inst, { whitelist: true, forbidNonWhitelisted: true });
        if (errs.length) invalid = errs.map((e) => Object.values(e.constraints ?? {}).join(', ')).join(' ; ');
        else payload = inst;
      }
      if (invalid) { status = 'to_correct'; error = invalid; }
      else {
        // 3. Exécution par la logique métier normale (mêmes règles que l'API directe)
        try {
          const ctl = this.moduleRef.get(h.controller, { strict: false });
          result = await h.run(ctl, payload, req);
          status = 'accepted';
          // Numéro de reçu déjà utilisé : la déclaration est enregistrée mais reste en conflit jusqu'à résolution (CDC §27.5)
          if (result?.receipt_conflict_with && !result.receipt_override_by) {
            status = 'conflict';
            error = `Numéro de reçu ${result.purchase_receipt_no} déjà utilisé par une autre déclaration : à résoudre par un utilisateur autorisé`;
          }
        } catch (e: any) {
          if (e instanceof HttpException) {
            const code = e.getStatus();
            error = typeof e.getResponse() === 'string' ? (e.getResponse() as string) : (e.getResponse() as any).message?.toString();
            status = code === 400 ? 'to_correct' : code === 409 ? 'conflict' : code === 422 ? 'pending_validation' : 'rejected';
          } else {
            // Erreur serveur inattendue : l'appareil doit renvoyer plus tard (rien de définitif n'est enregistré)
            return { idempotency_key: key, status: 'received', retry: true, error: 'Erreur temporaire du serveur' };
          }
        }
      }
    }

    await this.db.tx(req.org.id, (c) => c.query(
      `UPDATE sync_operations SET status = $2, result = $3, error = $4, processed_at = now() WHERE idempotency_key = $1`,
      [key, status, result === undefined ? null : JSON.stringify(result), error ?? null]));
    return { idempotency_key: key, status, result, error };
  }

  /**
   * Téléchargement des changements depuis un curseur. Seules les données de l'organisation et de l'utilisateur sont
   * envoyées ; les permissions courantes sont toujours incluses pour que l'appareil retire ce qui n'est plus autorisé.
   * Les doublons de lignes sont possibles et inoffensifs (le client écrase par identifiant).
   */
  @Get('changes')
  @RequirePermissions('sync:use')
  async changes(@Req() req: any, @Query('cursor') cursor?: string, @Query('limit') limitQ?: string) {
    let since = new Date(0);
    if (cursor) {
      since = new Date(cursor);
      if (Number.isNaN(since.getTime())) throw new BadRequestException('cursor invalide (date ISO 8601 attendue)');
    }
    const limit = Math.min(Math.max(Number(limitQ) || 500, 1), 1000);
    const canSeeAll = req.org.permissions.has('declarations:validate');

    return this.db.tx(req.org.id, async (c) => {
      const started = (await c.query(`SELECT clock_timestamp() AS t`)).rows[0].t as Date;
      const mine = (await c.query(`SELECT id FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id])).rows[0]?.id ?? null;

      const specs: { key: string; sql: string; params?: any[] }[] = [
        { key: 'value_chains', sql: `SELECT id, code, name, default_unit, status, updated_at AS ts FROM value_chains` },
        { key: 'campaigns', sql: `SELECT id, value_chain_id, code, name, starts_on, ends_on, status, updated_at AS ts FROM campaigns` },
        { key: 'unit_conversions', sql: `SELECT id, value_chain_id, from_unit, to_unit, factor, updated_at AS ts FROM unit_conversions` },
        { key: 'price_versions', sql: `SELECT v.id, v.schedule_id, s.value_chain_id, s.campaign_id, s.unit, s.currency, v.version_no, v.unit_price, v.valid_from, v.valid_to, v.created_at AS ts
                                       FROM price_versions v JOIN price_schedules s ON s.id = v.schedule_id` },
        { key: 'producers', sql: `SELECT p.id, p.internal_code, p.last_name, p.first_names, p.phone, p.region, p.department, p.section, p.village, p.status,
                                          coalesce((SELECT array_agg(value_chain_id) FROM producer_value_chains x WHERE x.producer_id = p.id), '{}') AS value_chain_ids,
                                          p.updated_at AS ts FROM producers p` },
        { key: 'parcels', sql: `SELECT id, code, producer_id, value_chain_id, declared_area_ha, geometry_area_ha, geometry, verification_status, status, updated_at AS ts FROM parcels
                                  WHERE status = 'active' AND ($3::boolean OR created_by = $4)`, params: [req.org.permissions.has('parcels:update'), req.user.id] },
        { key: 'warehouses', sql: `SELECT id, code, name, status, updated_at AS ts FROM warehouses` },
        { key: 'my_assignments', sql: `SELECT id, collector_id, value_chain_id, zone, created_at AS ts FROM collector_assignments WHERE collector_id = $3`, params: [mine] },
        { key: 'declarations', sql: `SELECT id, collector_id, producer_id, value_chain_id, campaign_id, operation_date, bags, quantity, unit, unit_price, currency, amount,
                                             purchase_receipt_series, purchase_receipt_no, receipt_conflict_with, receipt_override_by, status, status_reason, updated_at AS ts FROM purchase_declarations WHERE ($3::boolean OR collector_id = $4)`, params: [canSeeAll, mine] },
        { key: 'tasks', sql: `SELECT id, code, title, description, category, priority, due_date, section, producer_id, parcel_id, campaign_id, assignee_id, team_ids, expected_result,
                                       validation_criteria, instructions, status, review_note, updated_at AS ts FROM tasks
                                      WHERE status <> 'draft' AND ($3::boolean OR assignee_id = $4 OR $4 = ANY(team_ids))`, params: [req.org.permissions.has('tasks:read_all'), req.user.id] },
        { key: 'notifications', sql: `SELECT id, kind, severity, title, body, entity_type, entity_id, read_at, created_at AS ts FROM notifications WHERE user_id = $3`, params: [req.user.id] },
        { key: 'operation_results', sql: `SELECT idempotency_key, op_type, status, result, error, processed_at AS ts FROM sync_operations
                                           WHERE user_id = $3 AND processed_at IS NOT NULL`, params: [req.user.id] },
      ];

      const changes: Record<string, any[]> = {};
      let hasMore = false;
      let cursorCap: Date | null = null; // si une entité atteint la limite, on ne dépasse pas son dernier horodatage
      for (const s of specs) {
        const params = [since, limit, ...(s.params ?? [])];
        // On enveloppe pour filtrer et ordonner sur l'alias ts
        const sql = `SELECT * FROM (${s.sql}) q WHERE q.ts > $1 ORDER BY q.ts LIMIT $2`;
        const rows = (await c.query(sql, params)).rows;
        changes[s.key] = rows;
        if (rows.length === limit) {
          hasMore = true;
          const last = new Date(rows[rows.length - 1].ts);
          if (!cursorCap || last < cursorCap) cursorCap = last;
        }
      }
      const margin = new Date(started.getTime() - 5000);
      const next = hasMore && cursorCap ? cursorCap : margin > since ? margin : since;
      return {
        server_time: started.toISOString(),
        next_cursor: next.toISOString(),
        has_more: hasMore,
        organization_id: req.org.id,
        my_collector_id: mine,
        permissions: [...req.org.permissions].sort(),
        changes,
      };
    });
  }
}
