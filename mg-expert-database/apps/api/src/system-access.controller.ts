import { Body, Controller, Delete, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { actorFromRequest, type AuthenticatedRequest } from './auth';
import { SystemAccessService, type SystemPermissions } from './system-access';

@Controller('systems/:systemId/access')
export class SystemAccessController {
  constructor(@Inject(SystemAccessService) private readonly access: SystemAccessService) {}

  @Get()
  list(@Param('systemId') systemId: string, @Req() req: AuthenticatedRequest) {
    return this.access.list(systemId, actorFromRequest(req));
  }

  @Get('researchers')
  researchers(@Param('systemId') systemId: string, @Req() req: AuthenticatedRequest) {
    return this.access.listResearchCandidates(systemId, actorFromRequest(req));
  }

  @Put(':userId')
  update(@Param('systemId') systemId: string, @Param('userId') userId: string, @Body() body: Partial<SystemPermissions>, @Req() req: AuthenticatedRequest) {
    return this.access.update(systemId, userId, body, actorFromRequest(req));
  }

  @Delete(':userId')
  remove(@Param('systemId') systemId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    return this.access.remove(systemId, userId, actorFromRequest(req));
  }
}
