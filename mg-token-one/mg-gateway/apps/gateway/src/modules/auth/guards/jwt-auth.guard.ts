import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common'
import { Request } from 'express'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { JwtUtil } from '@/common/utils/jwt.util'
import { User } from '@/entities/user.entity'
import { AppConfig } from '@/config/configuration'
import { identitySessionActive } from '../identity-client'
import { bearerToken, unifiedIdentity, unifiedIdentityEnabled, UnifiedAuthError } from '../unified-client'
import { applyIdentityUser } from '../identity-projection'
import { applicationAudience } from '../application-audience'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    if (unifiedIdentityEnabled()) {
      try {
        // Express 的 matched route 已完成路由匹配；不使用客户端提供的 audience/header。
        const audience = applicationAudience(typeof req.route?.path === 'string' ? req.route.path : req.path || req.url || '/')
        const profile = await unifiedIdentity.introspect(bearerToken(req.headers.authorization), audience)
        const user = await this.userRepo.manager.transaction(manager => applyIdentityUser(manager.getRepository(User), {
          subject: profile.sub, localUserId: profile.localUserId, username: profile.username,
          name: profile.name, department: profile.department, active: true, securityVersion: profile.securityVersion,
        }))
        if (!user || user.status !== 1) throw new UnauthorizedException('账号不可用')
        ;(req as any).user = { sub: user.id, role: user.role, username: user.username,
          identitySubject: profile.sub, identitySession: profile.sid, applicationId: audience }
        return true
      } catch (error) {
        if (error instanceof UnifiedAuthError && error.status === 503) throw new ServiceUnavailableException(error.message)
        throw new UnauthorizedException('统一登录无效或身份映射冲突')
      }
    }
    const auth = (req.headers['authorization'] as string) || ''
    const m = auth.match(/^Bearer\s+(.+)$/)
    if (!m) throw new UnauthorizedException('未登录')
    let payload: any
    try {
      payload = JwtUtil.verify(m[1], this.config.jwt.secret)
    } catch {
      throw new UnauthorizedException('登录态已失效')
    }
    const user = await this.userRepo.findOne({ where: { id: payload.sub } })
    if (!user || user.status !== 1 || user.identityEnabled === false) throw new UnauthorizedException('账号无效')
    if (process.env.IDENTITY_ENABLED === 'true' && !payload.identitySession)
      throw new UnauthorizedException('请重新进入统一身份登录')
    if (payload.identitySession) {
      try {
        if (user.identitySubject !== payload.identitySubject || !(await identitySessionActive(payload.identitySubject, payload.identitySession)))
          throw new Error('中心会话失效')
      } catch { throw new UnauthorizedException('统一登录已失效，请重新登录') }
    }
    ;(req as any).user = {
      sub: user.id,
      role: user.role,
      username: user.username,
      ...(payload.identitySession ? { identitySubject: payload.identitySubject, identitySession: payload.identitySession } : {}),
    }
    return true
  }
}
