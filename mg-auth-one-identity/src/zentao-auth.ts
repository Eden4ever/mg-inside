import { ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthService, Actor, requireRole } from './auth';

@Injectable()
export class ZentaoAuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuthService) private readonly auth: AuthService) {}
  status() { return { enabled: process.env.ZENTAO_ENABLED === 'true' && Boolean(process.env.ZENTAO_BASE_URL) }; }
  private server() {
    if (!this.status().enabled) throw new ConflictException('禅道登录尚未配置');
    const url = new URL(process.env.ZENTAO_BASE_URL!);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new ConflictException('禅道认证地址必须为 HTTPS');
    return url.href.replace(/\/$/, '');
  }
  private async request(url: string, options: RequestInit) {
    try {
      const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (response.status >= 500) throw new Error();
      if (!response.ok) throw new UnauthorizedException('禅道账号或密码错误');
      return await response.json() as Record<string, any>;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException('禅道认证暂不可用，请稍后重试');
    }
  }
  async login(accountInput: string, password: string, context: { userAgent?: string; ipAddress?: string }) {
    if (typeof accountInput !== 'string' || typeof password !== 'string' || !password || password.length > 128) throw new UnauthorizedException('禅道账号或密码错误');
    const account = accountInput.trim();
    if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(account)) throw new UnauthorizedException('禅道账号或密码错误');
    const server = this.server();
    const binding = await this.prisma.zentaoIdentity.findUnique({ where: { server_account: { server, account } }, include: { user: true } });
    if (!binding || binding.user.status !== 'active') throw new UnauthorizedException('禅道账号未关联或不可用，请联系管理员');
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${binding.userId} FOR UPDATE NOWAIT`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: binding.userId } });
      if (user.status !== 'active' || (user.lockedUntil && user.lockedUntil > new Date())) return null;
      let valid = false;
      try {
        const tokens = await this.request(`${server}/api.php/v1/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password }) });
        if (typeof tokens.token === 'string' && tokens.token) {
          const profile = await this.request(`${server}/api.php/v1/user`, { headers: { Token: tokens.token } });
          valid = profile.profile?.account === account;
        }
      } catch (error) { if (!(error instanceof UnauthorizedException)) throw error; }
      if (!valid) {
        const failedLoginCount = (user.lockedUntil && user.lockedUntil <= new Date() ? 0 : user.failedLoginCount) + 1;
        await tx.user.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil: failedLoginCount >= 5 ? new Date(Date.now() + 900000) : null } });
        return null;
      }
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      // 只认已审核的稳定绑定；不按姓名认领、不建号、不从禅道提升角色。
      return this.auth.beginAuthentication(user, context, 'zentao', tx);
    }, { timeout: 22000 }).catch(error => {
      if (error?.code === 'P2010' && error.meta?.code === '55P03') throw new UnauthorizedException('账号正在验证，请稍后重试');
      throw error;
    });
    if (!result) throw new UnauthorizedException('禅道账号或密码错误，或暂时锁定');
    return result;
  }
  async bind(userId: string, accountInput: string, actor: Actor) {
    requireRole(actor, ['system_admin']); const server = this.server();
    if (typeof accountInput !== 'string' || !/^[A-Za-z0-9_.@-]{1,128}$/.test(accountInput.trim())) throw new ConflictException('禅道账号无效');
    const account = accountInput.trim();
    return this.prisma.$transaction(async tx => {
      const existing = await tx.zentaoIdentity.findUnique({ where: { userId_server: { userId, server } } });
      if (existing && existing.account !== account) throw new ForbiddenException('禁止覆盖既有禅道身份，请核实后单独迁移');
      const result = await tx.zentaoIdentity.upsert({ where: { userId_server: { userId, server } }, create: { userId, server, account }, update: {} });
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action: 'identity.zentao_bound', targetType: 'User', targetId: userId, detail: { server, account } } });
      return { userId: result.userId, account: result.account };
    }).catch(error => { if (error?.code === 'P2002') throw new ConflictException('禅道账号已关联其他身份'); throw error; });
  }
}
