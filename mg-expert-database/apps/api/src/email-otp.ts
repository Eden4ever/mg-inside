import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { MailConfigService } from './mail-config';
import { secretDigest } from './security-secrets';

@Injectable()
export class EmailOtpService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(MailConfigService) private readonly mail: MailConfigService) {}
  // 调用者先锁定用户行；全局锁仅保护短暂的发信额度分配，不跨网络请求。
  async prepare(tx: Prisma.TransactionClient, user: User, scope: string, address: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(741029)::text`;
    const since = new Date(Date.now() - 60_000);
    const [all, own] = await Promise.all([
      tx.authChallenge.count({ where: { purpose: 'email_code', createdAt: { gt: since } } }),
      tx.authChallenge.count({ where: { purpose: 'email_code', userId: user.id, createdAt: { gt: since } } }),
    ]);
    if (all >= 30 || own >= 1) throw new HttpException('验证码发送过于频繁，请稍后重试。', 429);
    await tx.authChallenge.updateMany({ where: { purpose: 'email_code', userId: user.id, usedAt: null, payload: { path: ['scope'], equals: scope } }, data: { usedAt: new Date() } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const row = await tx.authChallenge.create({ data: { tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'), browserHash: '', userId: user.id,
      purpose: 'email_code', firstMethod: 'email', securityVersion: user.securityVersion, expiresAt: new Date(Date.now() + 5 * 60_000),
      payload: { scope, address, digest: secretDigest(code, `email:${user.id}:${scope}`) } } });
    return { id: row.id, address, code };
  }
  async deliver(message: { id: string; address: string; code: string }) {
    try { await this.mail.send(message.address, '身份验证码', `您的验证码为 ${message.code}，5分钟内有效。请勿向他人透露，非本人操作请忽略。`); }
    catch (error) { await this.db.authChallenge.updateMany({ where: { id: message.id }, data: { usedAt: new Date() } }); throw error; }
  }
  async consume(tx: Prisma.TransactionClient, user: User, scope: string, code: unknown): Promise<boolean> {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    const row = await tx.authChallenge.findFirst({ where: { userId: user.id, purpose: 'email_code', usedAt: null, securityVersion: user.securityVersion, expiresAt: { gt: new Date() }, payload: { path: ['scope'], equals: scope } }, orderBy: { createdAt: 'desc' } });
    if (!row || row.attempts >= 5) return false;
    const expected = (row.payload as { digest: string }).digest;
    const actual = secretDigest(code, `email:${user.id}:${scope}`);
    const valid = expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    await tx.authChallenge.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, ...(valid ? { usedAt: new Date() } : {}) } });
    return valid;
  }
}
