import { DbService } from '../db/db.service';
import { Controller, Get, Req } from '@nestjs/common';
import { NoOrg } from '../access/decorators';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';

/** Contexte de l'utilisateur dans l'organisation courante : permet à un client (portail web) d'adapter son affichage. Le serveur reste seul juge des accès. */
@ApiTags('profil')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('me')
export class MeController {
  constructor(private readonly db: DbService) {}

  /** Pour le portail : un administrateur de plateforme n'a pas de coopérative mais accède à la console du serveur central. */
  @NoOrg()
  @Get('platform')
  platform(@Req() req: any) {
    return { is_platform_admin: !!req.user.is_platform_admin, full_name: req.user.full_name };
  }

  /**
   * Nature du compte : détermine l'interface proposée et le périmètre de données.
   * collector = délégué acheteur ; coach = agent de terrain (missions) ; staff = personnel de la coopérative.
   * Collecteurs et coachs travaillent sur l'application mobile ; le portail leur reste ouvert mais restreint à leurs droits.
   */
  @Get()
  async me(@Req() req: any) {
    const isCollector = ((await this.db.tx(req.org.id, (c) => c.query(`SELECT 1 FROM collectors WHERE user_id = $1 AND status = 'active'`, [req.user.id]))).rowCount ?? 0) > 0;
    const p: Set<string> = req.org.permissions;
    const kind = isCollector ? 'collector' : p.has('tasks:execute') && !p.has('tasks:decide_requests') ? 'coach' : 'staff';
    return {
      user: { id: req.user.id, email: req.user.email, full_name: req.user.full_name },
      must_change_password: !!req.user.must_change_password,
      organization_id: req.org.id,
      permissions: [...p].sort(),
      account_kind: kind,
      mobile_first: kind !== 'staff',
    };
  }
}
