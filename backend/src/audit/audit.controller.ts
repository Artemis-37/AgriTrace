import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access/decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(@Req() req: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.audit.list(req.org.id, Number(limit) || 100, Number(offset) || 0);
  }
}
