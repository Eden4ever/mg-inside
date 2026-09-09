import {
  Controller,
  Get,
  Post,
  Put,
  Query,
  Body,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common'
import { Response } from 'express'
import { WecomService } from './wecom.service'
import { WecomSyncService } from './wecom-sync.service'
import { AuthService } from '@/modules/auth/auth.service'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { WecomConfig } from '@/entities/wecom-config.entity'

@Controller()
export class WecomController {
  constructor(
    private readonly wecom: WecomService,
    private readonly sync: WecomSyncService,
    private readonly auth: AuthService,
  ) {}

  /** 登录入口：跳转企业微信授权页 */
  @Get('api/auth/wecom/login')
  async login(
    @Query('redirect') redirect: string,
    @Query('mode') mode: 'qr' | 'h5',
    @Res() res: Response,
  ) {
    if (process.env.IDENTITY_ENABLED === 'true') return res.redirect('/api/auth/sso/start')
    const state = Buffer.from(redirect || '/').toString('base64url')
    const url = await this.wecom.buildAuthorizeUrl(redirect || '/', state, mode)
    res.redirect(url)
  }

  /** 企业微信回调：code → 身份 → 建号 → 发 JWT → 前端 */
  @Get('api/auth/wecom/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (process.env.IDENTITY_ENABLED === 'true') return res.redirect('/api/auth/sso/start')
    if (!code) throw new UnauthorizedException('缺少 code')
    const redirect = state
      ? Buffer.from(state, 'base64url').toString('utf8')
      : '/'
    const userid = await this.wecom.getUserIdByCode(code)
    const detail = await this.wecom.getUserDetail(userid)
    const role = await this.wecom.resolveRole(detail)
    const user = await this.auth.upsertByWeCom({
      wecomUserId: detail.userid,
      displayName: detail.name,
      department: (detail.department && detail.department[0]) || undefined,
      wecomDeptIds: detail.department,
      avatarUrl: detail.avatar,
      openUserid: detail.open_userid,
      role,
    })
    const result = this.auth.login(user)
    const sep = redirect.includes('?') ? '&' : '?'
    res.redirect(`${redirect}${sep}token=${encodeURIComponent(result.token)}`)
  }

  /** 管理：读取企微配置 */
  @Get('api/wecom/config')
  @UseGuards(JwtAuthGuard, Roles('admin'))
  async getConfig() {
    const cfg = await this.wecom.getConfig()
    if (!cfg) return { enabled: 0 }
    const { secret, token, encodingAESKey, ...safe } = cfg
    return { ...safe, secretMasked: secret ? '******' : '', enabled: cfg.enabled }
  }

  /** 管理：保存企微配置 */
  @Put('api/wecom/config')
  @UseGuards(JwtAuthGuard, Roles('admin'))
  async saveConfig(@Body() body: Partial<WecomConfig>) {
    const cfg = await this.wecom.saveConfig(body)
    const { secret, token, encodingAESKey, ...safe } = cfg
    return { ...safe, enabled: cfg.enabled }
  }

  /** 管理：手动触发同步 */
  @Post('api/wecom/sync')
  @UseGuards(JwtAuthGuard, Roles('admin'))
  async triggerSync() {
    const r = await this.sync.syncAll()
    return { ok: true, ...r }
  }
}
