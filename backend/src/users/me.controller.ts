import { Controller, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';

/** Contexte de l'utilisateur dans l'organisation courante : permet à un client (portail web) d'adapter son affichage. Le serveur reste seul juge des accès. */
@ApiTags('profil')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('me')
export class MeController {
  @Get()
  me(@Req() req: any) {
    return {
      user: { id: req.user.id, email: req.user.email, full_name: req.user.full_name },
      organization_id: req.org.id,
      permissions: [...req.org.permissions].sort(),
    };
  }
}
