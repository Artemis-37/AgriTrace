import { Controller, Get, Headers, NotFoundException, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { Public } from '../access/decorators';
import { DbService } from '../db/db.service';
import { render } from './metrics';

@ApiExcludeController()
@SkipThrottle()
@Controller()
export class OpsController {
  constructor(private readonly db: DbService) {}

  /** Vivacité : le processus répond. Aucune dépendance. */
  @Public() @Get('health')
  health() { return { status: 'ok' }; }

  /** Disponibilité : la base répond (pour l'orchestrateur et l'équilibreur). */
  @Public() @Get('ready')
  async ready() {
    try { await this.db.query('SELECT 1'); return { status: 'ready' }; } catch { throw new ServiceUnavailableException({ status: 'database_unavailable' }); }
  }

  /** Métriques Prometheus, uniquement si METRICS_TOKEN est défini (sinon la route n'existe pas). */
  @Public() @Get('metrics')
  metrics(@Headers('authorization') auth: string | undefined, @Res() res: any) {
    const token = process.env.METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    const given = Buffer.from((auth ?? '').replace(/^Bearer /, ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new UnauthorizedException();
    res.type('text/plain; version=0.0.4').send(render());
  }
}
