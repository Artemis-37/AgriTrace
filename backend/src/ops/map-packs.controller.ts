import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diskStorage } from 'multer';
import { pipeline } from 'stream/promises';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';

const MAX_PACK_BYTES = 2 * 1024 * 1024 * 1024;
const packsDir = () => path.join(process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'storage', 'documents'), 'map-packs');

/**
 * Fonds de carte hors ligne. L'administrateur dépose un paquet de tuiles raster au format MBTiles (préparé avec QGIS ou un outil
 * équivalent, à partir d'une source dont la licence autorise le stockage) ; les téléphones le téléchargent une fois sur le réseau
 * de la coopérative, puis affichent le fond de carte sans connexion. Le serveur ne télécharge rien sur Internet.
 */
@ApiTags('fonds de carte')
@Controller('map-packs')
export class MapPacksController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Post()
  @RequirePermissions('settings:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: os.tmpdir() }), limits: { fileSize: MAX_PACK_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() b: { name?: string }, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ « file »)');
    try {
      const name = (b?.name ?? '').trim() || path.basename(file.originalname).replace(/\.mbtiles$/i, '');
      if (name.length < 1 || name.length > 120) throw new BadRequestException('Nom du fond de carte : 1 à 120 caractères');
      const fd = await fs.promises.open(file.path, 'r');
      const head = Buffer.alloc(16); await fd.read(head, 0, 16, 0); await fd.close();
      if (head.toString('latin1') !== 'SQLite format 3\0') throw new BadRequestException('Fichier non reconnu : un paquet de tuiles MBTiles (.mbtiles) est attendu');
      const hash = createHash('sha256');
      await pipeline(fs.createReadStream(file.path), hash);
      fs.mkdirSync(packsDir(), { recursive: true });
      const key = randomUUID();
      await fs.promises.copyFile(file.path, path.join(packsDir(), key));
      try {
        const row = (await this.db.tx(req.org.id, (c) => c.query(
          `INSERT INTO map_packs(organization_id, name, filename, size_bytes, sha256, storage_key, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, size_bytes, sha256, uploaded_at`,
          [req.org.id, name, path.basename(file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 120), file.size, hash.digest('hex'), key, req.user.id]))).rows[0];
        await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'map_pack.upload', entityType: 'map_pack', entityId: row.id, details: { name, size_bytes: file.size } });
        return row;
      } catch (e) { await fs.promises.rm(path.join(packsDir(), key), { force: true }); throw e; }
    } finally { await fs.promises.rm(file.path, { force: true }).catch(() => undefined); }
  }

  /** Tout membre de la coopérative (donc tout téléphone connecté) peut savoir quel fond de carte est disponible. */
  @Get('current')
  async current(@Req() req: any) {
    const r = (await this.db.tx(req.org.id, (c) => c.query(`SELECT id, name, size_bytes, sha256, uploaded_at FROM map_packs ORDER BY uploaded_at DESC, id LIMIT 1`))).rows[0];
    if (!r) return { available: false };
    return { available: true, id: r.id, name: r.name, size_bytes: Number(r.size_bytes), sha256: r.sha256, uploaded_at: r.uploaded_at };
  }

  @Get()
  @RequirePermissions('settings:manage')
  async list(@Req() req: any) {
    return (await this.db.tx(req.org.id, (c) => c.query(`SELECT id, name, size_bytes, uploaded_at FROM map_packs ORDER BY uploaded_at DESC`))).rows
      .map((r: any) => ({ ...r, size_bytes: Number(r.size_bytes) }));
  }

  /** Téléchargement avec reprise (en-tête Range) : indispensable pour un fichier de plusieurs dizaines de Mo sur un réseau fragile. */
  @Get(':id/file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Req() req: any, @Res() res: any) {
    const r = (await this.db.tx(req.org.id, (c) => c.query(`SELECT filename, size_bytes, sha256, storage_key FROM map_packs WHERE id = $1`, [id]))).rows[0];
    const file = r && path.join(packsDir(), r.storage_key);
    if (!r || !fs.existsSync(file)) throw new NotFoundException('Fond de carte introuvable');
    const size = Number(r.size_bytes);
    const base = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-SHA256': r.sha256, 'Content-Disposition': `attachment; filename="${r.filename}"` };
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers['range'] ?? ''));
    if (m) {
      const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.status(416).set({ 'Content-Range': `bytes */${size}` }).end(); return; }
      res.status(206).set({ ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.set({ ...base, 'Content-Length': String(size) });
    fs.createReadStream(file).pipe(res);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = (await this.db.tx(req.org.id, (c) => c.query(`DELETE FROM map_packs WHERE id = $1 RETURNING storage_key, name`, [id]))).rows[0];
    if (!r) throw new NotFoundException('Fond de carte introuvable');
    await fs.promises.rm(path.join(packsDir(), r.storage_key), { force: true });
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'map_pack.delete', entityType: 'map_pack', entityId: id, details: { name: r.name } });
  }
}
