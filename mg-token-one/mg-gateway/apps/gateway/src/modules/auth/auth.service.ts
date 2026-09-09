import { Injectable, UnauthorizedException, Inject, ServiceUnavailableException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { User } from '@/entities/user.entity'
import { JwtUtil, JwtPayload } from '@/common/utils/jwt.util'
import { AppConfig } from '@/config/configuration'
import { ZentaoAuthService } from './zentao-auth.service'

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
    private readonly zentao: ZentaoAuthService,
  ) {}

  /**
   * 统一登录：
   * 1) 若是本地账号（syncSource='local'，含应急 admin），走本地 bcrypt 校验——保证禅道宕机时仍可登录后台。
   * 2) 否则走禅道 REST API 校验（JIT 建档/同步），网关不存禅道用户密码。
   */
  async validateUser(username: string, password: string): Promise<User> {
    const existing = await this.userRepo.findOne({ where: { username } })
    if (process.env.IDENTITY_ENABLED === 'true')
      throw new UnauthorizedException('请使用统一身份登录；账号密码、禅道和企业微信均在认证中心验证')

    // 本地账号（local）直接本地校验，作为禅道不可用时的兜底
    if (existing && existing.syncSource === 'local') {
      if (existing.status !== 1) throw new UnauthorizedException('账号已禁用')
      if (!existing.passwordHash) throw new UnauthorizedException('用户名或密码错误')
      const ok = await bcrypt.compare(password, existing.passwordHash)
      if (!ok) throw new UnauthorizedException('用户名或密码错误')
      return existing
    }

    // 禅道登录
    if (!this.zentao.enabled) {
      throw new UnauthorizedException('用户名或密码错误')
    }
    let profile
    try {
      profile = await this.zentao.authenticate(username, password)
    } catch (e: any) {
      if (e?.message === 'ZENTAO_UNREACHABLE') {
        throw new ServiceUnavailableException('认证服务（禅道）暂时不可用，请稍后重试')
      }
      throw e
    }
    if (!profile) throw new UnauthorizedException('用户名或密码错误')

    // JIT 建档/同步为网关本地用户
    const role = this.zentao.isAdminRole(profile.role) ? 'admin' : 'user'
    const user = await this.upsertByZentao(username, profile, role)
    if (user.status !== 1) throw new UnauthorizedException('账号已禁用')
    return user
  }

  /** 根据禅道账号 JIT 建档/同步（不存密码；role 仅提升不降级）*/
  async upsertByZentao(
    username: string,
    profile: { realname?: string; role?: string; email?: string },
    role: 'admin' | 'user',
  ): Promise<User> {
    let user = await this.userRepo.findOne({ where: { username } })
    if (!user) {
      const created = this.userRepo.create({
        username,
        displayName: profile.realname || username,
        passwordHash: null, // 密码由禅道托管
        syncSource: 'zentao',
        role,
        status: 1,
        quotaTotal: 0,
        groupNames: ['default'],
      } as any)
      return (await this.userRepo.save(created)) as unknown as User
    }
    // 同步展示名；角色仅提升不降级
    if (profile.realname && !user.displayName) user.displayName = profile.realname
    if (user.syncSource !== 'local') user.syncSource = 'zentao'
    if (role === 'admin' && user.role !== 'admin') user.role = 'admin'
    return this.userRepo.save(user)
  }

  login(user: User): { token: string; user: JwtPayload } {
    if (process.env.IDENTITY_ENABLED === 'true') throw new UnauthorizedException('内部应用登录令牌由统一认证签发')
    if (user.status !== 1 || user.identityEnabled === false) throw new UnauthorizedException('账号已停用')
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      username: user.username,
    }
    return { token: JwtUtil.sign(payload, this.config.jwt.secret, this.config.jwt.expiresIn), user: payload }
  }

  async me(userId: number): Promise<User> {
    return this.userRepo.findOne({ where: { id: userId } })
  }

  /** 根据企微 userid 查找/创建本地用户（同步或登录时调用）。role 仅用于提升，不降级本地 admin */
  async upsertByWeCom(input: {
    wecomUserId: string
    displayName?: string
    department?: string
    wecomDeptIds?: number[]
    avatarUrl?: string
    openUserid?: string
    role?: 'admin' | 'user'
  }): Promise<User> {
    let user = await this.userRepo.findOne({
      where: { wecomUserId: input.wecomUserId },
    })
    if (!user) {
      user = this.userRepo.create({
        username: `wecom_${input.wecomUserId}`,
        displayName: input.displayName || input.wecomUserId,
        syncSource: 'wecom',
        wecomUserId: input.wecomUserId,
        department: input.department,
        wecomDeptIds: input.wecomDeptIds,
        avatarUrl: input.avatarUrl,
        openUserid: input.openUserid,
        role: input.role === 'admin' ? 'admin' : 'user',
        status: 1,
        quotaTotal: 0,
      })
      user = await this.userRepo.save(user)
    } else {
      // 更新组织信息（不覆盖本地手动改的 displayName 若为空则补）
      user.department = input.department ?? user.department
      user.wecomDeptIds = input.wecomDeptIds ?? user.wecomDeptIds
      user.avatarUrl = input.avatarUrl ?? user.avatarUrl
      user.openUserid = input.openUserid ?? user.openUserid
      if (!user.displayName) user.displayName = input.displayName
      // 仅提升，不降级
      if (input.role === 'admin' && user.role !== 'admin') {
        user.role = 'admin'
      }
      user = await this.userRepo.save(user)
    }
    return user
  }
}
