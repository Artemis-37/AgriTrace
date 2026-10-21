import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diskStorage } from 'multer';
import { pipeline } from 'stream/promises';
import { PlatformAdminOnly, Public, RequirePermissions } from '../access/decorators';
import { DbService } from '../db/db.service';
import { isLocal } from '../replication/replication.config';

const MAX_INSTALLER_BYTES = 400 * 1024 * 1024;
const releasesDir = () => path.join(process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'storage', 'documents'), 'app-releases');
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Compare deux versions « x.y.z » : négatif si a < b, 0 si égales, positif si a > b. */
export const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/**
 * Mise à jour de l'application de bureau. L'administrateur dépose l'installateur Windows sur le serveur de sa coopérative ;
 * les postes (et le serveur lui-même) le voient, le téléchargent sur le réseau local, vérifient son empreinte et l'installent.
 * Rien ne passe par Internet. L'installateur est signé hors du serveur (Ed25519, voir desktop/scripts/sign-release.js) : les postes vérifient la signature avec la clé publique embarquée ; sans clé configurée, seule l'empreinte déclarée à l'envoi est contrôlée.
 */
@ApiTags('mise à jour de l\'application')
@Controller()
export class AppUpdateController {
  constructor(private readonly db: DbService) {}

  private async store(file: Express.Multer.File, version: string, notes: string | undefined, userId: string, signature?: string) {
    const cleanup = () => fs.promises.rm(file.path, { force: true }).catch(() => undefined);
    try {
      if (!VERSION.test(version ?? '')) throw new BadRequestException('Version attendue au format x.y.z (ex. 0.2.0)');
      if (signature !== undefined && signature !== '' && !/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new BadRequestException('Signature invalide (Ed25519, 64 octets en base64)');
      const fd = await fs.promises.open(file.path, 'r');
      const head = Buffer.alloc(2); await fd.read(head, 0, 2, 0); await fd.close();
      if (head.toString('latin1') !== 'MZ') throw new BadRequestException('Fichier non reconnu : un installateur Windows (.exe) est attendu');
      const hash = createHash('sha256');
      await pipeline(fs.createReadStream(file.path), hash);
      const sha = hash.digest('hex');
      const newest = (await this.db.query(`SELECT version FROM app_releases ORDER BY string_to_array(version, '.')::int[] DESC LIMIT 1`))[0];
      if (newest && compareVersions(version, newest.version) <= 0) throw new ConflictException(`La version ${version} n'est pas plus récente que la version ${newest.version} déjà déposée`);
      fs.mkdirSync(releasesDir(), { recursive: true });
      const key = randomUUID();
      await fs.promises.copyFile(file.path, path.join(releasesDir(), key));
      try {
        const r = await this.db.query(
          `INSERT INTO app_releases(version, filename, size_bytes, sha256, storage_key, notes, uploaded_by, signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, version, size_bytes, sha256, uploaded_at, (signature IS NOT NULL) AS signed`,
          [version, path.basename(file.originalname).replace(/[^\w.\- ]/g, '_').slice(0, 120), file.size, sha, key, notes?.slice(0, 500) ?? null, userId, signature || null]);
        return r[0];
      } catch (e) { await fs.promises.rm(path.join(releasesDir(), key), { force: true }); throw e; }
    } finally { await cleanup(); }
  }

  private static readonly upload = () => FileInterceptor('file', { storage: diskStorage({ destination: os.tmpdir() }), limits: { fileSize: MAX_INSTALLER_BYTES, files: 1 } });

  /** Serveur de coopérative : l'administrateur dépose l'installateur d'une nouvelle version. */
  @Post('app/releases')
  @RequirePermissions('settings:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(AppUpdateController.upload())
  async uploadLocal(@UploadedFile() file: Express.Multer.File, @Body() b: { version?: string; notes?: string; signature?: string }, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ « file »)');
    if (!isLocal()) { await fs.promises.rm(file.path, { force: true }); throw new ForbiddenException('Sur le serveur central, l\'installateur est déposé par l\'administrateur de la plateforme'); }
    return this.store(file, b?.version ?? '', b?.notes, req.user.id, typeof b?.signature === 'string' ? b.signature.trim() : undefined);
  }

  /** Serveur central : administrateur de la plateforme. */
  @Post('platform/app/releases')
  @PlatformAdminOnly()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(AppUpdateController.upload())
  async uploadCentral(@UploadedFile() file: Express.Multer.File, @Body() b: { version?: string; notes?: string; signature?: string }, @Req() req: any) {
    if (!file) throw new BadRequestException('Fichier manquant (champ « file »)');
    return this.store(file, b?.version ?? '', b?.notes, req.user.id, typeof b?.signature === 'string' ? b.signature.trim() : undefined);
  }

  /** Version la plus récente disponible, comparée à celle du poste. Public : le poste vérifie avant toute connexion d'un utilisateur. */
  @Public()
  @Get('app/update')
  async check(@Query('current') current?: string) {
    const cur = VERSION.test(current ?? '') ? (current as string) : '0.0.0';
    const latest = (await this.db.query(`SELECT version, size_bytes, sha256, notes, uploaded_at, signature FROM app_releases ORDER BY string_to_array(version, '.')::int[] DESC LIMIT 1`))[0];
    if (!latest || compareVersions(latest.version, cur) <= 0) return { available: false, current: cur };
    return { available: true, current: cur, version: latest.version, size_bytes: Number(latest.size_bytes), sha256: latest.sha256, notes: latest.notes, uploaded_at: latest.uploaded_at, signature: latest.signature ?? null };
  }

  @Public()
  @Get('app/installer/:version')
  async download(@Param('version') version: string, @Res() res: any) {
    if (!VERSION.test(version)) throw new BadRequestException('Version invalide');
    const r = (await this.db.query(`SELECT filename, size_bytes, sha256, storage_key FROM app_releases WHERE version = $1`, [version]))[0];
    const file = r && path.join(releasesDir(), r.storage_key);
    if (!r || !fs.existsSync(file)) throw new NotFoundException('Version introuvable');
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(r.size_bytes), 'Content-Disposition': `attachment; filename="${r.filename}"`, 'X-Content-SHA256': r.sha256 });
    fs.createReadStream(file).pipe(res);
  }
}
