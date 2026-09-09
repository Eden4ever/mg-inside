import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Token } from '@/entities/token.entity'
import { User } from '@/entities/user.entity'
import { CryptoUtil } from '@/common/utils/crypto.util'

export interface GatewayTokenInfo {
  tokenId: number
  userId: number
  groupTag: string | null
  userDepartment: string | null
  quotaTotal: number
  quotaUsed: number
  status: number
  expiresAt: number | null
  username: string
  userRole: string
  userStatus: number
  userQuotaTotal: number
  userQuotaUsed: number
  /** 用户所属分组名（一对多）*/
  userGroups: string[]
}

interface CacheEntry {
  info: GatewayTokenInfo
  expireAt: number
}

@Injectable()
export class TokenAuthMiddleware implements NestMiddleware {
  private cache = new Map<string, CacheEntry>()
  private readonly cacheTtl = 60 * 1000

  constructor(
    @InjectRepository(Token) private readonly tokenRepo: Repository<Token>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const auth = (req.headers['authorization'] as string) || ''
    const bearer = auth.match(/^Bearer\s+(sk-[A-Za-z0-9_-]+)$/i)?.[1] || null
    const apiKeyHeader = req.headers['x-api-key']
    const firstApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader
    const anthropicKey =
      typeof firstApiKey === 'string' && /^sk-[A-Za-z0-9_-]+$/.test(firstApiKey)
        ? firstApiKey
        : null
    if (bearer && anthropicKey && bearer !== anthropicKey) {
      throw new UnauthorizedException('Authorization 与 x-api-key 不一致')
    }
    const raw = bearer || anthropicKey
    if (!raw) {
      throw new UnauthorizedException(
        '缺少或无效的 API 鉴权（应为 Bearer sk-... 或 x-api-key: sk-...）',
      )
    }
    const keyHash = CryptoUtil.sha256(raw.slice(3)) // 去掉 sk- 前缀

    let info = this.getCache(keyHash)
    if (!info) {
      const token = await this.tokenRepo.findOne({ where: { keyHash } })
      if (!token) throw new UnauthorizedException('令牌不存在')
      const user = await this.userRepo.findOne({ where: { id: token.userId } })
      if (!user) throw new UnauthorizedException('用户不存在')
      if (user.identityEnabled === false) throw new UnauthorizedException('统一身份已停用')
      info = {
        tokenId: token.id,
        userId: user.id,
        groupTag: token.groupTag,
        userDepartment: user.department || null,
        quotaTotal: token.quotaTotal,
        quotaUsed: token.quotaUsed,
        status: token.status,
        expiresAt: token.expiresAt,
        username: user.username,
        userRole: user.role,
        userStatus: user.status,
        userQuotaTotal: user.quotaTotal,
        userQuotaUsed: user.quotaUsed,
        userGroups:
          Array.isArray(user.groupNames) && user.groupNames.length
            ? user.groupNames
            : ['default'],
      }
      this.cache.set(keyHash, { info, expireAt: Date.now() + this.cacheTtl })
    }

    const now = Date.now()
    if (info.status !== 1) throw new UnauthorizedException('令牌已禁用')
    if (info.userStatus !== 1) throw new UnauthorizedException('用户已禁用')
    if (info.expiresAt && info.expiresAt < now)
      throw new UnauthorizedException('令牌已过期')

    ;(req as any).gatewayToken = info
    next()
  }

  private getCache(keyHash: string): GatewayTokenInfo | null {
    const e = this.cache.get(keyHash)
    if (e && e.expireAt > Date.now()) return e.info
    if (e) this.cache.delete(keyHash)
    return null
  }
}
