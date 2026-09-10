import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { createHash, randomBytes } from 'node:crypto';
import { profileAvatarUrl } from './profile-avatar';
import { PrismaService } from './prisma.service';
import { hashPassword, verifyPassword } from './password';
import { availableUsername, usernameBase } from './username-suggestion';
import { consumeTotp } from './totp';
import { EmailOtpService } from './email-otp';
import { SecurityKeyService } from './security-key';
import { LoginAttemptService } from './login-attempt';
import { applicationAccess, ensureIdentityAdministrator, lockAuthorization } from './application-access';
import { compatibilityRole, SCOPED_ADMIN_KEYS, roleSelection, userRoles, replaceUserRoles, validateRoleIds, type RoleSummary } from './platform-role';
type VerifiedSecond = 'totp' | 'email' | 'key' | 'recovery';

export { hashPassword } from './password';

export const ROLES = ['system_admin', 'member'] as const;
export type Role = (typeof ROLES)[number];
export interface Actor { userId: string; name: string; role: Role; }
export interface SessionUser extends Actor { username: string | null; departmentName: string | null; avatarUrl?: string | null; authSource: string; roles?: RoleSummary[]; identityAuthorized?: boolean; managementRole?: string; }
export interface AuthenticatedRequest { user?: SessionUser; authSession?: { id: string; csrfToken: string }; headers: Record<string, unknown>; method?: string; ip?: string; }

export const SESSION_COOKIE = 'mg_identity_session';
export const CHALLENGE_COOKIE = 'mg_identity_challenge';
export const CHALLENGE_BROWSER_COOKIE = 'mg_identity_challenge_browser';
export const PUBLIC_ROUTE = 'publicRoute';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const FOUNDATION_IDENTITY = 'foundationIdentity';
/** 只允许中心登录、自有账号安全及授权发现使用；不是管理权限旁路。 */
export const FoundationIdentity = () => SetMetadata(FOUNDATION_IDENTITY, true);

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function cookieValue(header: unknown, name: string): string | null {
  if (typeof header !== 'string') return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(pair.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function sessionUser(user: { id: string; username: string | null; displayName: string; departmentName: string | null; avatarUrl?: string | null; authSource: string }, roles: RoleSummary[]): SessionUser {
  return { userId: user.id, username: user.username, name: user.displayName, departmentName: user.departmentName, avatarUrl: profileAvatarUrl(user.avatarUrl), role: compatibilityRole(roles), managementRole: compatibilityRole(roles)==='system_admin'||roles.some(r=>SCOPED_ADMIN_KEYS.includes(r.key||''))?'identity-manager':'member', roles, authSource: user.authSource };
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(EmailOtpService) private readonly emailOtp: EmailOtpService,
    @Inject(SecurityKeyService) private readonly keys: SecurityKeyService, @Inject(LoginAttemptService) private readonly attempts: LoginAttemptService) {}

  async login(usernameInput: string, password: string, context: { userAgent?: string; ipAddress?: string }) {
    if (typeof usernameInput !== 'string' || typeof password !== 'string' || usernameInput.length > 50 || password.length > 128) throw new UnauthorizedException('账号或密码错误。');
    const username = normalizeUsername(usernameInput || '');
    if (!username || !password) throw new UnauthorizedException('账号或密码错误。');
    const result = await this.prisma.$transaction(async transaction => {
    // 锁定同一账户的整个验证过程；并发请求立即拒绝，不排队执行昂贵的密码验证。
    await transaction.$queryRaw`SELECT id FROM "User" WHERE username = ${username} FOR UPDATE NOWAIT`;
    const user = await transaction.user.findUnique({ where: { username } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) return { error: 'locked' as const, userId: user.id, displayName: user.displayName };
    const valid = Boolean(user?.passwordHash) && await verifyPassword(password, user!.passwordHash!);
    if (!user || !valid) {
      if (user) {
        const failures = (user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginCount) + 1;
        await transaction.user.update({ where: { id: user.id }, data: { failedLoginCount: failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
      }
      // 错误在事务提交之后抛出，保证失败计数不会被回滚。
      return { error: 'invalid' as const, userId: user?.id, displayName: user?.displayName };
    }
    if (user.status !== 'active') return { error: 'disabled' as const, userId: user.id, displayName: user.displayName };
    await transaction.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    return { session: await this.beginAuthentication(user, context, 'local', transaction) };
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '55P03') return { error: 'locked' as const, userId: undefined, displayName: undefined };
      throw error;
    });
    if ('session' in result && result.session) return result.session;
    // 失败计数已在事务中提交，这里补写流水；写在事务内会随回滚一起丢失。
    const reason = result.error === 'locked' ? 'locked' as const : result.error === 'disabled' ? 'disabled' as const : 'invalid_credentials' as const;
    await this.attempts.record({ username, userId: result.userId ?? null, displayName: result.displayName ?? null,
      result: 'failure', reason, source: 'local', context });
    if (result.error === 'locked') throw new HttpException('登录请求过于频繁，请稍后再试。', HttpStatus.TOO_MANY_REQUESTS);
    if (result.error === 'disabled') throw new ForbiddenException('账号已停用，请联系平台管理员。');
    throw new UnauthorizedException('账号或密码错误。');
  }

  async beginAuthentication(user: User, context: { userAgent?: string; ipAddress?: string }, source: 'local' | 'wecom' | 'zentao', transaction: Prisma.TransactionClient, secondMethod?: VerifiedSecond) {
    await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
    if (current.status !== 'active') throw new ForbiddenException('账号已停用。');
    if ((current.mfaEnabled && !secondMethod) || !current.username || !current.passwordHash) {
      const purpose = current.mfaEnabled && !secondMethod ? 'mfa' : 'setup';
      const rawToken = randomBytes(32).toString('base64url');
      const browserNonce = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      await transaction.authChallenge.updateMany({ where: { userId: user.id, purpose: { in: ['mfa', 'setup'] }, usedAt: null }, data: { usedAt: new Date() } });
      await transaction.authChallenge.create({ data: { tokenHash: sha256(rawToken), browserHash: sha256(browserNonce), userId: user.id,
        purpose, firstMethod: source, securityVersion: current.securityVersion, expiresAt, payload: secondMethod ? { secondMethod } : {} } });
      return { state: purpose === 'setup' ? 'setup_required' as const : 'mfa_required' as const, rawToken, browserNonce, expiresAt };
    }
    return this.issueSession(current, context, source, transaction, secondMethod);
  }

  private async issueSession(user: User, context: { userAgent?: string; ipAddress?: string }, source: 'local' | 'wecom' | 'zentao', transaction: Prisma.TransactionClient, secondMethod?: VerifiedSecond) {
    if (user.status !== 'active') throw new ForbiddenException('账号已停用，请联系平台管理员。');
    if (!user.username || !user.passwordHash || (user.mfaEnabled && (!secondMethod || (secondMethod !== 'recovery' && !user.mfaMethods.includes(secondMethod))))) throw new ForbiddenException('请完成账户验证。');
    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const ttlHours = Math.min(Math.max(Number(process.env.SESSION_TTL_HOURS ?? 12), 1), 168);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60_000);
    const result = await transaction.authSession.create({ data: { tokenHash: sha256(rawToken), csrfToken, userId: user.id, expiresAt, securityVersion: user.securityVersion, authMethods: secondMethod ? [source, secondMethod] : [source], userAgent: context.userAgent?.slice(0, 300), ipAddress: context.ipAddress?.slice(0, 80) } });
    if (source === 'wecom') await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    // 成功记录与会话同事务提交，保证登录历史不会出现没有会话的成功项。
    await this.attempts.record({ username: user.username, userId: user.id, displayName: user.displayName, result: 'success',
      source, secondMethod, sessionId: result.id, context }, transaction);
    return { state: 'authenticated' as const, user: sessionUser({ ...user, authSource: source }, await userRoles(transaction, user.id)), sessionId: result.id, rawToken, csrfToken, expiresAt };
  }

  private async pending(cookieHeader: unknown, transaction: Prisma.TransactionClient = this.prisma) {
    const token = cookieValue(cookieHeader, CHALLENGE_COOKIE);
    const browser = cookieValue(cookieHeader, CHALLENGE_BROWSER_COOKIE);
    if (!token || !browser || token.length > 100 || browser.length > 100) throw new UnauthorizedException('验证已过期，请重新登录。');
    const challenge = await transaction.authChallenge.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date() || challenge.browserHash !== sha256(browser)
      || challenge.user.status !== 'active' || challenge.securityVersion !== challenge.user.securityVersion) throw new UnauthorizedException('验证已过期，请重新登录。');
    return { challenge, csrfToken: sha256(`${token}.${browser}`) };
  }

  async pendingStatus(cookieHeader: unknown) {
    const { challenge, csrfToken } = await this.pending(cookieHeader);
    const user = challenge.user;
    const base = usernameBase(user.displayName);
    const used = await this.prisma.user.findMany({ where: { username: { startsWith: base } }, select: { username: true } });
    return { state: challenge.purpose === 'setup' ? 'setup_required' : 'mfa_required', csrfToken,
      username: user.username || availableUsername(user.displayName, new Set(used.map(value => value.username!))), methods: user.mfaMethods };
  }

  async completeSetup(cookieHeader: unknown, csrf: unknown, input: { username?: string; password?: string }, context: { userAgent?: string; ipAddress?: string }) {
    if (typeof input?.username !== 'string' || typeof input.password !== 'string' || !/^[a-z0-9._-]{3,50}$/.test(normalizeUsername(input.username))
      || input.password.length < 15 || input.password.length > 128) throw new ConflictException('用户名需为3至50位字母、数字或 ._-，密码需为15至128位。');
    const checked = await this.pending(cookieHeader);
    if (checked.challenge.purpose !== 'setup' || csrf !== checked.csrfToken) throw new ForbiddenException('验证请求无效。');
    const passwordHash = await hashPassword(input.password);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${checked.challenge.userId} FOR UPDATE`;
      const { challenge, csrfToken } = await this.pending(cookieHeader, tx);
      const secondMethod = (challenge.payload as { secondMethod?: VerifiedSecond }).secondMethod;
      if (csrf !== csrfToken || challenge.purpose !== 'setup' || challenge.user.passwordHash || (challenge.user.mfaEnabled && !secondMethod)) throw new ForbiddenException('请重新完成账户验证。');
      const user = await tx.user.update({ where: { id: challenge.userId }, data: { username: normalizeUsername(input.username!), passwordHash, securityVersion: { increment: 1 } } });
      await tx.authChallenge.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorUserId: user.id, actorName: user.displayName, actorRole: compatibilityRole(await userRoles(tx, user.id)), action: 'user.credentials_initialized', targetType: 'User', targetId: user.id } });
      return this.issueSession(user, context, challenge.firstMethod as 'local' | 'wecom' | 'zentao', tx, secondMethod);
    }).catch(error => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('用户名已被使用，请修改后重试。'); throw error; });
  }

  async completeMfa(cookieHeader: unknown, csrf: unknown, method: unknown, code: unknown, context: { userAgent?: string; ipAddress?: string }) {
    if (!['totp', 'email', 'key', 'recovery'].includes(String(method)) || (method !== 'key' && (typeof code !== 'string' || code.length > 128))) throw new ForbiddenException('验证方式或验证码无效。');
    const checked = await this.pending(cookieHeader);
    if (checked.csrfToken !== csrf || checked.challenge.purpose !== 'mfa') throw new ForbiddenException('验证请求无效。');
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${checked.challenge.userId} FOR UPDATE`;
      const { challenge } = await this.pending(cookieHeader, tx);
      const failures = await tx.authChallenge.aggregate({ where: { userId: challenge.userId, purpose: { in: ['mfa', 'reauth_failure'] }, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } }, _sum: { attempts: true } });
      if ((failures._sum.attempts ?? 0) >= 5) throw new HttpException('验证失败次数过多，请15分钟后重试。', 429);
      let valid = false;
      if (method === 'totp' && challenge.user.mfaMethods.includes('totp')) valid = await consumeTotp(tx, challenge.userId, code);
      if (method === 'email' && challenge.user.mfaMethods.includes('email') && challenge.firstMethod !== 'email') valid = await this.emailOtp.consume(tx, challenge.user, `mfa:${challenge.id}`, code);
      if (method === 'key' && challenge.user.mfaMethods.includes('key')) valid = await this.keys.consume(tx, challenge.user, `mfa:${challenge.id}`, code);
      if (method === 'recovery' && typeof code === 'string') valid = (await tx.recoveryCode.updateMany({ where: { userId: challenge.userId, codeHash: sha256(code), usedAt: null }, data: { usedAt: new Date() } })).count === 1;
      if (!valid) { await tx.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } }); return null; }
      await tx.authChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
      return this.beginAuthentication(challenge.user, context, challenge.firstMethod as 'local' | 'wecom' | 'zentao', tx, method as VerifiedSecond);
    });
    if (!result) throw new ForbiddenException('验证码无效或已使用。');
    return result;
  }

  async sendMfaEmail(cookieHeader: unknown, csrf: unknown) {
    const checked = await this.pending(cookieHeader);
    if (csrf !== checked.csrfToken) throw new ForbiddenException('验证请求无效。');
    const message = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${checked.challenge.userId} FOR UPDATE`;
      const { challenge } = await this.pending(cookieHeader, tx);
      const email = await tx.verifiedEmail.findUnique({ where: { userId: challenge.userId } });
      if (challenge.purpose !== 'mfa' || !challenge.user.mfaMethods.includes('email') || challenge.firstMethod === 'email' || !email) throw new ForbiddenException('邮箱验证不可用。');
      return this.emailOtp.prepare(tx, challenge.user, `mfa:${challenge.id}`, email.address);
    });
    await this.emailOtp.deliver(message); return { sent: true };
  }
  async mfaKeyOptions(cookieHeader: unknown, csrf: unknown) {
    const checked = await this.pending(cookieHeader);
    if (csrf !== checked.csrfToken) throw new ForbiddenException('验证请求无效。');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${checked.challenge.userId} FOR UPDATE`;
      const { challenge } = await this.pending(cookieHeader, tx);
      if (challenge.purpose !== 'mfa' || !challenge.user.mfaMethods.includes('key')) throw new ForbiddenException('安全密钥验证不可用。');
      return this.keys.prepare(tx, challenge.user, `mfa:${challenge.id}`);
    });
  }

  async authenticate(cookieHeader: unknown, authorization?: unknown): Promise<{ user: SessionUser; session: { id: string; csrfToken: string } }> {
    if (authorization !== undefined) {
      const token = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
      if (!token) throw new UnauthorizedException('统一访问令牌无效。');
      return this.authenticateToken(token);
    }
    return this.authenticateToken(cookieValue(cookieHeader, SESSION_COOKIE));
  }

  async authenticateToken(rawToken: unknown): Promise<{ user: SessionUser; session: { id: string; csrfToken: string } }> {
    if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new UnauthorizedException('请先登录。');
    const session = await this.prisma.authSession.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('登录状态已失效，请重新登录。');
    if (session.user.status !== 'active') throw new UnauthorizedException('账号已停用。');
    if (!session.user.username || !session.user.passwordHash || session.securityVersion !== session.user.securityVersion) throw new UnauthorizedException('请重新登录并完成账户设置。');
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    const roles = await userRoles(this.prisma, session.userId);
    return { user: { ...sessionUser(session.user, roles), identityAuthorized: (await applicationAccess(this.prisma, session.userId, 'identity')).effective }, session: { id: session.id, csrfToken: session.csrfToken } };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(actor: Actor, currentSessionId: string, currentPassword: string, newPassword: string) {
    if (typeof currentPassword !== 'string' || currentPassword.length > 128) throw new ForbiddenException('当前密码错误。');
    if (typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128) throw new ConflictException('新密码长度必须为10至128个字符。');
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.userId} FOR UPDATE NOWAIT`;
      const user = await transaction.user.findUnique({ where: { id: actor.userId } });
      const session = await transaction.authSession.findUnique({ where: { id: currentSessionId } });
      const now = Date.now();
      if (!user || user.status !== 'active' || !session || session.userId !== user.id || session.revokedAt || session.expiresAt.getTime() <= now || session.securityVersion !== user.securityVersion) throw new UnauthorizedException('请重新登录。');
      if (!user.username || !user.passwordHash) throw new ForbiddenException('请先完成账户设置。');
      if (user.mfaEnabled && (session.verifiedAt.getTime() <= now - 300_000 || session.verifiedAt.getTime() > now
        || !session.authMethods.some(method => method === 'recovery' || (['totp', 'email', 'key'].includes(method) && user.mfaMethods.includes(method))))) throw new ForbiddenException('修改密码需要近期多因素验证，请重新登录完成验证后再试。');
      const failures = await transaction.authChallenge.aggregate({ where: { userId: user.id, purpose: { in: ['reauth_failure', 'mfa'] }, createdAt: { gt: new Date(now - 15 * 60_000) } }, _sum: { attempts: true } });
      if ((failures._sum.attempts ?? 0) >= 5) throw new HttpException('验证失败次数过多，请15分钟后重试。', 429);
      if (!await verifyPassword(currentPassword, user.passwordHash)) {
        await transaction.authChallenge.create({ data: { tokenHash: sha256(randomBytes(32).toString('hex')), browserHash: '', userId: user.id, purpose: 'reauth_failure', firstMethod: 'local', securityVersion: user.securityVersion, attempts: 1, expiresAt: new Date() } });
        return null;
      }
      if (await verifyPassword(newPassword, user.passwordHash)) throw new ConflictException('新密码不能与当前密码相同。');
      const passwordHash = await hashPassword(newPassword);
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null, securityVersion: { increment: 1 } },
      });
      const updated = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
      await transaction.authSession.update({ where: { id: currentSessionId }, data: { securityVersion: updated.securityVersion } });
      const revoked = await transaction.authSession.updateMany({
        where: { userId: user.id, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.userId,
          actorName: actor.name,
          actorRole: actor.role,
          action: 'user.password_changed',
          targetType: 'User',
          targetId: user.id,
          detail: { revokedSessions: revoked.count },
        },
      });
      return { changed: true, revokedSessions: revoked.count };
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '55P03') throw new HttpException('账户操作正在进行，请稍后重试。', 429);
      throw error;
    });
    if (!result) throw new ForbiddenException('当前密码错误。');
    return result;
  }

  async listUsers(actor: Actor) {
    requireRole(actor, ['system_admin']);
    const users = await this.prisma.user.findMany({ include: { wecomIdentities: true, zentaoIdentities: true, organizations: { include: { organization: { select: { id: true, name: true, enabled: true } } } }, roles: { include: { role: { select: roleSelection } } } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
    return users.map((user) => ({ ...this.userView(user), roles: user.roles.map(m => m.role) }));
  }



  async createUser(input: { username?: string; displayName?: string; password?: string; role?: unknown; roleIds?: unknown; departmentName?: string }, actor: Actor) {
    requireRole(actor, ['system_admin']);
    if (input.role !== undefined) throw new ConflictException('请通过 roleIds 分配统一角色，不再单独设置系统身份。');
    const roleIds = validateRoleIds(input.roleIds ?? []);
    const username = normalizeUsername(input.username ?? ''), displayName = input.displayName?.trim();
    if (!username || !/^[a-z0-9._-]{3,50}$/.test(username) || !displayName || !input.password) throw new ConflictException('账号、姓名、初始密码均为必填项，账号仅支持字母、数字及 ._-。');
    if (input.password.length < 10 || input.password.length > 128) throw new ConflictException('密码长度必须为10至128个字符。');
    const passwordHash = await hashPassword(input.password);
    try { return await this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      const user = await tx.user.create({ data: { username, displayName, passwordHash, departmentName: input.departmentName?.trim() || null, authSource: 'local' } });
      await replaceUserRoles(tx, user.id, roleIds);
      await ensureIdentityAdministrator(tx);
      await this.audit(actor, 'user.created', user.id, { roleIds, status: user.status }, tx);
      return this.userView({ ...user, roles: (await userRoles(tx, user.id)).map(role => ({ role })) });
    }); } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('登录账号或姓名已存在，请关联已有身份。');
      throw error;
    }
  }

  async updateUser(userId: string, input: { displayName?: string; role?: unknown; roleIds?: unknown; status?: string; departmentName?: string }, actor: Actor) {
    requireRole(actor, ['system_admin']);
    if (input.role !== undefined) throw new ConflictException('请通过 roleIds 分配统一角色，不再单独设置系统身份。');
    const roleIds = input.roleIds === undefined ? undefined : validateRoleIds(input.roleIds);
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (!current) throw new ConflictException('用户不存在。');
      const status = input.status === undefined ? current.status : input.status;
      if (!['active', 'disabled'].includes(status)) throw new ConflictException('用户状态无效。');
      if (userId === actor.userId && status === 'disabled') throw new ConflictException('不能停用当前登录账号。');
      const previousRoles = await userRoles(tx, userId);
      const user = await tx.user.update({ where: { id: userId }, data: { displayName: input.displayName?.trim() || current.displayName, status, departmentName: input.departmentName === undefined ? current.departmentName : input.departmentName.trim() || null } });
      if (roleIds !== undefined) await replaceUserRoles(tx, userId, roleIds);
      await ensureIdentityAdministrator(tx);
      if (status === 'disabled') await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      const roles = await userRoles(tx, userId);
      await this.audit(actor, 'user.updated', user.id, { beforeRoleIds: previousRoles.map(r => r.id), afterRoleIds: roles.map(r => r.id), beforeStatus: current.status, afterStatus: user.status }, tx);
      return this.userView({ ...user, roles: roles.map(role => ({ role })) });
    });
  }

  async resetPassword(userId: string, password: string, actor: Actor) {
    requireRole(actor, ['system_admin']);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ConflictException('用户不存在。');
    if (password.length < 10 || password.length > 128) throw new ConflictException('密码长度必须为10至128个字符。');
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, securityVersion: { increment: 1 } } }),
      this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit(actor, 'user.password_reset', userId);
    return { userId, reset: true };
  }

  async bindWeCom(userId: string, externalUserIdInput: string, actor: Actor) {
    requireRole(actor, ['system_admin']);
    const corpId = process.env.WECOM_CORP_ID?.trim();
    const externalUserId = externalUserIdInput.trim();
    if (!corpId) throw new ConflictException('企业微信尚未配置 CorpID。');
    if (!externalUserId || externalUserId.length > 128) throw new ConflictException('企业微信 UserID 无效。');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ConflictException('用户不存在。');
    await this.prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(741027)::text`;
    const existingIdentity = await transaction.weComIdentity.findUnique({ where: { corpId_externalUserId: { corpId, externalUserId } } });
    if (existingIdentity && existingIdentity.userId !== userId) throw new ConflictException('该企业微信身份已绑定其他用户。');
    const existingForUser = await transaction.weComIdentity.findUnique({ where: { userId_corpId: { userId, corpId } } });
    if (existingForUser && existingForUser.externalUserId !== externalUserId) throw new ConflictException('该用户已绑定其他企业微信身份，请先解绑。');
    try {
      if (!existingIdentity) await transaction.weComIdentity.create({ data: { userId, corpId, externalUserId } });
      await transaction.weComIdentityRevocation.deleteMany({ where: { corpId, externalUserId } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('该企业微信身份已绑定其他用户。');
      throw error;
    }
    await this.audit(actor, 'user.wecom_bound', userId, { corpId, externalUserId }, transaction);
    });
    return { userId, corpId, externalUserId, bound: true };
  }

  async unbindWeCom(userId: string, identityId: string, actor: Actor) {
    requireRole(actor, ['system_admin']);
    await this.prisma.$transaction(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(741027)::text`;
    const identity = await transaction.weComIdentity.findFirst({ where: { id: identityId, userId } });
    if (!identity) throw new ConflictException('企业微信绑定不存在。');
    const key = { corpId: identity.corpId, externalUserId: identity.externalUserId };
    await transaction.weComIdentityRevocation.upsert({ where: { corpId_externalUserId: key }, create: key, update: { revokedAt: new Date() } });
    await transaction.weComIdentity.delete({ where: { id: identity.id } });
    await transaction.user.update({ where: { id: userId }, data: { securityVersion: { increment: 1 } } });
    await transaction.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(actor, 'user.wecom_unbound', userId, { corpId: identity.corpId, externalUserId: identity.externalUserId }, transaction);
    });
    return { userId, unbound: true };
  }

  private async audit(actor: Actor, action: string, targetId: string, detail?: Record<string, unknown>, transaction: Prisma.TransactionClient = this.prisma) {
    await transaction.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action, targetType: 'User', targetId, detail: detail as Prisma.InputJsonValue | undefined } });
  }

  private userView(user: { id: string; username: string | null; displayName: string; departmentName: string | null; avatarUrl?: string | null; role: string; status: string; authSource: string; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date; roles?: Array<{ role: RoleSummary }>; organizations?: Array<{organization:{id:string;name:string;enabled:boolean};isPrimary:boolean;title:string|null}>; zentaoIdentities?: Array<{ id: string; account: string; server: string }>; wecomIdentities?: Array<{ id: string; corpId: string; externalUserId: string; boundAt: Date; lastLoginAt: Date | null }> }) {
    const identities = user.wecomIdentities?.map((identity) => ({ ...identity, boundAt: identity.boundAt.toISOString(), lastLoginAt: identity.lastLoginAt?.toISOString() ?? null })) ?? [];
    return { id: user.id, username: user.username, displayName: user.displayName, departmentName: user.departmentName, avatarUrl: profileAvatarUrl(user.avatarUrl), role: compatibilityRole(user.roles?.map(m => m.role) || []), roles: user.roles?.map(m => m.role) || [], organizations: user.organizations?.map(m => ({ id: m.organization.id, name: m.organization.name, enabled: m.organization.enabled, isPrimary: m.isPrimary, title: m.title })) || [], status: user.status, authSource: user.authSource, wecomBound: identities.length > 0, wecomIdentities: identities, zentaoIdentities: user.zentaoIdentities?.map(i=>({id:i.id,account:i.account,server:i.server})) || [], lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() };
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly auth: AuthService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authenticated = await this.auth.authenticate(request.headers.cookie, request.headers.authorization);
    request.user = authenticated.user;
    request.authSession = authenticated.session;
    if (!this.reflector.getAllAndOverride<boolean>(FOUNDATION_IDENTITY, [context.getHandler(), context.getClass()])
      && !(await applicationAccess(this.prisma, authenticated.user.userId, 'identity')).effective) {
      throw new ForbiddenException('尚未获得统一身份应用授权，请联系管理员。');
    }
    const method = String(request.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || csrf !== authenticated.session.csrfToken) throw new ForbiddenException('CSRF 校验失败，请刷新页面后重试。');
    }
    return true;
  }
}

export function actorFromRequest(request: AuthenticatedRequest): Actor {
  if (!request.user) throw new UnauthorizedException('请先登录。');
  return { userId: request.user.userId, name: request.user.name, role: request.user.role };
}

export function requireRole(actor: Actor, roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new ForbiddenException(`角色 ${actor.role} 无权执行此操作。`);
}
