import { ConflictException, ForbiddenException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@prisma/client';
import { AuthService, type Actor, cookieValue, sha256 } from './auth';
import { weComAvatar } from './profile-avatar';
import { PrismaService } from './prisma.service';

export const WECOM_STATE_COOKIE = 'mg_identity_wecom_state';

interface WeComConfig {
  corpId: string;
  agentId: string;
  secret: string;
  redirectUri: string;
}

interface WeComDepartment {
  id: number;
  name: string;
}

interface WeComMember {
  userid: string;
  name: string;
  department?: number[];
  avatar?: unknown;
  thumb_avatar?: unknown;
}

export interface WeComSyncResult {
  total: number;
  created: number;
  updated: number;
  bound: number;
  unchanged: number;
  conflicts: number;
  completedAt: string;
}

@Injectable()
export class WeComAuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeComAuthService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private syncTask: Promise<WeComSyncResult> | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private initialSyncTimer: NodeJS.Timeout | null = null;
  private lastSyncResult: WeComSyncResult | null = null;
  private lastSyncError: string | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService) {}

  onModuleInit() {
    if (!this.directorySyncEnabled()) return;
    this.initialSyncTimer = setTimeout(() => void this.runScheduledSync(), 5_000);
    this.syncTimer = setInterval(() => void this.runScheduledSync(), this.directorySyncIntervalMinutes() * 60_000);
    this.initialSyncTimer.unref();
    this.syncTimer.unref();
  }

  onModuleDestroy() {
    if (this.initialSyncTimer) clearTimeout(this.initialSyncTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

  status() {
    const configured = Boolean(this.config(false));
    return { enabled: configured, provider: 'wecom', mode: 'CorpApp', message: configured ? '企业微信扫码登录已启用' : '企业微信扫码登录尚未配置' };
  }

  directorySyncStatus() {
    return {
      enabled: this.directorySyncEnabled(),
      running: this.syncTask !== null,
      intervalMinutes: this.directorySyncIntervalMinutes(),
      lastResult: this.lastSyncResult,
      lastError: this.lastSyncError,
    };
  }

  syncDirectory(actor?: Actor): Promise<WeComSyncResult> {
    if (this.syncTask) return this.syncTask;
    this.syncTask = this.performDirectorySync(actor)
      .then((result) => {
        this.lastSyncResult = result;
        this.lastSyncError = null;
        return result;
      })
      .catch((error: unknown) => {
        this.lastSyncError = error instanceof Error ? error.message : '企业微信通讯录同步失败';
        throw error;
      })
      .finally(() => {
        this.syncTask = null;
      });
    return this.syncTask;
  }

  async start(returnToInput?: string) {
    const config = this.config(true)!;
    const state = randomBytes(24).toString('base64url');
    const browserNonce = randomBytes(24).toString('base64url');
    const returnTo = this.safeReturnTo(returnToInput);
    await this.prisma.weComLoginState.create({
      data: { stateHash: sha256(state), browserNonceHash: sha256(browserNonce), returnTo, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    const params = new URLSearchParams({
      login_type: 'CorpApp',
      appid: config.corpId,
      agentid: config.agentId,
      redirect_uri: config.redirectUri,
      state,
      lang: 'zh',
    });
    return { loginUrl: `https://login.work.weixin.qq.com/wwlogin/sso/login?${params.toString()}`, browserNonce };
  }

  async complete(code: string, state: string, cookieHeader: unknown, context: { userAgent?: string; ipAddress?: string }) {
    const config = this.config(true)!;
    const browserNonce = cookieValue(cookieHeader, WECOM_STATE_COOKIE);
    if (!code || !state || !browserNonce) throw new UnauthorizedException('企业微信登录请求已失效，请重新扫码。');
    const loginState = await this.prisma.weComLoginState.findUnique({ where: { stateHash: sha256(state) } });
    const nonceHash = sha256(browserNonce);
    const nonceMatches = loginState ? timingSafeEqual(Buffer.from(loginState.browserNonceHash), Buffer.from(nonceHash)) : false;
    if (!loginState || loginState.usedAt || loginState.expiresAt <= new Date() || !nonceMatches) {
      throw new UnauthorizedException('企业微信登录请求已失效，请重新扫码。');
    }
    const claimed = await this.prisma.weComLoginState.updateMany({ where: { id: loginState.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new UnauthorizedException('企业微信登录请求已失效，请重新扫码。');
    const externalUserId = await this.exchangeIdentity(config, code);
    // 仅请求当前已绑定且启用的成员；网络请求不占用数据库授权锁。
    const bound = await this.prisma.weComIdentity.findUnique({ where: { corpId_externalUserId: { corpId: config.corpId, externalUserId } }, include: { user: true } });
    const revoked = await this.prisma.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: { corpId: config.corpId, externalUserId } } });
    if (!bound || bound.user.status !== 'active' || revoked) throw new ForbiddenException('当前企业微信账号未获系统访问授权。');
    const avatarUrl = await this.readMemberAvatar(config, externalUserId);
    return this.prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(741027)::text`;
    if (await transaction.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: { corpId: config.corpId, externalUserId } } })) throw new ForbiddenException('当前企业微信账号未获系统访问授权。');
    const identity = await transaction.weComIdentity.findUnique({
      where: { corpId_externalUserId: { corpId: config.corpId, externalUserId } },
      include: { user: true },
    });
    if (!identity || identity.user.status !== 'active') throw new ForbiddenException('当前企业微信账号未获系统访问授权。');
    await transaction.weComIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: new Date() } });
    const user = avatarUrl !== undefined && avatarUrl !== identity.user.avatarUrl
      ? await transaction.user.update({ where: { id: identity.userId }, data: { avatarUrl } }) : identity.user;
    const session = await this.auth.beginAuthentication(user as User, context, 'wecom', transaction);
    return { ...session, returnTo: loginState.returnTo };
    });
  }

  private config(required: boolean): WeComConfig | null {
    const values = {
      corpId: process.env.WECOM_CORP_ID?.trim() ?? '',
      agentId: process.env.WECOM_AGENT_ID?.trim() ?? '',
      secret: process.env.WECOM_APP_SECRET?.trim() ?? '',
      redirectUri: process.env.WECOM_REDIRECT_URI?.trim() ?? '',
    };
    const enabled = process.env.WECOM_LOGIN_ENABLED === 'true';
    if (enabled && Object.values(values).every(Boolean)) return values;
    if (required) throw new ConflictException('企业微信扫码登录尚未配置，请联系平台管理员。');
    return null;
  }

  private safeReturnTo(value?: string): string {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
    if (value.includes('\\') || /[\x00-\x20]/.test(value)) return '/';
    return value.slice(0, 500);
  }

  private async performDirectorySync(actor?: Actor): Promise<WeComSyncResult> {
    const config = this.config(true)!;
    const token = await this.accessToken(config);
    const departmentsResponse = await this.getJson(`https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(token)}&id=1`);
    const membersResponse = await this.getJson(`https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${encodeURIComponent(token)}&department_id=1&fetch_child=1`);
    this.assertWeComSuccess(departmentsResponse, '读取企业微信部门失败');
    this.assertWeComSuccess(membersResponse, '读取企业微信成员失败');
    const departments = Array.isArray(departmentsResponse.department) ? departmentsResponse.department as unknown as WeComDepartment[] : [];
    const members = Array.isArray(membersResponse.userlist) ? membersResponse.userlist as unknown as WeComMember[] : [];
    const departmentNames = new Map(departments.map((item) => [Number(item.id), String(item.name || '').trim()]));

    const counts = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(741027)::text`;
      const result = { created: 0, updated: 0, bound: 0, unchanged: 0, conflicts: 0 };
      for (const member of members) {
        const externalUserId = String(member.userid || '').trim();
        if (!externalUserId || externalUserId.length > 128) {
          result.conflicts += 1;
          continue;
        }
        const displayName = String(member.name || '').trim() || externalUserId;
        const departmentName = [...new Set((member.department || []).map((id) => departmentNames.get(Number(id))).filter((name): name is string => Boolean(name)))].join('、') || null;
        const identityKey = { corpId: config.corpId, externalUserId };
        if (await transaction.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: identityKey } })) {
          result.conflicts += 1;
          continue;
        }
        const identity = await transaction.weComIdentity.findUnique({ where: { corpId_externalUserId: identityKey }, include: { user: true } });
        if (identity) {
          const avatarUrl = weComAvatar(member);
          const changed = avatarUrl !== undefined && avatarUrl !== identity.user.avatarUrl || identity.user.displayName !== displayName || identity.user.departmentName !== departmentName;
          if (changed) {
            await transaction.user.update({ where: { id: identity.userId }, data: { displayName, departmentName, ...(avatarUrl === undefined ? {} : { avatarUrl }) } });
            result.updated += 1;
          } else {
            result.unchanged += 1;
          }
          continue;
        }

        result.conflicts += 1;
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: actor?.userId ?? null,
          actorName: actor?.name ?? '企业微信自动同步',
          actorRole: actor?.role ?? 'system',
          action: 'user.wecom_directory_synced',
          targetType: 'WeComDirectory',
          targetId: config.corpId,
          detail: { total: members.length, ...result },
        },
      });
      return result;
    });

    return { total: members.length, ...counts, completedAt: new Date().toISOString() };
  }

  private async runScheduledSync() {
    try {
      const result = await this.syncDirectory();
      this.logger.log(`企业微信通讯录同步完成：读取 ${result.total}，新增 ${result.created}，更新 ${result.updated}，绑定 ${result.bound}`);
    } catch (error) {
      this.logger.warn(`企业微信通讯录自动同步失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private directorySyncEnabled(): boolean {
    return process.env.WECOM_DIRECTORY_SYNC_ENABLED === 'true';
  }

  private directorySyncIntervalMinutes(): number {
    const value = Number(process.env.WECOM_DIRECTORY_SYNC_INTERVAL_MINUTES ?? 60);
    return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 15), 1440) : 60;
  }

  private assertWeComSuccess(response: Record<string, unknown>, message: string) {
    if (response.errcode !== 0) throw new ServiceUnavailableException(`${message}（${String(response.errmsg || response.errcode || '未知错误')}）`);
  }

  private async exchangeIdentity(config: WeComConfig, code: string): Promise<string> {
    let token = await this.accessToken(config);
    let response = await this.getJson(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`);
    if (response.errcode === 40014 || response.errcode === 42001) {
      token = await this.accessToken(config, true);
      response = await this.getJson(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`);
    }
    if (response.errcode !== 0 || typeof response.userid !== 'string' || !response.userid) {
      throw new ForbiddenException('当前企业微信账号未获系统访问授权。');
    }
    return response.userid;
  }

  private async readMemberAvatar(config: WeComConfig, externalUserId: string): Promise<string | null | undefined> {
    try {
      const token = await this.accessToken(config);
      const response = await this.getJson(`https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(externalUserId)}`);
      if (response.errcode !== 0) return undefined;
      return weComAvatar(response);
    } catch {
      // 可选资料失败不影响登录，也不记录上游地址、令牌或成员个人信息。
      this.logger.warn('企业微信头像暂未更新，继续使用已保存头像。');
      return undefined;
    }
  }

  private async accessToken(config: WeComConfig, forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) return this.cachedToken.value;
    const response = await this.getJson(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`);
    if (response.errcode !== 0 || typeof response.access_token !== 'string') throw new ServiceUnavailableException('企业微信服务暂不可用，请稍后重试。');
    const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : 7200;
    this.cachedToken = { value: response.access_token, expiresAt: Date.now() + Math.max(expiresIn - 300, 60) * 1000 };
    return response.access_token;
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new ServiceUnavailableException('企业微信服务暂不可用，请稍后重试。');
    }
    if (!response.ok) throw new ServiceUnavailableException('企业微信服务暂不可用，请稍后重试。');
    return response.json() as Promise<Record<string, unknown>>;
  }
}
