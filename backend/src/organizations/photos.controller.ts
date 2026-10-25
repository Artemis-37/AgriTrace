import { BadRequestException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

const MAX_PHOTO = 2 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function sniff(b: Buffer): 'image/png' | 'image/jpeg' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(PNG)) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}
/** Droit requis par type de personne : lecture / écriture (au moins un des droits listés). */
const RIGHTS: Record<string, { read: string[]; write: string[] }> = {
  producer: { read: ['producers:read'], write: ['producers:update', 'producers:create'] },
  user: { read: ['users:read', 'collectors:manage', 'users:manage', 'users:create'], write: ['collectors:manage', 'users:manage', 'users:create'] },
};

/** Photo d'identité facultative d'une personne (producteur, délégué ou utilisateur), PNG ou JPEG, 2 Mo maximum. */
@ApiTags('photos')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('photos')
export class PhotosController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  private allow(req: any, type: string, mode: 'read' | 'write') {
    const r = RIGHTS[type];
    if (!r) throw new BadRequestException('Type inconnu (producer ou user)');
    if (!r[mode].some((p) => req.org.permissions.has(p))) throw new ForbiddenException('Droit insuffisant');
  }

  @Get(':type/:id')
  async get(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    this.allow(req, type, 'read');
    const row = (await this.db.tx(req.org.id, (c) => c.query(`SELECT mime, data, sha256 FROM person_photos WHERE subject_type = $1 AND subject_id = $2`, [type, id]))).rows[0];
    if (!row) throw new NotFoundException('Aucune photo');
    const etag = `"${row.sha256}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Content-Type', row.mime);
    return res.end(row.data);
  }

  @Put(':type/:id')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO, files: 1 } }))
  async put(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    this.allow(req, type, 'write');
    if (!file) throw new BadRequestException('Fichier manquant (champ "file", PNG ou JPEG, 2 Mo maximum)');
    const mime = sniff(file.buffer);
    if (!mime) throw new BadRequestException('Format refusé : PNG ou JPEG uniquement');
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    await this.db.tx(req.org.id, async (c) => {
      const t = type === 'producer' ? 'producers' : 'users';
      const ok = type === 'producer'
        ? await c.query(`SELECT 1 FROM producers WHERE id = $1`, [id])
        : await c.query(`SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2`, [id, req.org.id]);
      if (!ok.rowCount) throw new NotFoundException(`Personne introuvable (${t})`);
      await c.query(
        `INSERT INTO person_photos(organization_id, subject_type, subject_id, mime, data, sha256, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id, subject_type, subject_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, sha256 = EXCLUDED.sha256, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [req.org.id, type, id, mime, file.buffer, sha, req.user.id]);
    });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'person.photo_set', entityType: type, entityId: id, details: { sha256: sha, bytes: file.size } });
    return { ok: true, sha256: sha };
  }

  @Delete(':type/:id')
  @HttpCode(200)
  async remove(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.allow(req, type, 'write');
    await this.db.tx(req.org.id, (c) => c.query(`DELETE FROM person_photos WHERE subject_type = $1 AND subject_id = $2`, [type, id]));
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'person.photo_removed', entityType: type, entityId: id });
    return { ok: true };
  }
}
