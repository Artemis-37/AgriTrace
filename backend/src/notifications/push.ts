import { Body, Controller, Delete, HttpCode, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { NoOrg } from '../access/decorators';
import { DbService } from '../db/db.service';

class TokenDto {
  @IsString() @Length(20, 4096) token: string;
  @IsOptional() @IsIn(['android', 'ios', 'web']) platform?: 'android' | 'ios' | 'web';
  @IsOptional() @IsString() @Length(1, 100) device_label?: string;
}
class TokenRemoveDto { @IsString() @Length(20, 4096) token: string; }

interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Notifications poussées vers les téléphones (CDC §25) par Firebase Cloud Messaging (API HTTP v1).
 * Désactivé tant que `FCM_SERVICE_ACCOUNT_JSON` (contenu JSON ou chemin du fichier du compte de service) n'est pas fourni.
 * Les notifications restent consultables dans l'application : la poussée n'est qu'un avertissement, jamais la source de vérité.
 */
@Injectable()
export class PushService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Push');
  private timer?: NodeJS.Timeout;
  private cached?: { token: string; exp: number };
  constructor(private readonly db: DbService) {}

  private account(): ServiceAccount | null {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try { return JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8')); } catch { this.logger.warn('FCM_SERVICE_ACCOUNT_JSON illisible : poussée désactivée'); return null; }
  }
  enabled() { return !!this.account(); }

  private async accessToken(sa: ServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.exp - 60 > now) return this.cached.token;
    const uri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: uri, iat: now, exp: now + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key).toString('base64url');
    const res = await fetch(uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }) });
    if (!res.ok) throw new Error(`jeton FCM refusé (${res.status})`);
    const j: any = await res.json();
    this.cached = { token: j.access_token, exp: now + Number(j.expires_in ?? 3600) };
    return j.access_token;
  }

  /** Envoie un message à un appareil ; retourne false si le jeton n'est plus valide (à révoquer). */
  async sendOne(sa: ServiceAccount, token: string, msg: { title: string; body?: string; data: Record<string, string> }): Promise<boolean> {
    const base = process.env.FCM_ENDPOINT ?? 'https://fcm.googleapis.com';
    const res = await fetch(`${base}/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${await this.accessToken(sa)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body ?? '' }, data: msg.data, android: { priority: 'HIGH' } } }) });
    if (res.ok) return true;
    if (res.status === 404 || res.status === 400) { const t = await res.text(); if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(t)) return false; throw new Error(`FCM ${res.status}: ${t.slice(0, 120)}`); }
    throw new Error(`FCM ${res.status}`);
  }

  /** Envoie les notifications récentes non encore poussées. Une notification sans appareil enregistré est simplement marquée traitée. */
  async flush(): Promise<{ sent: number; revoked: number }> {
    const sa = this.account();
    if (!sa) return { sent: 0, revoked: 0 };
    let sent = 0, revoked = 0;
    const orgs = await this.db.query<{ id: string }>(`SELECT id FROM organizations WHERE status = 'active'`);
    for (const o of orgs) {
      const pending = await this.db.tx(o.id, async (c) => (await c.query(
        `SELECT id, user_id, kind, title, body, entity_type, entity_id FROM notifications
          WHERE push_sent_at IS NULL AND read_at IS NULL AND created_at > now() - interval '1 hour' ORDER BY created_at LIMIT 200`)).rows);
      for (const n of pending) {
        const tokens = await this.db.query<{ id: string; token: string }>(`SELECT id, token FROM push_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [n.user_id]);
        let failed = false;
        for (const t of tokens) {
          try {
            const ok = await this.sendOne(sa, t.token, { title: n.title, body: n.body ?? undefined, data: { kind: n.kind, org_id: o.id, notification_id: n.id, entity_type: n.entity_type ?? '', entity_id: n.entity_id ?? '' } });
            if (ok) sent++; else { revoked++; await this.db.query(`UPDATE push_tokens SET revoked_at = now() WHERE id = $1`, [t.id]); }
          } catch (e: any) { failed = true; this.logger.warn(e.message); }
        }
        if (!failed) await this.db.tx(o.id, (c) => c.query(`UPDATE notifications SET push_sent_at = now() WHERE id = $1`, [n.id])); // en cas d'erreur réseau, nouvel essai au prochain passage
      }
    }
    return { sent, revoked };
  }

  onApplicationBootstrap() {
    const s = Number(process.env.PUSH_INTERVAL_SEC ?? 30);
    if (!s || s < 0) return;
    this.timer = setInterval(() => void this.flush().catch((e) => this.logger.warn(e.message)), s * 1000);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
}

/** Enregistrement du jeton FCM de l'appareil de l'utilisateur connecté (indépendant de la coopérative choisie). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/push-token')
export class PushTokenController {
  constructor(private readonly db: DbService, private readonly push: PushService) {}

  @NoOrg()
  @Post()
  async register(@Body() b: TokenDto, @Req() req: any) {
    await this.db.query(
      `INSERT INTO push_tokens(user_id, token, platform, device_label) VALUES ($1,$2,$3,$4)
       ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $3, device_label = coalesce($4, push_tokens.device_label), last_seen_at = now(), revoked_at = NULL`,
      [req.user.id, b.token, b.platform ?? 'android', b.device_label ?? null]);
    return { registered: true, push_enabled: this.push.enabled() };
  }

  @NoOrg()
  @Delete()
  @HttpCode(204)
  async remove(@Body() b: TokenRemoveDto, @Req() req: any) {
    await this.db.query(`UPDATE push_tokens SET revoked_at = now() WHERE token = $1 AND user_id = $2`, [b.token, req.user.id]);
  }
}
