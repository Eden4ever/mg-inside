import { applyIdentityUser } from './identity-projection';
import { Controller, Get, Inject, Query, Req, Res, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AuthService, Public, SESSION_COOKIE, CHALLENGE_COOKIE, CHALLENGE_BROWSER_COOKIE } from './auth';
import { PrismaService } from './prisma.service';
import { completeIdentity, cookieValue, flowCookie, identityDirectory, identityEnabled, startIdentity } from './identity-client';
import { desktopLoginUrl, unifiedIdentityEnabled } from './unified-client';

function cookie(name: string, value: string, age: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
@Controller('auth/sso')
export class IdentityController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService) {}
  @Public() @Get('status') status() { return { enabled: identityEnabled(), mode: unifiedIdentityEnabled() ? 'unified' : 'legacy',
    ...(unifiedIdentityEnabled() ? { loginUrl: desktopLoginUrl('expert-database') } : {}) }; }
  @Public() @Get('start')
  async start(@Res() reply: any) {
    if (unifiedIdentityEnabled()) return reply.redirect(desktopLoginUrl('expert-database', '/systems'), 303);
    const result = await startIdentity('/'); reply.header('Set-Cookie', result.cookie); return reply.redirect(result.url, 303);
  }
  @Public() @Get('callback')
  async callback(@Req() req: any, @Res() reply: any) {
    if (unifiedIdentityEnabled()) return reply.code(410).send({ message: '旧登录回调已停用，请从统一桌面重新登录' });
    const webOrigin = (process.env.WEB_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
    reply.headers({ 'Set-Cookie': flowCookie('', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    try {
      const { profile } = await completeIdentity(req.url, cookieValue(req.headers.cookie));
      const result = await this.prisma.$transaction(async tx => {
        const updated=await applyIdentityUser(tx,{subject:profile.sub,localUserId:profile.local_user_id,username:profile.preferred_username,
          name:profile.name||'',department:profile.department||null,active:true,securityVersion:0});
        if(!updated)throw new Error('中心身份不可用');
        return this.auth.beginAuthentication(updated, { userAgent: req.headers['user-agent'], ipAddress: req.ip,
          identity: { subject: profile.sub, sessionId: profile.identity_session, authMethods: profile.auth_methods } }, 'sso', tx);
      });
      if (result.state !== 'authenticated') {
        reply.headers({ 'Set-Cookie': [flowCookie('', 0), cookie(CHALLENGE_COOKIE, result.rawToken, 300), cookie(CHALLENGE_BROWSER_COOKIE, result.browserNonce, 300), cookie(SESSION_COOKIE, '', 0)] });
        return reply.redirect(`${webOrigin}/?authPending=1`, 303);
      }
      reply.header('Set-Cookie', [flowCookie('', 0), cookie(SESSION_COOKIE, result.rawToken, Math.max(1, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000))), cookie(CHALLENGE_COOKIE, '', 0), cookie(CHALLENGE_BROWSER_COOKIE, '', 0)]);
      return reply.redirect(webOrigin, 303);
    } catch { return reply.redirect(`${webOrigin}/?authError=sso_failed`, 303); }
  }
}

@Injectable()
export class IdentitySyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(IdentitySyncService.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  onModuleInit() { if (identityEnabled()) { void this.sync(); this.timer = setInterval(() => void this.sync(), 60000); this.timer.unref(); } }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async sync() {
    if (!identityEnabled() || this.busy) return; this.busy = true;
    try {
      const profiles = await identityDirectory();
      await this.prisma.$transaction(async tx=>{
        for(const p of profiles)await applyIdentityUser(tx,p);
        await tx.user.updateMany({where:{identityIssuer:process.env.IDENTITY_ISSUER||'https://identity.meta-gravity.com',identitySubject:profiles.length?{notIn:profiles.map(p=>p.subject)}:{not:null}},data:{identityEnabled:false,status:'disabled'}});
      },{timeout:30000});
    } catch { this.logger.error('统一身份资料同步失败，将在下一轮重试'); }
    finally { this.busy = false; }
  }
}
