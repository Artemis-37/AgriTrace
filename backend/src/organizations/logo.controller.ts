import { BadRequestException, Controller, Delete, Get, HttpCode, NotFoundException, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

const MAX_LOGO = 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Type réel d'après les premiers octets (on ne se fie pas au type annoncé) ; SVG volontairement refusé (scripts). */
function sniff(b: Buffer): 'image/png' | 'image/jpeg' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(PNG)) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Logo de la coopérative courante : lisible par tous ses membres, modifiable avec le droit `org:branding`. */
@ApiTags('organisation')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('organization/logo')
export class LogoController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get()
  async get(@Req() req: any, @Res() res: any) {
    const row = (await this.db.tx(req.org.id, (c) => c.query(`SELECT mime, data, sha256 FROM organization_logos`))).rows[0];
    if (!row) throw new NotFoundException('Aucun logo');
    const etag = `"${row.sha256}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Content-Type', row.mime);
    return res.end(row.data);
  }

  @Put()
  @RequirePermissions('org:branding')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO, files: 1 } }))
  async put(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ "file", PNG ou JPEG, 1 Mo maximum)');
    const mime = sniff(file.buffer);
    if (!mime) throw new BadRequestException('Format refusé : PNG ou JPEG uniquement');
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    await this.db.tx(req.org.id, (c) => c.query(
      `INSERT INTO organization_logos(organization_id, mime, data, sha256, updated_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, sha256 = EXCLUDED.sha256, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.org.id, mime, file.buffer, sha, req.user.id]));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'organization.logo_set', entityType: 'organization', entityId: req.org.id, details: { sha256: sha, bytes: file.size } });
    return { ok: true, sha256: sha };
  }

  @Delete()
  @HttpCode(200)
  @RequirePermissions('org:branding')
  async remove(@Req() req: any) {
    await this.db.tx(req.org.id, (c) => c.query(`DELETE FROM organization_logos`));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'organization.logo_removed', entityType: 'organization', entityId: req.org.id });
    return { ok: true };
  }
}
