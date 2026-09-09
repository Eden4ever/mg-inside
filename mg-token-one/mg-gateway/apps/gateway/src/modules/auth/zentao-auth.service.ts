import { Injectable, Logger, Inject } from '@nestjs/common'
import axios from 'axios'
import { AppConfig } from '@/config/configuration'

export interface ZentaoProfile {
  account: string
  realname: string
  role: string // 禅道角色码，如 dev/qa/po/admin
  email?: string
  dept?: number
}

/**
 * 通过禅道 REST API 校验账号密码。
 * 禅道 22.x 自带 OpenAPI：
 *   POST {base}/api.php/v1/tokens  {account,password} -> {token}
 *   GET  {base}/api.php/v1/user    (Header: Token)     -> {profile:{...}}
 * 登录成功即代表账号密码正确，无需触碰禅道数据库。
 */
@Injectable()
export class ZentaoAuthService {
  private readonly logger = new Logger(ZentaoAuthService.name)

  constructor(@Inject('APP_CONFIG') private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.zentao.enabled && !!this.config.zentao.baseUrl
  }

  /**
   * 校验并返回禅道用户档案；账号或密码错误返回 null；禅道不可达抛错。
   */
  async authenticate(account: string, password: string): Promise<ZentaoProfile | null> {
    const base = this.config.zentao.baseUrl
    const timeout = this.config.zentao.timeoutMs
    let token: string
    try {
      const r = await axios.post(
        `${base}/api.php/v1/tokens`,
        { account, password },
        { timeout, validateStatus: () => true },
      )
      token = r?.data?.token
      if (!token) return null // 账号或密码错误
    } catch (e: any) {
      this.logger.error(`禅道登录请求失败: ${e?.message}`)
      throw new Error('ZENTAO_UNREACHABLE')
    }

    try {
      const r = await axios.get(`${base}/api.php/v1/user`, {
        headers: { Token: token },
        timeout,
        validateStatus: () => true,
      })
      const p = r?.data?.profile
      const roleCode = typeof p?.role === 'object' ? p.role?.code : p?.role
      return {
        account: p?.account || account,
        realname: p?.realname || account,
        role: roleCode || 'user',
        email: p?.email || undefined,
        dept: typeof p?.dept === 'number' ? p.dept : undefined,
      }
    } catch (e: any) {
      this.logger.warn(`拉取禅道用户信息失败，使用账号名兜底: ${e?.message}`)
      return { account, realname: account, role: 'user' }
    }
  }

  /** 禅道角色是否映射为网关 admin */
  isAdminRole(zentaoRole: string): boolean {
    return this.config.zentao.adminRoles.includes(zentaoRole)
  }
}
