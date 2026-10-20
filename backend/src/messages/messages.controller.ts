import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { RequirePermissions } from '../access/decorators';
import { DbService } from '../db/db.service';

export class SendMessageDto {
  @IsString() @Length(8, 100) idempotency_key: string;
  /** Destinataire ; absent = canal général de la coopérative. */
  @IsOptional() @IsUUID() to?: string;
  @IsString() @Length(1, 2000) body: string;
  /** Heure de rédaction sur le poste (messages écrits hors connexion). */
  @IsOptional() @IsISO8601() sent_at?: string;
}
class SeenDto { @IsString() with: string; }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Messagerie entre les postes d'une coopérative : canal général et messages directs. Reste sur le serveur de la coopérative. */
@ApiTags('messagerie')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('messages')
export class MessagesController {
  constructor(private readonly db: DbService) {}

  /** Envoi idempotent : un renvoi (poste qui rejoue sa file) ne crée pas de doublon. */
  @Post()
  @RequirePermissions('messages:use')
  send(@Body() b: SendMessageDto, @Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      if (b.to) {
        if (b.to === req.user.id) throw new BadRequestException('Vous ne pouvez pas vous écrire à vous-même');
        const ok = await c.query(
          `SELECT 1 FROM user_organizations WHERE user_id=$1 AND organization_id=$2 AND status='active' LIMIT 1`, [b.to, req.org.id]);
        if (!ok.rowCount) throw new BadRequestException('Destinataire inconnu dans cette coopérative');
      }
      const ins = await c.query(
        `INSERT INTO messages(organization_id, sender_id, recipient_id, body, idempotency_key, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
         RETURNING id, sender_id, recipient_id, body, sent_at, created_at`,
        [req.org.id, req.user.id, b.to ?? null, b.body.trim(), b.idempotency_key, b.sent_at ?? null]);
      if (ins.rowCount) return ins.rows[0];
      const ex = await c.query(
        `SELECT id, sender_id, recipient_id, body, sent_at, created_at FROM messages WHERE organization_id=$1 AND idempotency_key=$2`,
        [req.org.id, b.idempotency_key]);
      if (ex.rows[0].sender_id !== req.user.id) throw new ForbiddenException('Clé déjà utilisée');
      return ex.rows[0];
    });
  }

  /** Interlocuteurs (membres actifs) avec le nombre de messages non lus ; « general » = canal de la coopérative. */
  @Get('contacts')
  @RequirePermissions('messages:use')
  async contacts(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => {
      const members = (await c.query(
        `SELECT u.id, u.full_name, string_agg(DISTINCT r.name, ', ') AS role
           FROM user_organizations uo JOIN users u ON u.id = uo.user_id JOIN roles r ON r.id = uo.role_id
          WHERE uo.organization_id=$1 AND uo.status='active' AND u.status='active' AND u.id <> $2
          GROUP BY u.id, u.full_name ORDER BY u.full_name`, [req.org.id, req.user.id])).rows;
      const unreadDirect = (await c.query(
        `SELECT m.sender_id AS peer, count(*)::int AS n, max(m.created_at) AS last_at
           FROM messages m LEFT JOIN message_seen s ON s.organization_id=m.organization_id AND s.user_id=$2 AND s.peer_key=m.sender_id::text
          WHERE m.organization_id=$1 AND m.recipient_id=$2 AND (s.seen_at IS NULL OR m.created_at > s.seen_at)
          GROUP BY m.sender_id`, [req.org.id, req.user.id])).rows;
      const general = (await c.query(
        `SELECT count(*)::int AS n FROM messages m LEFT JOIN message_seen s ON s.organization_id=m.organization_id AND s.user_id=$2 AND s.peer_key='general'
          WHERE m.organization_id=$1 AND m.recipient_id IS NULL AND m.sender_id <> $2 AND (s.seen_at IS NULL OR m.created_at > s.seen_at)`,
        [req.org.id, req.user.id])).rows[0];
      const un = new Map(unreadDirect.map((r: any) => [r.peer, r]));
      return {
        general: { unread: general.n },
        contacts: members.map((m: any) => ({ ...m, unread: un.get(m.id)?.n ?? 0, last_at: un.get(m.id)?.last_at ?? null })),
      };
    });
  }

  @Get('unread-count')
  @RequirePermissions('messages:use')
  async unread(@Req() req: any) {
    const r = await this.db.tx(req.org.id, (c) => c.query(
      `SELECT count(*)::int AS n FROM messages m
         LEFT JOIN message_seen s ON s.organization_id=m.organization_id AND s.user_id=$2
              AND s.peer_key = CASE WHEN m.recipient_id IS NULL THEN 'general' ELSE m.sender_id::text END
        WHERE m.organization_id=$1 AND m.sender_id <> $2 AND (m.recipient_id IS NULL OR m.recipient_id = $2)
          AND (s.seen_at IS NULL OR m.created_at > s.seen_at)`, [req.org.id, req.user.id]));
    return { unread: r.rows[0].n };
  }

  /** Fil de discussion : `with=general` ou l'identifiant d'un collègue. Un message direct n'est visible que de son expéditeur et de son destinataire. */
  @Get()
  @RequirePermissions('messages:use')
  async thread(@Query('with') peer: string, @Query('after') after: string | undefined, @Req() req: any) {
    if (peer !== 'general' && !UUID_RE.test(peer ?? '')) throw new BadRequestException('with : « general » ou un identifiant');
    if (after && Number.isNaN(Date.parse(after))) throw new BadRequestException('after : date invalide');
    return this.db.tx(req.org.id, async (c) => {
      const params: any[] = [req.org.id];
      let where: string;
      if (peer === 'general') where = 'm.recipient_id IS NULL';
      else { params.push(req.user.id, peer); where = `((m.sender_id=$2 AND m.recipient_id=$3) OR (m.sender_id=$3 AND m.recipient_id=$2))`; }
      if (after) { params.push(after); where += ` AND m.created_at > $${params.length}`; }
      const rows = (await c.query(
        `SELECT m.id, m.sender_id, u.full_name AS sender_name, m.recipient_id, m.body, m.sent_at, m.created_at
           FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.organization_id=$1 AND ${where} ORDER BY m.created_at, m.id LIMIT 500`, params)).rows;
      return rows;
    });
  }

  @Post('seen')
  @RequirePermissions('messages:use')
  async seen(@Body() b: SeenDto, @Req() req: any) {
    if (b.with !== 'general' && !UUID_RE.test(b.with)) throw new BadRequestException('with invalide');
    await this.db.tx(req.org.id, (c) => c.query(
      `INSERT INTO message_seen(organization_id, user_id, peer_key, seen_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (organization_id, user_id, peer_key) DO UPDATE SET seen_at = now()`, [req.org.id, req.user.id, b.with]));
    return { ok: true };
  }
}
