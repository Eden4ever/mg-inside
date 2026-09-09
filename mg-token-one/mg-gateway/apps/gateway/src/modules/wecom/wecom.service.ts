import { Injectable, Inject, UnauthorizedException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import axios from 'axios'
import { WecomConfig } from '@/entities/wecom-config.entity'
import { AppConfig } from '@/config/configuration'

const QYAPI = 'https://qyapi.weixin.qq.com/cgi-bin'

interface AccessTokenCache {
  token: string
  expireAt: number
}

@Injectable()
export class WecomService {
  private tokenCache: AccessTokenCache | null = null
  private cfgCache: { cfg: WecomConfig; expireAt: number } | null = null
  private readonly cfgCacheTtl = 5 * 60 * 1000

  constructor(
    @InjectRepository(WecomConfig)
    private readonly cfgRepo: Repository<WecomConfig>,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}

  /** 读取配置：优先 DB，回退 env，再回退空（未配置）*/
  async getConfig(): Promise<WecomConfig | null> {
    if (this.cfgCache && this.cfgCache.expireAt > Date.now()) {
      return this.cfgCache.cfg
    }
    let cfg = await this.cfgRepo.findOne({ where: { id: 1 } })
    if (!cfg) {
      const env = process.env
      if (env.WECOM_CORPID && env.WECOM_SECRET) {
        cfg = this.cfgRepo.create({
          id: 1,
          corpid: env.WECOM_CORPID,
          agentid: env.WECOM_AGENTID || '',
          secret: env.WECOM_SECRET,
          token: env.WECOM_TOKEN || '',
          encodingAESKey: env.WECOM_ENCODING_AES_KEY || '',
          callbackPath: env.WECOM_CALLBACK_PATH || '/api/auth/wecom/callback',
          adminUserIds: env.WECOM_ADMIN_USERIDS || '',
          adminDeptIds: env.WECOM_ADMIN_DEPTIDS || '',
          defaultQuota: parseInt(env.WECOM_DEFAULT_QUOTA || '0', 10),
          enabled: 1,
        })
      }
    }
    if (cfg) this.cfgCache = { cfg, expireAt: Date.now() + this.cfgCacheTtl }
    return cfg || null
  }

  async saveConfig(partial: Partial<WecomConfig>): Promise<WecomConfig> {
    let cfg = await this.cfgRepo.findOne({ where: { id: 1 } })
    if (!cfg) cfg = this.cfgRepo.create({ id: 1 })
    Object.assign(cfg, partial, { id: 1 })
    cfg = await this.cfgRepo.save(cfg)
    this.cfgCache = { cfg, expireAt: Date.now() + this.cfgCacheTtl }
    this.tokenCache = null
    return cfg
  }

  /** 构造授权链接：mode=qr(PC 扫码) | h5(企微内静默) */
  async buildAuthorizeUrl(
    redirect: string,
    state: string,
    mode: 'qr' | 'h5' = 'qr',
  ): Promise<string> {
    const cfg = await this.getConfig()
    if (!cfg || !cfg.corpid || !cfg.agentid || !cfg.secret) {
      throw new UnauthorizedException('企业微信未配置')
    }
    const callback = `${this.config.gatewayPublicUrl}${cfg.callbackPath}`
    const ru = encodeURIComponent(callback)
    if (mode === 'h5') {
      // 企业微信内网页授权（静默）
      return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${cfg.corpid}&redirect_uri=${ru}&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}#wechat_redirect`
    }
    // PC 扫码登录
    return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?corpid=${cfg.corpid}&agentid=${cfg.agentid}&redirect_uri=${ru}&state=${encodeURIComponent(state)}`
  }

  private async getAccessToken(cfg: WecomConfig): Promise<string> {
    if (this.tokenCache && this.tokenCache.expireAt > Date.now()) {
      return this.tokenCache.token
    }
    const { data } = await axios.get(`${QYAPI}/gettoken`, {
      params: { corpid: cfg.corpid, corpsecret: cfg.secret },
      timeout: 8000,
    })
    if (data.errcode !== 0) {
      throw new UnauthorizedException(`获取 access_token 失败: ${data.errmsg}`)
    }
    this.tokenCache = {
      token: data.access_token,
      expireAt: Date.now() + (data.expires_in - 300) * 1000,
    }
    return data.access_token
  }

  /** code → UserId */
  async getUserIdByCode(code: string): Promise<string> {
    const cfg = await this.getConfig()
    if (!cfg) throw new UnauthorizedException('企业微信未配置')
    const token = await this.getAccessToken(cfg)
    const { data } = await axios.get(`${QYAPI}/user/getuserinfo`, {
      params: { access_token: token, code },
      timeout: 8000,
    })
    if (data.errcode !== 0 || !data.UserId) {
      throw new UnauthorizedException(`换取身份失败: ${data.errmsg}`)
    }
    return data.UserId
  }

  /** UserId → 详情 */
  async getUserDetail(userid: string) {
    const cfg = await this.getConfig()
    if (!cfg) throw new UnauthorizedException('企业微信未配置')
    const token = await this.getAccessToken(cfg)
    const { data } = await axios.get(`${QYAPI}/user/get`, {
      params: { access_token: token, userid },
      timeout: 8000,
    })
    if (data.errcode !== 0) {
      throw new UnauthorizedException(`获取成员详情失败: ${data.errmsg}`)
    }
    return data // {userid, name, department:[id...], avatar, email, ...}
  }

  /** 校验 userid 是否为管理员白名单（只升不降）*/
  async resolveRole(detail: any): Promise<'admin' | 'user'> {
    const cfg = await this.getConfig()
    if (!cfg) return 'user'
    const userIds = (cfg.adminUserIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const deptIds = (cfg.adminDeptIds || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n))
    if (userIds.includes(detail.userid)) return 'admin'
    const depts: number[] = detail.department || []
    if (depts.some((d) => deptIds.includes(d))) return 'admin'
    return 'user'
  }
}
