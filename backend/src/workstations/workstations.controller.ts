import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Public, RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { forgetPolicy } from '../access/workstation-policy';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 : lisible au téléphone
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const normalize = (c: string) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

class CodeDto { @IsString() @Length(2, 60) name: string; @IsOptional() @IsString() @Length(0, 60) function_label?: string; }
class PairDto { @IsString() @Length(8, 12) code: string; }
class RevokeDto { @IsOptional() @IsString() @Length(0, 300) reason?: string; }
class PolicyDto { @IsBoolean() required: boolean; }

@ApiTags('workstations')
@Controller()
export class WorkstationsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  /** Code d'association : 8 caractères, valable 15 minutes, utilisable une seule fois. */
  @ApiBearerAuth() @ApiHeader({ name: 'X-Organization-Id', required: true })
  @Post('workstations/pairing-codes')
  @RequirePermissions('workstations:manage')
  async createCode(@Body() b: CodeDto, @Req() req: any) {
    const code = newCode();
    const [row] = await this.db.query(
      `INSERT INTO workstation_pairing_codes(code_hash, organization_id, name, function_label, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + interval '15 minutes') RETURNING expires_at`,
      [sha(code), req.org.id, b.name.trim(), b.function_label?.trim() || null, req.user.id]);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'workstation.code', entityType: 'workstation', entityId: req.user.id, details: { name: b.name } });
    return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_at: row.expires_at };
  }

  /** Appelé par le poste lui-même (pas encore connecté) : échange le code contre un jeton propre au poste. */
  @Public()
  @HttpCode(201)
  @Post('workstations/pair')
  async pair(@Body() b: PairDto) {
    const code = normalize(b.code);
    if (code.length !== 8) throw new BadRequestException('Code invalide.');
    const token = randomBytes(32).toString('base64url');
    // Réservation atomique du code : un seul poste peut l'utiliser.
    const [c] = await this.db.query(
      `UPDATE workstation_pairing_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING organization_id, name, function_label, created_by`,
      [sha(code)]);
    if (!c) throw new ForbiddenException('Code inconnu, expiré ou déjà utilisé.');
    const ws = await this.db.tx(c.organization_id, async (cl) => {
      const r = await cl.query(
        `INSERT INTO workstations(organization_id, name, function_label, token_hash, created_by, last_seen_at) VALUES ($1,$2,$3,$4,$5, now()) RETURNING id, name`,
        [c.organization_id, c.name, c.function_label, sha(token), c.created_by]);
      await cl.query(`UPDATE workstation_pairing_codes SET workstation_id = $1 WHERE code_hash = $2`, [r.rows[0].id, sha(code)]);
      return r.rows[0];
    });
    await this.audit.log({ organizationId: c.organization_id, actorUserId: c.created_by, action: 'workstation.pair', entityType: 'workstation', entityId: ws.id, details: { name: ws.name } });
    return { workstation_id: ws.id, name: ws.name, device_token: token };
  }

  @ApiBearerAuth() @ApiHeader({ name: 'X-Organization-Id', required: true })
  @Get('workstations')
  @RequirePermissions('workstations:manage')
  async list(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const w = (await c.query(`SELECT id, name, function_label, status, created_at, last_seen_at, revoked_at, revoked_reason FROM workstations ORDER BY status, name`)).rows;
      const s = (await c.query(`SELECT workstations_required FROM org_settings WHERE organization_id = $1`, [req.org.id])).rows[0];
      return { required: !!s?.workstations_required, current_is_paired: !!req.workstation, workstations: w };
    });
  }

  /** Révocation : effet immédiat, même avec un bon mot de passe. Le poste doit être réassocié pour travailler. */
  @ApiBearerAuth() @ApiHeader({ name: 'X-Organization-Id', required: true })
  @Post('workstations/:id/revoke')
  @RequirePermissions('workstations:manage')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Body() b: RevokeDto, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(
      `UPDATE workstations SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoked_reason = $3 WHERE id = $1 AND status = 'active' RETURNING id, name`,
      [id, req.user.id, b.reason ?? null])).rows[0]);
    if (!r) throw new NotFoundException('Poste introuvable ou déjà révoqué.');
    forgetPolicy(req.org.id);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'workstation.revoke', entityType: 'workstation', entityId: id, details: { reason: b.reason ?? null } });
    return { ok: true };
  }

  /** « Rendre l'association obligatoire ». Refusé depuis un poste non associé (sinon l'administrateur se bloquerait lui-même). */
  @ApiBearerAuth() @ApiHeader({ name: 'X-Organization-Id', required: true })
  @Put('workstations/policy')
  @RequirePermissions('workstations:manage')
  async policy(@Body() b: PolicyDto, @Req() req: any) {
    if (b.required && !req.workstation) throw new BadRequestException('Associez d\'abord ce poste (code d\'association), puis rendez l\'association obligatoire : sinon vous ne pourriez plus vous connecter.');
    await this.db.tx(req.org.id, async (c) => c.query(
      `INSERT INTO org_settings(organization_id, workstations_required, updated_by) VALUES ($1,$2,$3)
       ON CONFLICT (organization_id) DO UPDATE SET workstations_required = $2, updated_at = now(), updated_by = $3`, [req.org.id, b.required, req.user.id]));
    forgetPolicy(req.org.id);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'workstation.policy', entityType: 'organization', entityId: req.org.id, details: { required: b.required } });
    return { required: b.required };
  }
}
