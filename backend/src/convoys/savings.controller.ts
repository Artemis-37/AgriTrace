import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PoolClient } from 'pg';
import { RequirePermissions } from '../access/decorators';
import { accountingCodeOf, postEntry, today } from '../accounting/accounting.helpers';
import { AuditService } from '../audit/audit.service';
import { Dec } from '../common/dto';
import { DbService } from '../db/db.service';
import { postFinancialTx } from '../finance/finance.helpers';
import { NotificationsService } from '../notifications/notifications.service';

class CloseDto { @IsString() @Length(3, 300) reason: string; }
class ReleaseDto {
  @IsUUID() collector_id: string;
  @Dec(4) amount: string;
  /** account = sur le compte du délégué ; cheque ; cash = espèces ; transfer = vers un autre compte. */
  @IsIn(['account', 'cheque', 'cash', 'transfer']) mode: string;
  /** Autre compte (transfer) ou compte bancaire débité (cheque). */
  @IsOptional() @IsUUID() target_account_id?: string;
  @IsOptional() @IsUUID() cash_session_id?: string;
  @IsOptional() @IsString() @Length(1, 40) cheque_no?: string;
  @IsOptional() @IsString() @Length(1, 300) reason?: string;
}
class DecisionDto { @IsOptional() @IsString() @Length(0, 300) comment?: string; }

/**
 * Mise en compte (retenues sur règlements) des délégués. Une fois le compte du délégué clôturé, la somme retenue est reversée
 * (sur son compte, par chèque, en espèces ou vers un autre compte) après approbation de l'administrateur de la coopérative.
 * Écriture : débit 4781 « Retenues sur règlements des délégués » / crédit du compte de destination.
 */
@ApiTags('mise en compte des délégués')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('collector-savings')
export class SavingsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly notif: NotificationsService) {}

  private static readonly SUMMARY = `
    SELECT k.id AS collector_id, u.full_name AS name, k.account_closed_at,
           (SELECT mc.code FROM member_codes mc WHERE mc.user_id = k.user_id AND mc.organization_id = k.organization_id) AS code,
           coalesce((SELECT sum(r.retention_amount) FROM convoy_receptions r JOIN convoys v ON v.id = r.convoy_id WHERE v.collector_id = k.id AND r.status = 'settled'), 0) AS retained,
           coalesce((SELECT sum(q.amount) FROM collector_release_requests q WHERE q.collector_id = k.id AND q.status = 'approved'), 0) AS released,
           coalesce((SELECT sum(q.amount) FROM collector_release_requests q WHERE q.collector_id = k.id AND q.status = 'pending'), 0) AS pending
      FROM collectors k JOIN users u ON u.id = k.user_id WHERE k.status = 'active'`;

  @Get()
  @RequirePermissions('savings:read')
  list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT s.*, s.retained - s.released - s.pending AS available FROM (${SavingsController.SUMMARY}) s ORDER BY s.name`)).rows);
  }

  @Post('collectors/:id/close')
  @RequirePermissions('savings:request')
  async close(@Param('id', ParseUUIDPipe) id: string, @Body() b: CloseDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => {
      const k = (await c.query(`SELECT id, account_closed_at FROM collectors WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!k) throw new NotFoundException('Délégué introuvable');
      if (k.account_closed_at) throw new ConflictException('Le compte de ce délégué est déjà clôturé');
      await c.query(`UPDATE collectors SET account_closed_at = now(), account_closed_by = $2 WHERE id = $1`, [id, req.user.id]);
      return { id, closed: true };
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'savings.close_account', entityType: 'collector', entityId: id, details: { reason: b.reason } });
    return r;
  }

  @Get('requests')
  @RequirePermissions('savings:read')
  requests(@Req() req: any, @Query('status') status?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT q.*, u.full_name AS collector_name, rb.full_name AS requested_by_name, db.full_name AS decided_by_name, a.name AS target_account_name
         FROM collector_release_requests q JOIN collectors k ON k.id = q.collector_id JOIN users u ON u.id = k.user_id
         LEFT JOIN users rb ON rb.id = q.requested_by LEFT JOIN users db ON db.id = q.decided_by LEFT JOIN financial_accounts a ON a.id = q.target_account_id
        WHERE ($1::text IS NULL OR q.status = $1) ORDER BY q.requested_at DESC LIMIT 300`, [status ?? null])).rows);
  }

  @Post('requests')
  @RequirePermissions('savings:request')
  async request(@Body() b: ReleaseDto, @Req() req: any) {
    if (Number(b.amount) <= 0) throw new BadRequestException('Montant doit être supérieur à zéro');
    if (b.mode === 'transfer' && !b.target_account_id) throw new BadRequestException("Choisissez l'autre compte de destination");
    if (b.mode === 'cheque' && (!b.cheque_no || !b.target_account_id)) throw new BadRequestException('Chèque : numéro du chèque et compte bancaire débité requis');
    if (b.mode === 'cash' && !b.cash_session_id) throw new BadRequestException('Espèces : choisissez la caisse (caissier connecté)');
    const row = await this.db.tx(req.org.id, async (c) => {
      await c.query(`SELECT 1 FROM collectors WHERE id = $1 FOR UPDATE`, [b.collector_id]); // évite deux demandes simultanées sur la même somme
      const s = (await c.query(`SELECT s.*, s.retained - s.released - s.pending AS available FROM (${SavingsController.SUMMARY} AND k.id = $1) s`, [b.collector_id])).rows[0];
      if (!s) throw new NotFoundException('Délégué introuvable');
      if (!s.account_closed_at) throw new ConflictException("Le compte du délégué doit d'abord être clôturé");
      if (Number(b.amount) > Number(s.available) + 1e-9) throw new UnprocessableEntityException(`Montant supérieur à la mise en compte disponible (${s.available})`);
      if (b.target_account_id && !(await c.query(`SELECT 1 FROM financial_accounts WHERE id = $1 AND status = 'active'`, [b.target_account_id])).rowCount) throw new BadRequestException('Compte de destination inconnu ou clôturé');
      const q = (await c.query(
        `INSERT INTO collector_release_requests(organization_id, collector_id, amount, mode, target_account_id, cash_session_id, cheque_no, reason, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.org.id, b.collector_id, b.amount, b.mode, b.target_account_id ?? null, b.cash_session_id ?? null, b.cheque_no ?? null, b.reason ?? null, req.user.id])).rows[0];
      await this.notif.notifyPermission(c, req.org.id, 'savings:approve', { kind: 'savings_release_requested', severity: 'info', title: `Reversement de mise en compte à approuver : ${s.name}`, body: `${b.amount} FCFA — ${b.mode}`, entityType: 'collector_release', entityId: q.id }, req.user.id);
      return q;
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'savings.release_request', entityType: 'collector_release', entityId: row.id, details: { amount: b.amount, mode: b.mode } });
    return row;
  }

  @Post('requests/:id/reject')
  @RequirePermissions('savings:approve')
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecisionDto, @Req() req: any) {
    if (!b.comment || b.comment.trim().length < 3) throw new BadRequestException('Motif du refus requis (3 caractères minimum)');
    const q = await this.db.tx(req.org.id, async (c) => {
      const r = await this.lock(c, id);
      const u = (await c.query(`UPDATE collector_release_requests SET status = 'rejected', decided_by = $2, decided_at = now(), decision_comment = $3 WHERE id = $1 RETURNING *`, [id, req.user.id, b.comment])).rows[0];
      await this.notif.notifyUsers(c, req.org.id, [r.requested_by], { kind: 'savings_release_decided', severity: 'warning', title: 'Reversement de mise en compte refusé', body: b.comment!, entityType: 'collector_release', entityId: id });
      return u;
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'savings.release_reject', entityType: 'collector_release', entityId: id, details: { comment: b.comment } });
    return q;
  }

  /** Approbation par l'administrateur : exécute le reversement (mouvement financier et écriture comptable). Le demandeur ne peut pas approuver sa propre demande. */
  @Post('requests/:id/approve')
  @RequirePermissions('savings:approve')
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecisionDto, @Req() req: any) {
    const out = await this.db.tx(req.org.id, async (c) => {
      const q = await this.lock(c, id);
      if (q.requested_by === req.user.id) throw new ForbiddenException('Vous ne pouvez pas approuver votre propre demande');
      const s = (await c.query(`SELECT s.name, s.account_closed_at FROM (${SavingsController.SUMMARY} AND k.id = $1) s`, [q.collector_id])).rows[0];
      if (!s?.account_closed_at) throw new ConflictException('Le compte du délégué n\'est plus clôturé');
      const label = `Reversement de la mise en compte — ${s.name}`;
      let destCode: string; let tx: any; let destAccount: any;
      const key = `savings:${id}`;
      if (q.mode === 'account') {
        let acc = (await c.query(`SELECT id FROM financial_accounts WHERE owner_type = 'collector' AND owner_id = $1 AND status = 'active'`, [q.collector_id])).rows[0];
        if (!acc) acc = (await c.query(`INSERT INTO financial_accounts(organization_id, owner_type, owner_id, name, created_by) VALUES ($1,'collector',$2,$3,$4) RETURNING id`, [req.org.id, q.collector_id, `Compte délégué — ${s.name}`, req.user.id])).rows[0];
        const r = await postFinancialTx(c, { orgId: req.org.id, userId: req.user.id, accountId: acc.id, direction: 'in', amount: q.amount, reason: label, idempotencyKey: key, referenceType: 'collector_release', referenceId: id });
        tx = r.tx; destAccount = r.account;
      } else if (q.mode === 'transfer') {
        const r = await postFinancialTx(c, { orgId: req.org.id, userId: req.user.id, accountId: q.target_account_id, direction: 'in', amount: q.amount, reason: `${label} (virement)`, idempotencyKey: key, referenceType: 'collector_release', referenceId: id });
        tx = r.tx; destAccount = r.account;
      } else if (q.mode === 'cheque') {
        const r = await postFinancialTx(c, { orgId: req.org.id, userId: req.user.id, accountId: q.target_account_id, direction: 'out', amount: q.amount, reason: `${label} (chèque n° ${q.cheque_no})`, idempotencyKey: key, referenceType: 'collector_release', referenceId: id });
        tx = r.tx; destAccount = r.account;
      } else {
        const sess = (await c.query(`SELECT s.id, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = $1 AND s.status = 'open'`, [q.cash_session_id])).rows[0];
        if (!sess) throw new ConflictException('Le caissier s\'est déconnecté de la caisse choisie : le demandeur doit refaire la demande sur une caisse où un caissier est connecté');
        const r = await postFinancialTx(c, { orgId: req.org.id, userId: req.user.id, accountId: sess.account_id, direction: 'out', amount: q.amount, reason: `${label} (espèces)`, idempotencyKey: key, referenceType: 'collector_release', referenceId: id });
        tx = r.tx; destAccount = r.account;
      }
      destCode = accountingCodeOf(destAccount);
      await c.query(`INSERT INTO accounting_accounts(organization_id, code, label) VALUES ($1,'4781','Retenues sur règlements des délégués') ON CONFLICT DO NOTHING`, [req.org.id]);
      const entry = await postEntry(c, {
        orgId: req.org.id, userId: req.user.id, journal: q.mode === 'cash' ? 'CAI' : 'OD', date: today(), label,
        lines: [{ code: '4781', debit: q.amount, label: 'Retenue reversée' }, { code: destCode, credit: q.amount }],
        idempotencyKey: `savings-entry:${id}`, referenceType: 'collector_release', referenceId: id,
      });
      const u = (await c.query(`UPDATE collector_release_requests SET status = 'approved', decided_by = $2, decided_at = now(), decision_comment = $3, tx_id = $4, entry_number = $5 WHERE id = $1 RETURNING *`, [id, req.user.id, b.comment ?? null, tx.id, entry.number])).rows[0];
      await this.notif.notifyUsers(c, req.org.id, [q.requested_by], { kind: 'savings_release_decided', severity: 'info', title: 'Reversement de mise en compte approuvé', body: `${s.name} — ${q.amount} FCFA (${q.mode})`, entityType: 'collector_release', entityId: id });
      return u;
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'savings.release_approve', entityType: 'collector_release', entityId: id, details: { amount: out.amount, mode: out.mode, tx_id: out.tx_id } });
    return out;
  }

  private async lock(c: PoolClient, id: string) {
    const q = (await c.query(`SELECT * FROM collector_release_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!q) throw new NotFoundException('Demande introuvable');
    if (q.status !== 'pending') throw new ConflictException('Cette demande a déjà été traitée');
    return q;
  }
}
