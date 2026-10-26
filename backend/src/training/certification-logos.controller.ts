import { BadRequestException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

export const CERT_SCHEMES: Record<string, string> = { rainforest_alliance: 'Rainforest Alliance', fairtrade: 'Fairtrade', fairtrade_usa: 'Fairtrade USA' };
const MAX = 1024 * 1024;
const sniff = (b: Buffer) => (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'image/png' : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : null);

/** Logos des certifications, fournis par la coopérative (PNG ou JPEG) : ils figurent en tête des fiches d'inspection interne exportées. */
@ApiTags('formation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('certification-logos')
export class CertificationLogosController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  async list(@Req() req: any) {
    const have = new Set((await this.db.tx(req.org.id, (c) => c.query(`SELECT scheme FROM certification_logos`))).rows.map((r: any) => r.scheme));
    return Object.entries(CERT_SCHEMES).map(([scheme, label]) => ({ scheme, label, has_logo: have.has(scheme) }));
  }

  @Get(':scheme')
  async get(@Param('scheme') scheme: string, @Req() req: any, @Res() res: any) {
    if (!CERT_SCHEMES[scheme]) throw new NotFoundException('Certification inconnue');
    const row = (await this.db.tx(req.org.id, (c) => c.query(`SELECT mime, data, sha256 FROM certification_logos WHERE scheme = $1`, [scheme]))).rows[0];
    if (!row) throw new NotFoundException('Aucun logo');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', row.mime);
    return res.end(row.data);
  }

  @Put(':scheme')
  @RequirePermissions('questionnaires:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX, files: 1 } }))
  async put(@Param('scheme') scheme: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!CERT_SCHEMES[scheme]) throw new NotFoundException('Certification inconnue');
    if (!file) throw new BadRequestException('Fichier manquant (champ "file", PNG ou JPEG, 1 Mo maximum)');
    const mime = sniff(file.buffer);
    if (!mime) throw new BadRequestException('Format refusé : PNG ou JPEG uniquement');
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    await this.db.tx(req.org.id, (c) => c.query(
      `INSERT INTO certification_logos(organization_id, scheme, mime, data, sha256, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, scheme) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, sha256 = EXCLUDED.sha256, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.org.id, scheme, mime, file.buffer, sha, req.user.id]));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'certification.logo_set', entityType: 'organization', entityId: req.org.id, details: { scheme, sha256: sha } });
    return { ok: true, scheme };
  }

  @Delete(':scheme')
  @HttpCode(200)
  @RequirePermissions('questionnaires:manage')
  async remove(@Param('scheme') scheme: string, @Req() req: any) {
    if (!CERT_SCHEMES[scheme]) throw new NotFoundException('Certification inconnue');
    await this.db.tx(req.org.id, (c) => c.query(`DELETE FROM certification_logos WHERE scheme = $1`, [scheme]));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'certification.logo_removed', entityType: 'organization', entityId: req.org.id, details: { scheme } });
    return { ok: true };
  }
}
