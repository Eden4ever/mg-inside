import { Controller, Get, Query, Req, Res, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Request, Response } from 'express'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { Cron } from '@nestjs/schedule'
import { User } from '@/entities/user.entity'
import { applyIdentityUser } from './identity-projection'
import { AppConfig } from '@/config/configuration'
import { JwtUtil } from '@/common/utils/jwt.util'
import { completeIdentity, cookieValue, flowCookie, identityDirectory, identityEnabled, startIdentity } from './identity-client'
import { desktopLoginUrl, unifiedIdentityEnabled } from './unified-client'

@Controller('api/auth/sso')
export class IdentityController {
  constructor(private readonly source: DataSource, @Inject('APP_CONFIG') private readonly config: AppConfig) {}
  @Get('status') status() { return { enabled: identityEnabled(), mode: unifiedIdentityEnabled() ? 'unified' : 'legacy',
    ...(unifiedIdentityEnabled() ? { loginUrl: desktopLoginUrl('token-one') } : {}) } }
  @Get('start')
  async start(@Query('redirect') redirect: string, @Res() res: Response) {
    if (unifiedIdentityEnabled()) return res.redirect(desktopLoginUrl('token-one', redirect || '/dashboard'))
    const result = await startIdentity(redirect); res.setHeader('Set-Cookie', result.cookie); res.redirect(result.url)
  }
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    if (unifiedIdentityEnabled()) return res.status(410).json({ message: '旧登录回调已停用，请从统一桌面重新登录' })
    res.setHeader('Set-Cookie', flowCookie('', 0)); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const { profile, returnTo } = await completeIdentity(req.originalUrl, cookieValue(req.headers.cookie))
      const user = await this.source.transaction(async manager => {
        const user = await applyIdentityUser(manager.getRepository(User), { subject: profile.sub, localUserId: profile.local_user_id,
          username: profile.preferred_username, name: profile.name || '', department: profile.department || null, active: true, securityVersion: 0 })
        if (!user) throw new Error('中心身份不可用')
        return user
      })
      const token = JwtUtil.sign({ sub: user.id, username: user.username, role: user.role,
        identitySubject: profile.sub, identitySession: profile.identity_session }, this.config.jwt.secret, this.config.jwt.expiresIn)
      // 片段不会被浏览器作为 HTTP 请求参数发送，也不进入访问日志。
      res.redirect(`${returnTo === '/admin/stats' ? '/admin' : '/login'}#sso_token=${encodeURIComponent(token)}`)
    } catch { res.redirect('/login?sso_error=1') }
  }
}

@Injectable()
export class IdentitySyncService implements OnModuleInit {
  private busy = false
  private readonly logger = new Logger(IdentitySyncService.name)
  constructor(private readonly source: DataSource) {}
  onModuleInit() { void this.sync() }
  @Cron('0 * * * * *')
  async sync() {
    if (!identityEnabled() || this.busy) return
    this.busy = true
    try {
      const profiles = await identityDirectory()
      const issuer = process.env.IDENTITY_ISSUER || 'https://identity.meta-gravity.com'
      await this.source.transaction(async manager => {
        const repo=manager.getRepository(User)
        for (const p of profiles) await applyIdentityUser(repo,p)
        const present=new Set(profiles.map(p=>p.subject))
        for (const old of await repo.find({where:{identityIssuer:issuer}})) {
          if(old.identitySubject&&!present.has(old.identitySubject)) await repo.update({id:old.id},{identityEnabled:false,status:0})
        }
      })
    } catch { this.logger.error('统一身份资料同步失败，将在下一轮重试') }
    finally { this.busy = false }
  }
}
