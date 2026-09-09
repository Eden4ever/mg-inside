import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { AuthService, actorFromRequest, requireRole, type AuthenticatedRequest } from './auth';
import { WeComAuthService } from './wecom-auth';
import { ZentaoAuthService } from './zentao-auth';

@Controller('users')
export class UsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(WeComAuthService) private readonly wecom: WeComAuthService,
    @Inject(ZentaoAuthService) private readonly zentao: ZentaoAuthService) {}

  @Post(':userId/zentao-identity')
  bindZentao(@Param('userId') userId: string, @Body() body: { account?: string }, @Req() req: AuthenticatedRequest) {
    return this.zentao.bind(userId, body?.account ?? '', actorFromRequest(req));
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req);
    requireRole(actor, ['system_admin']);
    return this.auth.listUsers(actor);
  }


  @Get('wecom-sync/status')
  weComSyncStatus(@Req() req: AuthenticatedRequest) {
    requireRole(actorFromRequest(req), ['system_admin']);
    return this.wecom.directorySyncStatus();
  }

  @Post('wecom-sync')
  syncWeCom(@Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req);
    requireRole(actor, ['system_admin']);
    return this.wecom.syncDirectory(actor);
  }

  @Post()
  create(@Body() body: object, @Req() req: AuthenticatedRequest) {
    return this.auth.createUser(body, actorFromRequest(req));
  }

  @Patch(':userId')
  update(@Param('userId') userId: string, @Body() body: object, @Req() req: AuthenticatedRequest) {
    return this.auth.updateUser(userId, body, actorFromRequest(req));
  }

  @Post(':userId/reset-password')
  resetPassword(@Param('userId') userId: string, @Body() body: { password?: string }, @Req() req: AuthenticatedRequest) {
    return this.auth.resetPassword(userId, body.password ?? '', actorFromRequest(req));
  }

  @Post(':userId/wecom-identities')
  bindWeCom(@Param('userId') userId: string, @Body() body: { externalUserId?: string }, @Req() req: AuthenticatedRequest) {
    return this.auth.bindWeCom(userId, body.externalUserId ?? '', actorFromRequest(req));
  }

  @Post(':userId/wecom-identities/:identityId/unbind')
  unbindWeCom(@Param('userId') userId: string, @Param('identityId') identityId: string, @Req() req: AuthenticatedRequest) {
    return this.auth.unbindWeCom(userId, identityId, actorFromRequest(req));
  }
}
