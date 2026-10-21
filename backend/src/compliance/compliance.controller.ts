import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, InternalServerErrorException, NotFoundException, Param,
  ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_SUBJECT_TABLE: Record<string, string> = {
  producer: 'producers', collector: 'collectors', declaration: 'purchase_declarations', lot: 'lots', receipt: 'receipts',
  payment: 'payments', inspection: 'inspections', certificate: 'certificates', loan: 'loans', parcel: 'parcels', task: 'tasks', weighing: 'weighings', shipment: 'shipments', order: 'sales_orders', invoice: 'invoices', claim: 'sales_claims', field_record: 'field_records',
};
const CERT_HOLDER_TABLE: Record<string, string> = { producer: 'producers', warehouse: 'warehouses', lot: 'lots' };
const docsDir = () => process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'storage', 'documents');

/** Type réel du fichier d'après sa signature (le type annoncé par le client n'est pas fiable). */
export function sniffMime(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}
export const safeFilename = (n: string) => path.basename(n || 'document').replace(/[^\w.\- ()àâäçéèêëîïôöùûüÿ]/gi, '_').slice(0, 150) || 'document';

class CertDto {
  @IsIn(['organization', 'producer', 'warehouse', 'lot']) holder_type: string;
  @IsOptional() @IsUUID() holder_id?: string;
  @IsString() @Length(2, 100) scheme: string;
  @IsString() @Length(1, 100) number: string;
  @IsString() @Length(2, 150) issuer: string;
  @Matches(DATE) issued_on: string;
  @Matches(DATE) expires_on: string;
  @IsOptional() @IsUUID() document_id?: string;
}
class RevokeDto { @IsString() @Length(3, 300) reason: string; }

@ApiTags('conformité, documents et alertes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller()
export class ComplianceController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private log(req: any, action: string, type: string, id: string, details?: any) {
    return this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action, entityType: type, entityId: id, details });
  }

  // ---- Documents ----
  @Post('documents')
  @RequirePermissions('documents:upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() b: any, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ "file", 10 Mo maximum)');
    const mime = sniffMime(file.buffer);
    if (!mime) throw new BadRequestException('Format non autorisé : PDF, JPEG ou PNG uniquement');
    if (!DOC_SUBJECT_TABLE[b.subject_type]) throw new BadRequestException('subject_type invalide');
    if (!/^[0-9a-f-]{36}$/.test(b.subject_id ?? '')) throw new BadRequestException('subject_id invalide');
    if (!b.kind || String(b.kind).length < 2 || String(b.kind).length > 60) throw new BadRequestException('kind requis (2 à 60 caractères)');
    if (b.retention_until && !DATE.test(b.retention_until)) throw new BadRequestException('retention_until : AAAA-MM-JJ');
    const clientKey: string | null = typeof b.client_key === 'string' && b.client_key.length >= 8 && b.client_key.length <= 100 ? b.client_key : null;
    const cols = 'id, subject_type, subject_id, kind, filename, mime, size_bytes, sha256, version, sensitive, retention_until, uploaded_at';
    if (clientKey) {
      // Renvoi du même envoi : on rend la pièce déjà enregistrée, sans second fichier.
      const prior = (await this.db.tx(req.org.id, (c) => c.query(`SELECT ${cols}, subject_id AS sid, subject_type AS st FROM documents WHERE client_key = $1`, [clientKey]))).rows[0];
      if (prior) { if (prior.sid !== b.subject_id || prior.st !== b.subject_type) throw new ConflictException('Cette clé a déjà servi pour une autre pièce'); return prior; }
    }
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = randomUUID();
    const dir = path.join(docsDir(), req.org.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, storageKey), file.buffer, { mode: 0o600 });
    try {
      const row = await this.db.tx(req.org.id, async (c) => {
        if (!(await c.query(`SELECT 1 FROM ${DOC_SUBJECT_TABLE[b.subject_type]} WHERE id = $1`, [b.subject_id])).rowCount)
          throw new BadRequestException('Objet rattaché inconnu dans cette coopérative');
        // Un collecteur ne joint des pièces qu'à ses propres déclarations d'achat.
        if (b.subject_type === 'declaration' && !req.org.permissions.has('declarations:validate')) {
          const mine = await c.query(`SELECT 1 FROM purchase_declarations d JOIN collectors k ON k.id = d.collector_id WHERE d.id = $1 AND k.user_id = $2`, [b.subject_id, req.user.id]);
          if (!mine.rowCount) throw new ForbiddenException('Vous ne pouvez joindre des pièces qu\'à vos propres déclarations');
        }
        // Parcelle : son relevé (created_by) ou le droit de la modifier. Mission : son responsable, son équipe ou la lecture de toutes les missions.
        if (b.subject_type === 'parcel' && !req.org.permissions.has('parcels:update')) {
          const mine = await c.query(`SELECT 1 FROM parcels WHERE id = $1 AND created_by = $2`, [b.subject_id, req.user.id]);
          if (!mine.rowCount) throw new ForbiddenException('Vous ne pouvez joindre des pièces qu\'aux parcelles que vous avez relevées');
        }
        if (b.subject_type === 'task' && !req.org.permissions.has('tasks:read_all')) {
          const mine = await c.query(`SELECT 1 FROM tasks WHERE id = $1 AND (assignee_id = $2 OR $2 = ANY(team_ids))`, [b.subject_id, req.user.id]);
          if (!mine.rowCount) throw new ForbiddenException('Seul le responsable de la mission (ou son équipe) peut y joindre des pièces');
        }
        let version = 1, sensitive = b.sensitive === 'true';
        if (b.replaces_id) {
          const p = (await c.query(`SELECT * FROM documents WHERE id = $1 FOR UPDATE`, [b.replaces_id])).rows[0];
          if (!p || p.subject_type !== b.subject_type || p.subject_id !== b.subject_id) throw new BadRequestException('Version précédente introuvable pour cet objet');
          version = p.version + 1; sensitive = sensitive || p.sensitive;
        }
        return (await c.query(
          `INSERT INTO documents(organization_id, subject_type, subject_id, kind, filename, mime, size_bytes, sha256, storage_key, version, replaces_id, sensitive, retention_until, uploaded_by, client_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id, subject_type, subject_id, kind, filename, mime, size_bytes, sha256, version, sensitive, retention_until, uploaded_at`,
          [req.org.id, b.subject_type, b.subject_id, b.kind, safeFilename(file.originalname), mime, file.size, sha, storageKey, version, b.replaces_id ?? null,
           sensitive, b.retention_until ?? null, req.user.id, clientKey])).rows[0];
      });
      await this.log(req, 'document.upload', 'document', row.id, { subject: b.subject_type, version: row.version });
      return row;
    } catch (e: any) {
      await fs.unlink(path.join(dir, storageKey)).catch(() => undefined); // pas de fichier orphelin
      if (e.code === '23505') throw new ConflictException('Cette version a déjà été remplacée par une plus récente');
      throw e;
    }
  }

  @Get('documents')
  @RequirePermissions('documents:read')
  list(@Req() req: any, @Query('subject_type') st?: string, @Query('subject_id') sid?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT d.id, d.subject_type, d.subject_id, d.kind, d.filename, d.mime, d.size_bytes, d.version, d.sensitive, d.retention_until, d.uploaded_at,
              NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_id = d.id) AS is_latest
         FROM documents d WHERE ($1::text IS NULL OR d.subject_type = $1) AND ($2::uuid IS NULL OR d.subject_id = $2::uuid)
        ORDER BY d.uploaded_at DESC LIMIT 500`, [st ?? null, sid ?? null])).rows);
  }

  /** Téléchargement contrôlé (pas d'URL publique) : permission, document sensible, vérification d'intégrité, journal des accès. */
  @Get('documents/:id/download')
  @RequirePermissions('documents:read')
  async download(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const d = await this.db.tx(req.org.id, async (c) => {
      const r = (await c.query(`SELECT * FROM documents WHERE id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException();
      if (r.sensitive && !req.org.permissions.has('documents:sensitive')) throw new ForbiddenException('Document sensible : permission documents:sensitive requise');
      await c.query(`INSERT INTO document_downloads(organization_id, document_id, user_id) VALUES ($1,$2,$3)`, [req.org.id, id, req.user.id]);
      return r;
    });
    let buf: Buffer;
    try { buf = await fs.readFile(path.join(docsDir(), req.org.id, d.storage_key)); } catch { throw new InternalServerErrorException('Fichier indisponible'); }
    if (createHash('sha256').update(buf).digest('hex') !== d.sha256) throw new InternalServerErrorException("Contrôle d'intégrité échoué : fichier altéré");
    if (d.sensitive) await this.log(req, 'document.download_sensitive', 'document', id);
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(d.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }

  @Get('documents/:id/downloads')
  @RequirePermissions('documents:sensitive')
  downloads(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => (await c.query(`SELECT user_id, at FROM document_downloads WHERE document_id = $1 ORDER BY at DESC LIMIT 500`, [id])).rows);
  }

  // ---- Certificats ----
  @Post('certificates')
  @RequirePermissions('certificates:manage')
  async createCert(@Body() b: CertDto, @Req() req: any) {
    if (b.expires_on <= b.issued_on) throw new BadRequestException("La date d'expiration doit suivre la date d'émission");
    if (b.holder_type !== 'organization' && !b.holder_id) throw new BadRequestException('holder_id requis');
    try {
      const row = await this.db.tx(req.org.id, async (c) => {
        if (b.holder_type !== 'organization' && !(await c.query(`SELECT 1 FROM ${CERT_HOLDER_TABLE[b.holder_type]} WHERE id = $1`, [b.holder_id])).rowCount)
          throw new BadRequestException('Titulaire inconnu dans cette coopérative');
        if (b.document_id && !(await c.query(`SELECT 1 FROM documents WHERE id = $1`, [b.document_id])).rowCount) throw new BadRequestException('Document inconnu');
        return (await c.query(
          `INSERT INTO certificates(organization_id, holder_type, holder_id, scheme, number, issuer, issued_on, expires_on, document_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [req.org.id, b.holder_type, b.holder_type === 'organization' ? null : b.holder_id, b.scheme, b.number, b.issuer, b.issued_on, b.expires_on, b.document_id ?? null, req.user.id])).rows[0];
      });
      await this.log(req, 'certificate.create', 'certificate', row.id, { scheme: b.scheme });
      return row;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('Ce certificat (schéma + numéro) est déjà enregistré');
      throw e;
    }
  }

  @Post('certificates/:id/revoke')
  @RequirePermissions('certificates:manage')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Body() b: RevokeDto, @Req() req: any) {
    await this.db.tx(req.org.id, async (c) => {
      const r = await c.query(`SELECT revoked_at FROM certificates WHERE id = $1 FOR UPDATE`, [id]);
      if (!r.rowCount) throw new NotFoundException();
      if (r.rows[0].revoked_at) throw new BadRequestException('Certificat déjà révoqué');
      await c.query(`UPDATE certificates SET revoked_at = now(), revoked_reason = $2 WHERE id = $1`, [id, b.reason]);
    });
    await this.log(req, 'certificate.revoke', 'certificate', id, { reason: b.reason });
    return { id, revoked: true };
  }

  @Get('certificates')
  @RequirePermissions('certificates:read')
  certs(@Req() req: any, @Query('holder_type') ht?: string, @Query('holder_id') hid?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT *, CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_on < current_date THEN 'expired'
                      WHEN expires_on <= current_date + 60 THEN 'expiring' ELSE 'valid' END AS validity
         FROM certificates WHERE ($1::text IS NULL OR holder_type = $1) AND ($2::uuid IS NULL OR holder_id = $2::uuid) ORDER BY expires_on LIMIT 500`,
      [ht ?? null, hid ?? null])).rows.map((r: any) => ({ ...r,
        notice: "Enregistrement de preuves : ne remplace pas la décision d'un organisme officiel de certification." })));
  }

  // ---- Alertes et échéances ----
  @Get('alerts')
  @RequirePermissions('alerts:read')
  async alerts(@Req() req: any, @Query('days') days?: string, @Query('renewal_months') renewal?: string) {
    const d = Math.min(Math.max(Number(days) || 60, 1), 365), m = Math.min(Math.max(Number(renewal) || 12, 1), 60);
    return this.db.tx(req.org.id, async (c) => {
      const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
      const certificates_expiring = await q(`SELECT id, scheme, number, holder_type, holder_id, expires_on FROM certificates WHERE revoked_at IS NULL AND expires_on BETWEEN current_date AND current_date + $1::int ORDER BY expires_on`, [d]);
      const certificates_expired = await q(`SELECT id, scheme, number, holder_type, holder_id, expires_on FROM certificates WHERE revoked_at IS NULL AND expires_on < current_date ORDER BY expires_on`);
      const inspections_overdue = await q(`SELECT id, subject_type, subject_id, kind, scheduled_for FROM inspections WHERE status = 'planned' AND scheduled_for < current_date ORDER BY scheduled_for`);
      const corrective_actions_overdue = await q(`SELECT id, inspection_id, description, due_date FROM corrective_actions WHERE status = 'open' AND due_date < current_date ORDER BY due_date`);
      const producers_to_inspect = await q(
        `SELECT p.id, p.internal_code, p.last_name, p.first_names, max(i.completed_at) AS last_inspection
           FROM producers p LEFT JOIN inspections i ON i.subject_type = 'producer' AND i.subject_id = p.id AND i.status = 'completed'
          WHERE p.status = 'active' GROUP BY p.id HAVING max(i.completed_at) IS NULL OR max(i.completed_at) < now() - make_interval(months => $1::int)
          ORDER BY max(i.completed_at) NULLS FIRST LIMIT 200`, [m]);
      const loan_installments_overdue = await q(
        `SELECT l.id AS loan_id, l.borrower_type, l.borrower_id, (due.total - rep.net)::text AS overdue_amount
           FROM loans l
           CROSS JOIN LATERAL (SELECT coalesce(sum(amount),0) AS total FROM loan_installments i WHERE i.loan_id = l.id AND i.due_date < current_date) due
           CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN reversal_of IS NULL THEN amount ELSE -amount END),0) AS net FROM loan_repayments r WHERE r.loan_id = l.id) rep
          WHERE l.status = 'disbursed' AND due.total > rep.net`);
      const weighings_pending_approval = await q(`SELECT id, declaration_id, variance_pct FROM weighings WHERE status = 'pending_approval'`);
      const lists = { certificates_expiring, certificates_expired, inspections_overdue, corrective_actions_overdue, producers_to_inspect, loan_installments_overdue, weighings_pending_approval };
      return { horizon_days: d, renewal_months: m, counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])), ...lists };
    });
  }
}
