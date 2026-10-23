import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { assertStrongPassword } from '../auth/password-policy';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Public, PlatformAdminOnly, RequirePermissions } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../db/db.service';
import { decodePairing, encodePairing, isCentral, isLocal, mode, newSecret, sha256 } from './replication.config';
import { ReplicationService } from './replication.service';
import { tlsInfo } from '../ops/tls';

class CreateSiteDto {
  /** Pour rattacher une coopérative déjà installée en local : son identifiant, affiché dans ses réglages de synchronisation. */
  @IsOptional() @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) organization_id?: string;
  @Matches(/^[A-Z0-9_-]{2,20}$/) organization_code: string;
  @IsString() @Length(2, 200) organization_name: string;
  @IsOptional() @Length(2, 2) country_code?: string;
  @IsOptional() @IsString() @Length(2, 200) site_name?: string;
  @IsOptional() @IsString() public_url?: string;
}
class SiteStatusDto { @IsIn(['active', 'suspended']) status: 'active' | 'suspended'; }
class LinkDto { @IsString() @Length(10, 4000) pairing_code: string; }
class BootstrapDto {
  @IsString() @Length(2, 200) admin_name: string;
  @IsString() @Length(5, 200) admin_email: string;
  @IsString() @Length(12, 200) admin_password: string;
  @IsOptional() @IsString() pairing_code?: string;
  @IsOptional() @Matches(/^[A-Z0-9_-]{2,20}$/) organization_code?: string;
  @IsOptional() @IsString() @Length(2, 200) organization_name?: string;
}

@ApiTags('replication')
@Controller()
export class ReplicationController {
  constructor(
    private readonly db: DbService,
    private readonly svc: ReplicationService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  // ---------- Informations publiques (écran de démarrage, client de bureau) ----------
  @Public()
  @Get('mode')
  async info() {
    const [u] = await this.db.query(`SELECT count(*)::int AS n FROM users WHERE NOT is_platform_admin`);
    const t = tlsInfo();
    return { mode: mode(), initialized: u.n > 0, schema_version: await this.svc.schemaVersion(), version: process.env.APP_VERSION ?? '0.1.0', ...(t && { tls: true, tls_fingerprint: t.fingerprint }) };
  }

  /** Certificat public du serveur (PEM) : pour l'installer sur un navigateur ou un poste qui ne l'épingle pas. Aucune clé privée. */
  @Public()
  @Get('tls/certificate')
  certificate(@Res() res: any) {
    const t = tlsInfo();
    if (!t) throw new NotFoundException('Ce serveur n\'utilise pas de certificat local');
    res.type('application/x-pem-file').set('Content-Disposition', 'attachment; filename="agritrace-serveur.crt"').send(t.cert);
  }

  // ---------- Indicateur de connexion (tous les utilisateurs de la coopérative) ----------
  /** Postes vus récemment (mémoire du serveur : un battement toutes les 30 s, oubliés après 90 s). Aucune donnée métier. */
  private readonly stations = new Map<string, Map<string, { name: string; user: string; seen: number }>>();

  @Post('connection/heartbeat')
  heartbeat(@Req() req: any, @Body() b: { station?: string; name?: string }) {
    const id = String(b?.station ?? '').slice(0, 64);
    if (!id) throw new BadRequestException('Poste inconnu');
    let m = this.stations.get(req.org.id);
    if (!m) this.stations.set(req.org.id, (m = new Map()));
    m.set(id, { name: String(b?.name ?? 'Poste').slice(0, 40), user: req.user.full_name ?? '', seen: Date.now() });
    return { ok: true };
  }

  /** État de la chaîne poste → serveur de la coopérative → serveur central, et postes connectés. */
  @Get('connection')
  async connection(@Req() req: any) {
    const m = this.stations.get(req.org.id) ?? new Map();
    for (const [k, v] of m) if (Date.now() - v.seen > 90000) m.delete(k);
    const stations = [...m.values()].map((v) => ({ name: v.name, user: v.user })).sort((a, b) => a.name.localeCompare(b.name));
    if (isLocal()) {
      const st = await this.svc.status();
      return { mode: 'local', stations, central: { linked: st.linked, last_ok_at: st.last_ok_at, pending_rows: st.pending_rows, error: st.last_error } };
    }
    return { mode: mode(), stations, central: null };
  }

  // ---------- Premier démarrage d'un serveur local ----------
  /** Crée la coopérative et son administrateur sur un serveur local vierge (avec ou sans jumelage au central). */
  @Public()
  @Post('bootstrap/local')
  async bootstrap(@Body() b: BootstrapDto, @Req() req: any) {
    if (!isLocal()) throw new ForbiddenException('Réservé au mode serveur local');
    // Serveur vierge ouvert sur le réseau : l'initialisation n'est acceptée que depuis ce poste (127.0.0.1) ou avec le jeton BOOTSTRAP_TOKEN.
    const remote = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    const own = new Set(Object.values(require('os').networkInterfaces()).flat().map((i: any) => i?.address)); // ce poste, y compris par son adresse du réseau local
    const loopback = remote === '::1' || /^127\./.test(remote) || own.has(remote);
    const token = process.env.BOOTSTRAP_TOKEN;
    const given = String(req.headers['x-bootstrap-token'] ?? '');
    const tokenOk = !!token && given.length === token.length && require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(token));
    if (!loopback && !tokenOk) throw new ForbiddenException("Initialisation refusée depuis le réseau : lancez-la depuis le poste serveur, ou fournissez l'en-tête X-Bootstrap-Token (variable BOOTSTRAP_TOKEN)");
    assertStrongPassword(b.admin_password, b.admin_email);
    const hash = await this.auth.hashPassword(b.admin_password);
    let org: { id: string; code: string; name: string; country?: string };
    let pairing = b.pairing_code?.trim();
    if (pairing) {
      let p;
      try { p = decodePairing(pairing); } catch (e: any) { throw new BadRequestException(e.message); }
      await this.svc.hello(p);
      org = { id: p.o, code: p.c, name: p.n };
    } else {
      if (!b.organization_code || !b.organization_name) throw new BadRequestException('Code et nom de la coopérative requis');
      org = { id: '', code: b.organization_code, name: b.organization_name };
    }
    const orgId = await this.db.tx(null, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(7770001)`);
      const n = (await c.query(`SELECT count(*)::int AS n FROM users WHERE NOT is_platform_admin`)).rows[0].n;
      if (n > 0) throw new ConflictException('Ce serveur est déjà initialisé');
      const o = org.id
        ? (await c.query(`INSERT INTO organizations(id, code, name) VALUES ($1,$2,$3) RETURNING id`, [org.id, org.code, org.name])).rows[0]
        : (await c.query(`INSERT INTO organizations(code, name) VALUES ($1,$2) RETURNING id`, [org.code, org.name])).rows[0];
      return o.id as string;
    });
    await this.db.tx(orgId, async (c) => {
      const role = (await c.query(`INSERT INTO roles(organization_id, code, name) VALUES ($1,'coop_admin','Administrateur de coopérative') RETURNING id`, [orgId])).rows[0];
      await c.query(`INSERT INTO role_permissions(role_id, permission_code) SELECT $1, code FROM permissions WHERE code <> 'cash:session'`, [role.id]);
      const u = (await c.query(`INSERT INTO users(email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id`, [b.admin_email.toLowerCase(), b.admin_name, hash])).rows[0];
      await c.query(`INSERT INTO user_organizations(user_id, organization_id, role_id, created_by) VALUES ($1,$2,$3,$1)`, [u.id, orgId, role.id]);
    });
    let sync: any = null;
    if (pairing) sync = await this.svc.linkTo(orgId, pairing);
    await this.audit.log({ organizationId: orgId, action: 'organization.bootstrap_local', entityType: 'organization', entityId: orgId });
    return { organization_id: orgId, linked: !!pairing, queued: sync?.queued ?? 0 };
  }

  // ---------- Côté local : état et réglages de la synchronisation ----------
  @ApiBearerAuth()
  @Get('replication/status')
  async status(@Req() req: any) {
    if (isCentral()) {
      const [s] = await this.db.query(`SELECT id, name, status, last_push_at, last_error FROM replication_sites WHERE organization_id = $1`, [req.org.id]);
      return { mode: 'central', site: s ?? null };
    }
    return { ...(await this.svc.status()), organization: (await this.db.query(`SELECT id, code, name FROM organizations WHERE id = $1`, [req.org.id]))[0] };
  }

  @ApiBearerAuth()
  @RequirePermissions('replication:manage')
  @Post('replication/link')
  async link(@Body() b: LinkDto, @Req() req: any) {
    if (!isLocal()) throw new ForbiddenException('Réservé au mode serveur local');
    const out = await this.svc.linkTo(req.org.id, b.pairing_code);
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'replication.link', entityType: 'organization', entityId: req.org.id });
    return out;
  }

  @ApiBearerAuth()
  @RequirePermissions('replication:manage')
  @Post('replication/unlink')
  async unlink(@Req() req: any) {
    if (!isLocal()) throw new ForbiddenException('Réservé au mode serveur local');
    await this.svc.unlink();
    await this.audit.log({ organizationId: req.org.id, actorUserId: req.user.id, action: 'replication.unlink', entityType: 'organization', entityId: req.org.id });
    return { linked: false };
  }

  @ApiBearerAuth()
  @RequirePermissions('replication:manage')
  @Post('replication/sync-now')
  @HttpCode(200)
  async syncNow() {
    if (!isLocal()) throw new ForbiddenException('Réservé au mode serveur local');
    const r = await this.svc.syncOnce();
    return { ...r, status: await this.svc.status() };
  }

  // ---------- Côté central : réception ----------
  @Public()
  @Get('replication/hello')
  async hello(@Headers('x-site-token') token: string) {
    if (!isCentral()) throw new ForbiddenException('Ce serveur n\'est pas un serveur central');
    const site = await this.svc.authenticateSite(token);
    return { site_id: site.id, organization_id: site.organization_id, last_txid: Number(site.last_txid), schema_version: await this.svc.schemaVersion() };
  }

  @Public()
  @Post('replication/push')
  @HttpCode(200)
  async push(@Headers('x-site-token') token: string, @Body() body: any) {
    if (!isCentral()) throw new ForbiddenException('Ce serveur n\'est pas un serveur central');
    const site = await this.svc.authenticateSite(token);
    try {
      return await this.svc.receive(site, body ?? {});
    } catch (e: any) {
      await this.svc.recordSiteError(site.id, e.response?.message ?? e.message);
      throw e;
    }
  }

  // ---------- Côté central : gestion des sites (administrateur de plateforme) ----------
  @ApiBearerAuth()
  @PlatformAdminOnly()
  @Post('replication/sites')
  async createSite(@Body() b: CreateSiteDto, @Req() req: any) {
    if (!isCentral()) throw new ForbiddenException('Réservé au serveur central');
    const secret = newSecret();
    const site = await this.db.tx(null, async (c) => {
      // La coopérative est créée « vide » : rôles et utilisateurs arriveront du serveur local.
      const o = (await c.query(`INSERT INTO organizations(id, code, name, country_code, created_by) VALUES (COALESCE($5::uuid, gen_random_uuid()),$1,$2,$3,$4) RETURNING id, code, name`,
        [b.organization_code, b.organization_name, (b.country_code ?? 'CI').toUpperCase(), req.user.id, b.organization_id ?? null])).rows[0];
      const s = (await c.query(`INSERT INTO replication_sites(organization_id, name, token_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
        [o.id, b.site_name ?? `Serveur ${o.name}`, sha256(secret), req.user.id])).rows[0];
      return { id: s.id as string, org: o };
    });
    const url = (b.public_url ?? process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    await this.audit.log({ actorUserId: req.user.id, action: 'replication.site_create', entityType: 'site', entityId: site.id });
    return { site_id: site.id, organization_id: site.org.id, pairing_code: encodePairing({ u: url, s: site.id, t: secret, o: site.org.id, c: site.org.code, n: site.org.name }) };
  }

  @ApiBearerAuth()
  @PlatformAdminOnly()
  @Get('replication/sites')
  sites() {
    return this.db.query(
      `SELECT s.id, s.name, s.status, s.organization_id, o.code AS organization_code, o.name AS organization_name,
              s.rows_received, s.last_push_at, s.last_error, s.schema_version, s.app_version, s.created_at,
              EXTRACT(EPOCH FROM now() - s.last_push_at)::int AS seconds_since_push
         FROM replication_sites s JOIN organizations o ON o.id = s.organization_id ORDER BY o.name`);
  }

  @ApiBearerAuth()
  @PlatformAdminOnly()
  @Post('replication/sites/:id/rotate-token')
  async rotate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const secret = newSecret();
    const [s] = await this.db.query(
      `UPDATE replication_sites SET token_hash = $2 WHERE id = $1 RETURNING id, organization_id`, [id, sha256(secret)]);
    if (!s) throw new NotFoundException('Site inconnu');
    const [o] = await this.db.query(`SELECT code, name FROM organizations WHERE id = $1`, [s.organization_id]);
    const url = (process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    await this.audit.log({ actorUserId: req.user.id, action: 'replication.site_rotate', entityType: 'site', entityId: id });
    return { pairing_code: encodePairing({ u: url, s: id, t: secret, o: s.organization_id, c: o.code, n: o.name }) };
  }

  @ApiBearerAuth()
  @PlatformAdminOnly()
  @Post('replication/sites/:id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() b: SiteStatusDto, @Req() req: any) {
    const [s] = await this.db.query(`UPDATE replication_sites SET status = $2 WHERE id = $1 RETURNING id, status`, [id, b.status]);
    if (!s) throw new NotFoundException('Site inconnu');
    await this.audit.log({ actorUserId: req.user.id, action: 'replication.site_status', entityType: 'site', entityId: id, details: { status: b.status } });
    return s;
  }

  /** Vue consolidée de toutes les coopératives rattachées. */
  @ApiBearerAuth()
  @PlatformAdminOnly()
  @Get('replication/consolidation')
  async consolidation() {
    const sites = await this.db.query(`SELECT s.id, s.status, s.last_push_at, o.id AS org_id, o.code, o.name FROM replication_sites s JOIN organizations o ON o.id = s.organization_id ORDER BY o.name`);
    const out: any[] = [];
    for (const s of sites) {
      const r = await this.db.tx(s.org_id, async (c) => {
        const q = async (sql: string) => (await c.query(sql)).rows[0];
        const pr = await q(`SELECT count(*)::int AS n FROM producers WHERE status = 'active'`);
        const pa = await q(`SELECT count(*)::int AS n, COALESCE(sum(declared_area_ha),0)::float AS ha FROM parcels WHERE status = 'active'`);
        const de = await q(`SELECT count(*)::int AS n, COALESCE(sum(quantity),0)::float AS qty, COALESCE(sum(amount),0)::float AS amount FROM purchase_declarations`);
        const iv = await q(`SELECT count(*)::int AS n, COALESCE(sum(total),0)::float AS total FROM invoices`);
        return { producers: pr.n, parcels: pa.n, area_ha: pa.ha, declarations: de.n, declared_quantity: de.qty, declared_amount: de.amount, invoices: iv.n, invoiced_total: iv.total };
      });
      out.push({ site_id: s.id, status: s.status, organization_id: s.org_id, code: s.code, name: s.name, last_push_at: s.last_push_at, ...r });
    }
    const sum = (k: string) => out.reduce((a, x) => a + Number(x[k] ?? 0), 0);
    return { sites: out, totals: { producers: sum('producers'), parcels: sum('parcels'), area_ha: sum('area_ha'), declarations: sum('declarations'), declared_quantity: sum('declared_quantity'), invoiced_total: sum('invoiced_total') } };
  }
}
