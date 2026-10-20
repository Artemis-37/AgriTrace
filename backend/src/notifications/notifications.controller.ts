import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access/decorators';
import { DbService } from '../db/db.service';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: DbService, private readonly svc: NotificationsService) {}

  /** Chacun ne voit que ses propres notifications. */
  @Get()
  list(@Req() req: any, @Query('unread') unread?: string, @Query('kind') kind?: string, @Query('limit') limit?: string) {
    return this.db.tx(req.org.id, async (c) => (await c.query(
      `SELECT id, kind, severity, title, body, entity_type, entity_id, created_at, read_at FROM notifications
        WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) AND ($3::text IS NULL OR kind = $3)
        ORDER BY created_at DESC LIMIT $4`, [req.user.id, unread === 'true' ? true : null, kind ?? null, Math.min(Number(limit) || 100, 500)])).rows);
  }

  @Get('unread-count')
  async count(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => ({ unread: (await c.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user.id])).rows[0].n }));
  }

  @Post('read-all')
  async readAll(@Req() req: any) {
    return this.db.tx(req.org.id, async (c) => ({ updated: (await c.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id])).rowCount }));
  }

  @Post('scan')
  @RequirePermissions('notifications:scan')
  scan(@Req() req: any) { return this.svc.scanOrg(req.org.id); }

  @Post(':id/read')
  async read(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const r = await this.db.tx(req.org.id, async (c) => (await c.query(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id, read_at`, [id, req.user.id])).rows[0]);
    if (!r) throw new NotFoundException();
    return r;
  }
}
