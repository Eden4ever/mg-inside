import { compatibilityRole, userRoles } from './platform-role';
import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { sha256 } from './auth';
import { verifyPassword } from './password';
import { consumeTotp, newTotp, totpStep } from './totp';
import { decryptSecret, encryptSecret } from './security-secrets';
import { EmailOtpService } from './email-otp';
import { validEmail } from './mail-config';
import { SecurityKeyService } from './security-key';

@Injectable()
export class AccountSecurityService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(EmailOtpService) private readonly emailOtp: EmailOtpService, @Inject(SecurityKeyService) private readonly keys: SecurityKeyService) {}
  async read(userId: string, sessionId?: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { verifiedEmail: true, totpCredential: true, securityKeys: true } });
    const session = sessionId ? await this.db.authSession.findUnique({ where: { id: sessionId } }) : null;
    const recentRecovery = Boolean(session && session.userId === userId && !session.revokedAt && session.expiresAt > new Date() && session.securityVersion === user.securityVersion && session.authMethods.includes('recovery') && session.verifiedAt.getTime() > Date.now() - 5 * 60_000 && session.verifiedAt.getTime() <= Date.now());
    return { recentRecovery, mfaEnabled: user.mfaEnabled, methods: user.mfaMethods, email: user.verifiedEmail?.address ?? null,
      totpBound: Boolean(user.totpCredential), keys: user.securityKeys.map(key => ({ id: key.id, name: key.name, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt })) };
  }
  async authorize(userId: string, sessionId: string, password: unknown, code: unknown, method = 'totp') {
    if (typeof password !== 'string' || password.length > 128) throw new BadRequestException('请输入当前密码。');
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const session = await tx.authSession.findUnique({ where: { id: sessionId } });
      if (user.status !== 'active' || !session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date() || session.securityVersion !== user.securityVersion) throw new UnauthorizedException('请重新登录。');
      const failures = await tx.authChallenge.aggregate({ where: { userId, purpose: { in: ['reauth_failure', 'mfa'] }, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } }, _sum: { attempts: true } });
      if ((failures._sum.attempts ?? 0) >= 5) throw new HttpException('验证失败次数过多，请15分钟后重试。', 429);
      const validPassword = user.passwordHash && await verifyPassword(password, user.passwordHash);
      // 仅信任服务端记录的刚完成恢复验证的会话，不重复消费最后一枚恢复码。
      const recentRecovery = method === 'recovery_session' && session.authMethods.includes('recovery')
        && session.verifiedAt.getTime() > Date.now() - 5 * 60_000 && session.verifiedAt.getTime() <= Date.now();
      const recovery = validPassword && user.mfaEnabled && method === 'recovery' && typeof code === 'string' && /^[a-f0-9]{32}$/.test(code)
        && (await tx.recoveryCode.updateMany({ where: { userId, codeHash: sha256(code), usedAt: null }, data: { usedAt: new Date() } })).count === 1;
      const validFactor = validPassword && (!user.mfaEnabled || recentRecovery || recovery || (user.mfaMethods.includes(method) && (method === 'totp'
        ? await consumeTotp(tx, userId, code) : method === 'email' ? await this.emailOtp.consume(tx, user, `reauth:${sessionId}`, code) : method === 'key' && await this.keys.consume(tx, user, `reauth:${sessionId}`, code))));
      if (!validPassword || !validFactor) {
        await tx.authChallenge.create({ data: { tokenHash: sha256(randomBytes(32).toString('hex')), browserHash: '', userId, purpose: 'reauth_failure', firstMethod: 'local', securityVersion: user.securityVersion, attempts: 1, expiresAt: new Date() } });
        return null;
      }
      const token = randomBytes(32).toString('base64url');
      await tx.authChallenge.create({ data: { tokenHash: sha256(token), browserHash: sha256(sessionId), userId, purpose: 'manage_security', firstMethod: user.mfaEnabled ? method : 'local', securityVersion: user.securityVersion, expiresAt: new Date(Date.now() + 5 * 60_000) } });
      return { token };
    });
    if (!result) throw new ForbiddenException('密码或验证码错误。');
    return result;
  }
  private async withGrant<T>(userId: string, sessionId: string, token: string, purpose: string, action: (tx: Prisma.TransactionClient, user: User, payload: Prisma.JsonValue) => Promise<T>) {
    if (typeof token !== 'string' || token.length > 100) throw new UnauthorizedException('请重新验证身份。');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const grant = await tx.authChallenge.findUnique({ where: { tokenHash: sha256(token) } });
      const session = await tx.authSession.findUnique({ where: { id: sessionId } });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== userId || session.securityVersion !== user.securityVersion
        || !grant || grant.userId !== userId || grant.browserHash !== sha256(sessionId) || grant.purpose !== purpose || grant.usedAt || grant.expiresAt <= new Date()
        || grant.securityVersion !== user.securityVersion || user.status !== 'active') throw new UnauthorizedException('请重新验证身份。');
      await tx.authChallenge.update({ where: { id: grant.id }, data: { usedAt: new Date() } });
      return action(tx, user, grant.payload);
    });
  }
  async startTotp(userId: string, sessionId: string, token: string) {
    return this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (await tx.totpCredential.findUnique({ where: { userId } })) throw new BadRequestException('认证器已绑定，请先解除旧绑定。');
      const totp = newTotp(user.username || user.displayName); const bindingToken = randomBytes(32).toString('base64url');
      await tx.authChallenge.updateMany({ where: { userId, purpose: 'bind_totp', usedAt: null }, data: { usedAt: new Date() } });
      await tx.authChallenge.create({ data: { tokenHash: sha256(bindingToken), browserHash: sha256(sessionId), userId, purpose: 'bind_totp', firstMethod: 'local', securityVersion: user.securityVersion,
        payload: { encryptedSecret: encryptSecret(totp.secret, `totp:${userId}`) }, expiresAt: new Date(Date.now() + 5 * 60_000) } });
      return { token: bindingToken, ...totp };
    });
  }
  async confirmTotp(userId: string, sessionId: string, token: string, code: unknown) {
    return this.withGrant(userId, sessionId, token, 'bind_totp', async (tx, user, payload) => {
      const encryptedSecret = (payload as { encryptedSecret: string }).encryptedSecret;
      const step = totpStep(decryptSecret(encryptedSecret, `totp:${userId}`), code);
      // 失败也消费绑定凭证，不能对同一种子无限尝试。
      if (step === null) return { ok: false };
      await tx.totpCredential.create({ data: { userId, encryptedSecret, lastUsedStep: step } });
      await this.changed(tx, user, sessionId, 'user.totp_bound');
      return { ok: true };
    });
  }
  async setMfa(userId: string, sessionId: string, token: string, enabled: boolean, methods: string[]) {
    if (typeof enabled !== 'boolean' || !Array.isArray(methods) || methods.some(method => !['totp', 'email', 'key'].includes(method)) || new Set(methods).size !== methods.length) throw new BadRequestException('验证方式无效。');
    return this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (enabled && (!methods.length || (methods.includes('totp') && !await tx.totpCredential.findUnique({ where: { userId } })) || (methods.includes('email') && !await tx.verifiedEmail.findUnique({ where: { userId } })))) throw new BadRequestException('请先绑定所选验证方式。');
      if (enabled && methods.includes('key') && !await tx.securityKey.count({ where: { userId } })) throw new BadRequestException('请先绑定安全密钥。');
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: enabled, mfaMethods: enabled ? methods : [] } });
      const codes = enabled && !user.mfaEnabled ? Array.from({ length: 10 }, () => randomBytes(16).toString('hex')) : [];
      if (codes.length) {
        await tx.recoveryCode.deleteMany({ where: { userId } });
        await tx.recoveryCode.createMany({ data: codes.map(code => ({ userId, codeHash: sha256(code) })) });
      }
      if (!enabled) await tx.recoveryCode.deleteMany({ where: { userId } });
      await this.changed(tx, user, sessionId, enabled ? 'user.mfa_enabled' : 'user.mfa_disabled');
      return { enabled, recoveryCodes: codes };
    });
  }
  async removeTotp(userId: string, sessionId: string, token: string) {
    return this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (user.mfaEnabled && user.mfaMethods.includes('totp')) throw new BadRequestException('请先关闭多因素验证或移除该验证方式。');
      await tx.totpCredential.deleteMany({ where: { userId } });
      await this.changed(tx, user, sessionId, 'user.totp_removed');
      return { removed: true };
    });
  }
  private async changed(tx: Prisma.TransactionClient, user: User, sessionId: string, action: string) {
    const updated = await tx.user.update({ where: { id: user.id }, data: { securityVersion: { increment: 1 } } });
    await tx.authChallenge.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.authSession.updateMany({ where: { userId: user.id, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.authSession.update({ where: { id: sessionId }, data: { securityVersion: updated.securityVersion } });
    await tx.auditLog.create({ data: { actorUserId: user.id, actorName: user.displayName, actorRole: compatibilityRole(await userRoles(tx, user.id)), action, targetType: 'User', targetId: user.id } });
  }

  async startEmail(userId: string, sessionId: string, token: string, address: unknown) {
    if (!validEmail(address)) throw new BadRequestException('请输入有效邮箱。');
    const normalized = address.toLowerCase();
    const result = await this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (await tx.verifiedEmail.findUnique({ where: { userId } })) throw new BadRequestException('请先解除原邮箱绑定。');
      const bindingToken = randomBytes(32).toString('base64url');
      await tx.authChallenge.create({ data: { tokenHash: sha256(bindingToken), browserHash: sha256(sessionId), userId, purpose: 'bind_email', firstMethod: 'local', securityVersion: user.securityVersion, payload: { address: normalized }, expiresAt: new Date(Date.now() + 5 * 60_000) } });
      const message = await this.emailOtp.prepare(tx, user, `bind:${sha256(bindingToken)}`, normalized);
      return { token: bindingToken, message };
    });
    await this.emailOtp.deliver(result.message);
    return { token: result.token };
  }
  async confirmEmail(userId: string, sessionId: string, token: string, code: unknown) {
    return this.withGrant(userId, sessionId, token, 'bind_email', async (tx, user, payload) => {
      if (!await this.emailOtp.consume(tx, user, `bind:${sha256(token)}`, code)) return { ok: false };
      const address = (payload as { address: string }).address;
      if (await tx.verifiedEmail.findUnique({ where: { address } })) return { ok: false };
      await tx.verifiedEmail.create({ data: { userId, address } });
      await this.changed(tx, user, sessionId, 'user.email_bound');
      return { ok: true };
    });
  }
  async removeEmail(userId: string, sessionId: string, token: string) {
    return this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (user.mfaEnabled && user.mfaMethods.includes('email')) throw new BadRequestException('请先关闭多因素验证或移除邮箱验证方式。');
      await tx.verifiedEmail.deleteMany({ where: { userId } });
      await this.changed(tx, user, sessionId, 'user.email_removed'); return { removed: true };
    });
  }
  async sendAuthorizationEmail(userId: string, sessionId: string) {
    const message = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { verifiedEmail: true } });
      if (!user.mfaEnabled || !user.mfaMethods.includes('email') || !user.verifiedEmail) throw new ForbiddenException('邮箱验证不可用。');
      return this.emailOtp.prepare(tx, user, `reauth:${sessionId}`, user.verifiedEmail.address);
    });
    await this.emailOtp.deliver(message); return { sent: true };
  }
  async startKey(userId: string, sessionId: string, token: string, name: unknown) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new BadRequestException('请输入密钥名称。');
    return this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (await tx.securityKey.count({ where: { userId } }) >= 10) throw new BadRequestException('最多绑定10把安全密钥。');
      const options = await this.keys.registrationOptions(tx, user); const bindingToken = randomBytes(32).toString('base64url');
      await tx.authChallenge.create({ data: { tokenHash: sha256(bindingToken), browserHash: sha256(sessionId), userId, purpose: 'bind_key', firstMethod: 'local', securityVersion: user.securityVersion,
        payload: { challenge: options.challenge, name: name.trim() }, expiresAt: new Date(Date.now() + 5 * 60_000) } });
      return { token: bindingToken, options };
    });
  }
  async confirmKey(userId: string, sessionId: string, token: string, response: unknown) {
    return this.withGrant(userId, sessionId, token, 'bind_key', async (tx, user, payload) => {
      const data = payload as { challenge: string; name: string };
      if (!await this.keys.register(tx, user, data.challenge, data.name, response)) return { ok: false };
      await this.changed(tx, user, sessionId, 'user.key_bound'); return { ok: true };
    });
  }
  async removeKey(userId: string, sessionId: string, token: string, id: unknown) {
    if (typeof id !== 'string' || id.length > 2048) throw new BadRequestException('密钥标识无效。');
    return this.withGrant(userId, sessionId, token, 'manage_security', async (tx, user) => {
      if (user.mfaEnabled && user.mfaMethods.includes('key') && await tx.securityKey.count({ where: { userId } }) <= 1) throw new BadRequestException('请先关闭多因素验证或移除安全密钥验证方式。');
      await tx.securityKey.deleteMany({ where: { id, userId } }); await this.changed(tx, user, sessionId, 'user.key_removed'); return { removed: true };
    });
  }
  async authorizationKey(userId: string, sessionId: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.mfaEnabled || !user.mfaMethods.includes('key')) throw new ForbiddenException('安全密钥验证不可用。');
      return this.keys.prepare(tx, user, `reauth:${sessionId}`);
    });
  }
}
