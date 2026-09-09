import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { actorFromRequest, AuthService, type AuthenticatedRequest, Public, FoundationIdentity, SESSION_COOKIE, CHALLENGE_COOKIE, CHALLENGE_BROWSER_COOKIE } from './auth';
import { WECOM_STATE_COOKIE, WeComAuthService } from './wecom-auth';
import { ZentaoAuthService } from './zentao-auth';

interface FastifyRequestLike { headers: { 'user-agent'?: string; cookie?: string; 'x-csrf-token'?: string }; ip?: string; }
interface FastifyReplyLike {
  header(name: string, value: string): FastifyReplyLike;
  headers(values: Record<string, string | string[]>): FastifyReplyLike;
  redirect(url: string, statusCode?: number): unknown;
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

@FoundationIdentity()
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(WeComAuthService) private readonly wecom: WeComAuthService,
    @Inject(ZentaoAuthService) private readonly zentao: ZentaoAuthService) {}

  @Public() @Get('zentao/status')
  zentaoStatus() { return this.zentao.status(); }

  @Public() @Post('zentao/login') @HttpCode(200)
  async zentaoLogin(@Body() body: { username?: string; password?: string }, @Req() req: FastifyRequestLike, @Res({ passthrough: true }) reply: FastifyReplyLike) {
    const result = await this.zentao.login(body?.username ?? '', body?.password ?? '', { userAgent: req.headers['user-agent'], ipAddress: req.ip });
    if (result.state !== 'authenticated') {
      reply.headers({ 'Set-Cookie': [cookieHeader(CHALLENGE_COOKIE, result.rawToken, 300), cookieHeader(CHALLENGE_BROWSER_COOKIE, result.browserNonce, 300), cookieHeader(SESSION_COOKIE, '', 0)] });
      return { state: result.state };
    }
    reply.headers({ 'Set-Cookie': [cookieHeader(SESSION_COOKIE, result.rawToken, Math.max(1, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000))), cookieHeader(CHALLENGE_COOKIE, '', 0), cookieHeader(CHALLENGE_BROWSER_COOKIE, '', 0)] });
    return { user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { username?: string; password?: string }, @Req() req: FastifyRequestLike, @Res({ passthrough: true }) reply: FastifyReplyLike) {
    const result = await this.auth.login(body.username ?? '', body.password ?? '', { userAgent: req.headers['user-agent'], ipAddress: req.ip });
    if (result.state !== 'authenticated') {
      reply.headers({ 'Set-Cookie': [cookieHeader(CHALLENGE_COOKIE, result.rawToken, 300), cookieHeader(CHALLENGE_BROWSER_COOKIE, result.browserNonce, 300), cookieHeader(SESSION_COOKIE, '', 0)], 'Cache-Control': 'no-store' });
      return { state: result.state };
    }
    const maxAge = Math.max(1, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
    reply.header('Set-Cookie', cookieHeader(SESSION_COOKIE, result.rawToken, maxAge));
    return { user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() };
  }

  @Public()
  @Get('pending')
  pending(@Req() req: FastifyRequestLike, @Res({ passthrough: true }) reply: FastifyReplyLike) {
    reply.header('Cache-Control', 'no-store');
    return this.auth.pendingStatus(req.headers.cookie);
  }

  @Public()
  @Post('setup')
  @HttpCode(200)
  async setup(@Body() input: { username?: string; password?: string }, @Req() req: FastifyRequestLike, @Res({ passthrough: true }) reply: FastifyReplyLike) {
    const result = await this.auth.completeSetup(req.headers.cookie, req.headers['x-csrf-token'], input, { userAgent: req.headers['user-agent'], ipAddress: req.ip });
    reply.headers({ 'Set-Cookie': [cookieHeader(SESSION_COOKIE, result.rawToken, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)), cookieHeader(CHALLENGE_COOKIE, '', 0), cookieHeader(CHALLENGE_BROWSER_COOKIE, '', 0)], 'Cache-Control': 'no-store' });
    return { user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() };
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { user: req.user, csrfToken: req.authSession?.csrfToken };
  }

  @Public()
  @Post('mfa')
  @HttpCode(200)
  async mfa(@Body() input: { method?: string; code?: string }, @Req() req: FastifyRequestLike, @Res({ passthrough: true }) reply: FastifyReplyLike) {
    const result = await this.auth.completeMfa(req.headers.cookie, req.headers['x-csrf-token'], input?.method, input?.code, { userAgent: req.headers['user-agent'], ipAddress: req.ip });
    if (result.state !== 'authenticated') {
      reply.headers({ 'Set-Cookie': [cookieHeader(CHALLENGE_COOKIE, result.rawToken, 300), cookieHeader(CHALLENGE_BROWSER_COOKIE, result.browserNonce, 300)], 'Cache-Control': 'no-store' });
      return { state: result.state };
    }
    reply.headers({ 'Set-Cookie': [cookieHeader(SESSION_COOKIE, result.rawToken, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)), cookieHeader(CHALLENGE_COOKIE, '', 0), cookieHeader(CHALLENGE_BROWSER_COOKIE, '', 0)], 'Cache-Control': 'no-store' });
    return { user: result.user, csrfToken: result.csrfToken };
  }

  @Public()
  @Post('mfa/email')
  @HttpCode(200)
  sendMfaEmail(@Req() req: FastifyRequestLike) { return this.auth.sendMfaEmail(req.headers.cookie, req.headers['x-csrf-token']); }
  @Public()
  @Post('mfa/key')
  @HttpCode(200)
  mfaKeyOptions(@Req() req: FastifyRequestLike) { return this.auth.mfaKeyOptions(req.headers.cookie, req.headers['x-csrf-token']); }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReplyLike): Promise<void> {
    if (req.authSession) await this.auth.logout(req.authSession.id);
    reply.header('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0));
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body() body: { currentPassword?: string; newPassword?: string }, @Req() req: AuthenticatedRequest) {
    return this.auth.changePassword(actorFromRequest(req), req.authSession!.id, body.currentPassword ?? '', body.newPassword ?? '');
  }

  @Public()
  @Get('wecom/status')
  wecomStatus() {
    return this.wecom.status();
  }

  @Public()
  @Post('wecom/start')
  @HttpCode(200)
  async wecomStart(@Body() body: { returnTo?: string }, @Res({ passthrough: true }) reply: FastifyReplyLike) {
    const result = await this.wecom.start(body.returnTo);
    reply.header('Set-Cookie', cookieHeader(WECOM_STATE_COOKIE, result.browserNonce, 600));
    return { loginUrl: result.loginUrl };
  }

  @Public()
  @Get('wecom/callback')
  async wecomCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: FastifyRequestLike, @Res() reply: FastifyReplyLike) {
    const webOrigin = (process.env.WEB_APP_URL || process.env.WEB_ORIGIN?.split(',')[0] || 'http://localhost:5173').replace(/\/$/, '');
    try {
      const result = await this.wecom.complete(code, state, req.headers.cookie, { userAgent: req.headers['user-agent'], ipAddress: req.ip });
      if (result.state !== 'authenticated') {
        reply.headers({ 'Set-Cookie': [cookieHeader(CHALLENGE_COOKIE, result.rawToken, 300), cookieHeader(CHALLENGE_BROWSER_COOKIE, result.browserNonce, 300), cookieHeader(SESSION_COOKIE, '', 0), cookieHeader(WECOM_STATE_COOKIE, '', 0)], 'Cache-Control': 'no-store' });
        return reply.redirect(`${webOrigin}/?authPending=1`, 303);
      }
      const maxAge = Math.max(1, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
      reply.headers({
        'Set-Cookie': [cookieHeader(SESSION_COOKIE, result.rawToken, maxAge), cookieHeader(WECOM_STATE_COOKIE, '', 0)],
        'Cache-Control': 'no-store',
      });
      return reply.redirect(`${webOrigin}${result.returnTo}`, 303);
    } catch {
      reply.headers({ 'Set-Cookie': cookieHeader(WECOM_STATE_COOKIE, '', 0), 'Cache-Control': 'no-store' });
      return reply.redirect(`${webOrigin}/?authError=wecom_failed`, 303);
    }
  }
}
