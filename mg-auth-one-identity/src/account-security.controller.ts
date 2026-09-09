import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { AuthenticatedRequest, FoundationIdentity } from './auth';
import { AccountSecurityService } from './account-security';

@FoundationIdentity()
@Controller('account-security')
export class AccountSecurityController {
  constructor(@Inject(AccountSecurityService) private readonly security: AccountSecurityService) {}
  @Get() read(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: { header(name: string, value: string): unknown }) { reply.header('Cache-Control', 'no-store'); return this.security.read(req.user!.userId, req.authSession!.id); }
  @Post('authorize') authorize(@Body() input: { password: string; code?: string; method?: string }, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: { header(name: string, value: string): unknown }) { reply.header('Cache-Control', 'no-store'); return this.security.authorize(req.user!.userId, req.authSession!.id, input?.password, input?.code, input?.method); }
  @Post('authorize/email') sendEmail(@Req() req: AuthenticatedRequest) { return this.security.sendAuthorizationEmail(req.user!.userId, req.authSession!.id); }
  @Post('authorize/key') keyOptions(@Req() req: AuthenticatedRequest) { return this.security.authorizationKey(req.user!.userId, req.authSession!.id); }
  @Post('key/start') startKey(@Body() input: { token: string; name: string }, @Req() req: AuthenticatedRequest) { return this.security.startKey(req.user!.userId, req.authSession!.id, input?.token, input?.name); }
  @Post('key/confirm') confirmKey(@Body() input: { token: string; response: unknown }, @Req() req: AuthenticatedRequest) { return this.security.confirmKey(req.user!.userId, req.authSession!.id, input?.token, input?.response); }
  @Post('key/remove') removeKey(@Body() input: { token: string; id: string }, @Req() req: AuthenticatedRequest) { return this.security.removeKey(req.user!.userId, req.authSession!.id, input?.token, input?.id); }
  @Post('email/start') startEmail(@Body() input: { token: string; address: string }, @Req() req: AuthenticatedRequest) { return this.security.startEmail(req.user!.userId, req.authSession!.id, input?.token, input?.address); }
  @Post('email/confirm') confirmEmail(@Body() input: { token: string; code: string }, @Req() req: AuthenticatedRequest) { return this.security.confirmEmail(req.user!.userId, req.authSession!.id, input?.token, input?.code); }
  @Post('email/remove') removeEmail(@Body() input: { token: string }, @Req() req: AuthenticatedRequest) { return this.security.removeEmail(req.user!.userId, req.authSession!.id, input?.token); }
  @Post('totp/start') start(@Body() input: { token: string }, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: { header(name: string, value: string): unknown }) { reply.header('Cache-Control', 'no-store'); return this.security.startTotp(req.user!.userId, req.authSession!.id, input?.token); }
  @Post('totp/confirm') confirm(@Body() input: { token: string; code: string }, @Req() req: AuthenticatedRequest) { return this.security.confirmTotp(req.user!.userId, req.authSession!.id, input?.token, input?.code); }
  @Post('totp/remove') remove(@Body() input: { token: string }, @Req() req: AuthenticatedRequest) { return this.security.removeTotp(req.user!.userId, req.authSession!.id, input?.token); }
  @Post('mfa') mfa(@Body() input: { token: string; enabled: boolean; methods: string[] }, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: { header(name: string, value: string): unknown }) { reply.header('Cache-Control', 'no-store'); return this.security.setMfa(req.user!.userId, req.authSession!.id, input?.token, input?.enabled, input?.methods); }
}
