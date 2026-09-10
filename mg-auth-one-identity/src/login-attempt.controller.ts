import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { actorFromRequest, requireRole, type AuthenticatedRequest } from './auth';
import { LoginAttemptService, type LoginAttemptQuery } from './login-attempt';

@Controller('login-attempts')
export class LoginAttemptController {
  constructor(@Inject(LoginAttemptService) private readonly attempts: LoginAttemptService) {}

  /** 登录历史是全平台账号的安全数据，只对平台管理员开放；本人查看自己的记录另行开接口。 */
  @Get()
  list(@Query() query: LoginAttemptQuery, @Req() req: AuthenticatedRequest) {
    requireRole(actorFromRequest(req), ['system_admin']);
    return this.attempts.list(query);
  }
}
