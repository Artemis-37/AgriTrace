import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common';
import { Public } from '../access/decorators';
import { isCentral } from './replication.config';
import { ReplicationService } from './replication.service';
import { WindowsReplicaService } from './windows-replica.service';

@Controller()
export class WindowsReplicaController {
  constructor(private readonly repl: ReplicationService, private readonly win: WindowsReplicaService) {}

  /** Même jeton de site que `replication/push` (« idSite.secret ») ; le corps est celui du serveur local Windows. */
  @Public()
  @Post('replication/windows')
  @HttpCode(200)
  async receive(@Headers('x-site-token') token: string, @Body() body: any) {
    if (!isCentral()) throw new ForbiddenException("Ce serveur n'est pas un serveur central");
    const site = await this.repl.authenticateSite(token);
    return this.win.receive(site, body);
  }
}
