import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, SetMetadata, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { hashPassword, verifyPassword } from './password';
import { availableUsername, usernameBase } from './username-suggestion';
import { consumeTotp } from './totp';
import { EmailOtpService } from './email-otp';
import { SecurityKeyService } from './security-key';
import { identityEnabled, identitySessionActive, identityEndSession } from './identity-client';
import { bearerToken, unifiedIdentity, unifiedIdentityEnabled, UnifiedAuthError } from './unified-client';
import { applyIdentityUser } from './identity-projection';
type AuthSource = 'local' | 'wecom' | 'sso';
export interface AuthContext { userAgent?: string; ipAddress?: string; identity?: { subject: string; sessionId: string; authMethods?: string[] }; }
type VerifiedSecond = 'totp' | 'email' | 'key' | 'recovery';

export { hashPassword } from './password';

export const ROLES = ['system_admin', 'catalog_manager', 'researcher', 'reviewer', 'publisher', 'reader', 'ai_service'] as const;
export type Role = (typeof ROLES)[number];
export interface Actor { userId: string; name: string; role: Role; }
export interface SessionUser extends Actor { username: string | null; departmentName: string | null; authSource: string; }
export interface AuthenticatedRequest { user?: SessionUser; authSession?: { id: string; csrfToken: string }; headers: Record<string, unknown>; method?: string; ip?: string; url?: string; }

export const SESSION_COOKIE = 'mg_expert_session';
export const CHALLENGE_COOKIE = 'mg_expert_challenge';
export const CHALLENGE_BROWSER_COOKIE = 'mg_expert_challenge_browser';
export const PUBLIC_ROUTE = 'publicRoute';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

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

function sessionUser(user: { id: string; username: string | null; displayName: string; departmentName: string | null; role: string; authSource: string }): SessionUser {
  return { userId: user.id, username: user.username, name: user.displayName, departmentName: user.departmentName, role: user.role as Role, authSource: user.authSource };
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(EmailOtpService) private readonly emailOtp: EmailOtpService, @Inject(SecurityKeyService) private readonly keys: SecurityKeyService) {}

  async login(usernameInput: string, password: string, context: AuthContext) {
    if (typeof usernameInput !== 'string' || typeof password !== 'string' || usernameInput.length > 50 || password.length > 128) throw new UnauthorizedException('账号或密码错误。');
    const username = normalizeUsername(usernameInput || '');
    if (!username || !password) throw new UnauthorizedException('账号或密码错误。');
    const result = await this.prisma.$transaction(async transaction => {
    // 锁定同一账户的整个验证过程；并发请求立即拒绝，不排队执行昂贵的密码验证。
    await transaction.$queryRaw`SELECT id FROM "User" WHERE username = ${username} FOR UPDATE NOWAIT`;
    const user = await transaction.user.findUnique({ where: { username } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) return { error: 'locked' as const };
    const valid = Boolean(user?.passwordHash) && await verifyPassword(password, user!.passwordHash!);
    if (!user || !valid) {
      if (user) {
        const failures = (user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginCount) + 1;
        await transaction.user.update({ where: { id: user.id }, data: { failedLoginCount: failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
      }
      // 错误在事务提交之后抛出，保证失败计数不会被回滚。
      return { error: 'invalid' as const };
    }
    if (user.status !== 'active' || user.identityEnabled === false) return { error: 'disabled' as const };
    await transaction.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    return { session: await this.beginAuthentication(user, context, 'local', transaction) };
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '55P03') return { error: 'locked' as const };
      throw error;
    });
    if ('session' in result && result.session) return result.session;
    if (result.error === 'locked') throw new HttpException('登录请求过于频繁，请稍后再试。', HttpStatus.TOO_MANY_REQUESTS);
    if (result.error === 'disabled') throw new ForbiddenException('账号已停用，请联系系统管理员。');
    throw new UnauthorizedException('账号或密码错误。');
  }

  async beginAuthentication(user: User, context: AuthContext, source: AuthSource, transaction: Prisma.TransactionClient, secondMethod?: VerifiedSecond) {
    if (unifiedIdentityEnabled()) throw new ForbiddenException('内部应用登录令牌由统一认证签发。');
    await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
    if (process.env.IDENTITY_ENABLED === 'true' && source !== 'sso')
      throw new ForbiddenException('请使用统一身份登录。');
    if (current.status !== 'active' || current.identityEnabled === false) throw new ForbiddenException('账号已停用。');
    if (source !== 'sso' && ((current.mfaEnabled && !secondMethod) || !current.username || !current.passwordHash)) {
      const purpose = current.mfaEnabled && !secondMethod ? 'mfa' : 'setup';
      const rawToken = randomBytes(32).toString('base64url');
      const browserNonce = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      await transaction.authChallenge.updateMany({ where: { userId: user.id, purpose: { in: ['mfa', 'setup'] }, usedAt: null }, data: { usedAt: new Date() } });
      await transaction.authChallenge.create({ data: { tokenHash: sha256(rawToken), browserHash: sha256(browserNonce), userId: user.id,
        purpose, firstMethod: source, securityVersion: current.securityVersion, expiresAt, payload: { ...(secondMethod ? { secondMethod } : {}), ...(context.identity ? { identity: context.identity } : {}) } } });
      return { state: purpose === 'setup' ? 'setup_required' as const : 'mfa_required' as const, rawToken, browserNonce, expiresAt };
    }
    return this.issueSession(current, context, source, transaction, secondMethod);
  }

  private async issueSession(user: User, context: AuthContext, source: AuthSource, transaction: Prisma.TransactionClient, secondMethod?: VerifiedSecond) {
    if (source === 'sso' && (!context.identity || !(await identitySessionActive(context.identity.subject, context.identity.sessionId)))) throw new UnauthorizedException('统一身份会话已失效');
    if (user.status !== 'active' || user.identityEnabled === false) throw new ForbiddenException('账号已停用，请联系系统管理员。');
    if (source !== 'sso' && (!user.username || !user.passwordHash || (user.mfaEnabled && (!secondMethod || (secondMethod !== 'recovery' && !user.mfaMethods.includes(secondMethod)))))) throw new ForbiddenException('请完成账户验证。');
    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const ttlHours = Math.min(Math.max(Number(process.env.SESSION_TTL_HOURS ?? 12), 1), 168);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60_000);
    const result = await transaction.authSession.create({ data: { tokenHash: sha256(rawToken), csrfToken, userId: user.id, expiresAt, securityVersion: user.securityVersion, identitySubject: context.identity?.subject, identitySessionId: context.identity?.sessionId, authMethods: secondMethod ? [source, secondMethod] : [source], userAgent: context.userAgent?.slice(0, 300), ipAddress: context.ipAddress?.slice(0, 80) } });
    if (source === 'wecom') await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { state: 'authenticated' as const, user: sessionUser({ ...user, authSource: source }), sessionId: result.id, rawToken, csrfToken, expiresAt };
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

  async completeSetup(cookieHeader: unknown, csrf: unknown, input: { username?: string; password?: string }, context: AuthContext) {
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
      await tx.auditLog.create({ data: { actorUserId: user.id, actorName: user.displayName, actorRole: user.role, action: 'user.credentials_initialized', targetType: 'User', targetId: user.id } });
      return this.issueSession(user, { ...context, identity: (challenge.payload as { identity?: AuthContext['identity'] }).identity }, challenge.firstMethod as AuthSource, tx, secondMethod);
    }).catch(error => { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('用户名已被使用，请修改后重试。'); throw error; });
  }

  async completeMfa(cookieHeader: unknown, csrf: unknown, method: unknown, code: unknown, context: AuthContext) {
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
      return this.beginAuthentication(challenge.user, { ...context, identity: (challenge.payload as { identity?: AuthContext['identity'] }).identity }, challenge.firstMethod as AuthSource, tx, method as VerifiedSecond);
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
    if (unifiedIdentityEnabled()) {
      try {
        const profile = await unifiedIdentity.introspect(bearerToken(authorization));
        const user = await this.prisma.$transaction(tx => applyIdentityUser(tx, { subject: profile.sub,
          localUserId: profile.localUserId, username: profile.username, name: profile.name, department: profile.department,
          active: true, securityVersion: profile.securityVersion }));
        if (!user) throw new UnauthorizedException('账号不可用。');
        return { user: sessionUser({ ...user, authSource: 'sso' }), session: { id: profile.sid, csrfToken: profile.csrfToken } };
      } catch (error) {
        if (error instanceof UnifiedAuthError && error.status === 503) throw new ServiceUnavailableException(error.message);
        throw new UnauthorizedException('统一登录无效或身份映射冲突。');
      }
    }
    const rawToken = cookieValue(cookieHeader, SESSION_COOKIE);
    if (!rawToken) throw new UnauthorizedException('请先登录。');
    const session = await this.prisma.authSession.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('登录状态已失效，请重新登录。');
    if (process.env.IDENTITY_ENABLED === 'true' && !session.identitySessionId)
      throw new UnauthorizedException('请重新进入统一身份登录。');
    if (session.user.status !== 'active') throw new UnauthorizedException('账号已停用。');
    if ((!session.identitySessionId && (!session.user.username || !session.user.passwordHash)) || session.securityVersion !== session.user.securityVersion) throw new UnauthorizedException('请重新登录并完成账户设置。');
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    if (session.user.identityEnabled === false) throw new UnauthorizedException('统一身份已停用');
    if (session.identitySessionId) {
      try { if (!session.identitySubject || !(await identitySessionActive(session.identitySubject, session.identitySessionId))) throw new Error(); }
      catch { throw new UnauthorizedException('统一登录已失效，请重新登录'); }
    }
    return { user: sessionUser({...session.user,authSource:session.identitySessionId?'sso':session.user.authSource}), session: { id: session.id, csrfToken: session.csrfToken } };
  }

  async logout(sessionId: string, authorization?: unknown): Promise<void> {
    if (unifiedIdentityEnabled()) { await unifiedIdentity.revoke(bearerToken(authorization)); return; }
    const session = await this.prisma.authSession.findUnique({ where: { id: sessionId } });
    if (session?.identitySubject && session.identitySessionId) await identityEndSession(session.identitySubject, session.identitySessionId);
    await this.prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(actor: Actor, currentSessionId: string, currentPassword: string, newPassword: string) {
    if (identityEnabled()) throw new ForbiddenException('账号资料与安全设置请在统一认证中心管理。');
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
    const users = await this.prisma.user.findMany({ include: { wecomIdentities: true }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
    return users.map((user) => this.userView(user));
  }

  async listResearchers(actor: Actor) {
    requireRole(actor, ['system_admin', 'catalog_manager', 'reviewer']);
    const users = await this.prisma.user.findMany({ where: { role: 'researcher', status: 'active' }, include: { wecomIdentities: true }, orderBy: { displayName: 'asc' } });
    return users.map((user) => this.userView(user));
  }

  async createUser(input: { username?: string; displayName?: string; password?: string; role?: string; departmentName?: string }, actor: Actor) {
    if (identityEnabled()) throw new ForbiddenException('账号资料与安全设置请在统一认证中心管理。');
    requireRole(actor, ['system_admin']);
    const username = normalizeUsername(input.username ?? '');
    const displayName = input.displayName?.trim();
    const role = this.validRole(input.role);
    if (!username || !/^[a-z0-9._-]{3,50}$/.test(username) || !displayName || !input.password) throw new ConflictException('账号、姓名、初始密码均为必填项，账号仅支持字母、数字及 ._-。');
    if (input.password.length < 10 || input.password.length > 128) throw new ConflictException('密码长度必须为10至128个字符。');
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.user.create({ data: { username, displayName, passwordHash, role, departmentName: input.departmentName?.trim() || null, authSource: 'local' } });
      await this.audit(actor, 'user.created', user.id, { role: user.role, status: user.status });
      return this.userView(user);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('登录账号已存在。');
      throw error;
    }
  }

  async updateUser(userId: string, input: { displayName?: string; role?: string; status?: string; departmentName?: string }, actor: Actor) {
    if (identityEnabled() && Object.keys(input).some(key => key !== 'role')) throw new ForbiddenException('此处仅可调整业务角色，账号资料请在统一认证中心管理。');
    requireRole(actor, ['system_admin']);
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw new ConflictException('用户不存在。');
    const status = input.status === undefined ? current.status : input.status;
    if (!['active', 'disabled'].includes(status)) throw new ConflictException('用户状态无效。');
    if (userId === actor.userId && status === 'disabled') throw new ConflictException('不能停用当前登录账号。');
    const role = input.role === undefined ? current.role as Role : this.validRole(input.role);
    if (current.role === 'system_admin' && (role !== 'system_admin' || status === 'disabled')) {
      const activeAdmins = await this.prisma.user.count({ where: { role: 'system_admin', status: 'active' } });
      if (activeAdmins <= 1) throw new ConflictException('系统必须保留至少一个启用的系统管理员。');
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName?.trim() || current.displayName, role, status, departmentName: input.departmentName === undefined ? current.departmentName : input.departmentName.trim() || null } });
    if (status === 'disabled' || role !== current.role) await this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(actor, 'user.updated', user.id, { beforeRole: current.role, afterRole: user.role, beforeStatus: current.status, afterStatus: user.status });
    return this.userView(user);
  }

  async resetPassword(userId: string, password: string, actor: Actor) {
    if (identityEnabled()) throw new ForbiddenException('账号资料与安全设置请在统一认证中心管理。');
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
    if (identityEnabled()) throw new ForbiddenException('账号资料与安全设置请在统一认证中心管理。');
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
    if (identityEnabled()) throw new ForbiddenException('账号资料与安全设置请在统一认证中心管理。');
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

  private validRole(role?: string): Role {
    if (!role || !ROLES.includes(role as Role) || role === 'ai_service') throw new ConflictException('用户角色无效。');
    return role as Role;
  }

  private userView(user: { id: string; username: string | null; displayName: string; departmentName: string | null; role: string; status: string; authSource: string; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date; wecomIdentities?: Array<{ id: string; corpId: string; externalUserId: string; boundAt: Date; lastLoginAt: Date | null }> }) {
    const identities = user.wecomIdentities?.map((identity) => ({ ...identity, boundAt: identity.boundAt.toISOString(), lastLoginAt: identity.lastLoginAt?.toISOString() ?? null })) ?? [];
    return { id: user.id, username: user.username, displayName: user.displayName, departmentName: user.departmentName, role: user.role, status: user.status, authSource: user.authSource, wecomBound: identities.length > 0, wecomIdentities: identities, lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() };
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = (request.url || '').split('?')[0] || '';
    if (identityEnabled() && /^(?:\/api)?\/(?:account-security(?:\/|$)|auth\/(?:login|setup|pending|mfa|change-password)(?:\/|$))/.test(path)) {
      throw new ForbiddenException('请前往统一认证中心登录或管理账号安全。');
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const authenticated = await this.auth.authenticate(request.headers.cookie, request.headers.authorization);
    request.user = authenticated.user;
    request.authSession = authenticated.session;
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
