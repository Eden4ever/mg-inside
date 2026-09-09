import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import nodemailer from 'nodemailer';
import type { Actor } from './auth';
import { PrismaService } from './prisma.service';
import { decryptSecret, encryptSecret } from './security-secrets';

export interface MailConfigInput {
  enabled: boolean; host: string; port: number; security: 'tls' | 'starttls';
  username: string; password?: string; fromAddress: string; fromName: string; revision: number;
}
function requireMailAdmin(actor: Actor) {
  if (actor.role !== 'system_admin') throw new ForbiddenException('仅系统管理员可维护邮件设置。');
}
export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(value);
}
export function publicMailAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

@Injectable()
export class MailConfigService {
  private inFlight = 0;
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async read(actor: Actor) {
    requireMailAdmin(actor);
    const row = await this.db.mailConfig.findUnique({ where: { id: 'smtp' } });
    if (!row) return { enabled: false, host: '', port: 465, security: 'tls', username: '', fromAddress: '', fromName: '营商环境指标知识库', revision: 0, hasPassword: false };
    const { encryptedPassword, lastTestAt, updatedAt, id, ...view } = row;
    return { ...view, hasPassword: Boolean(encryptedPassword) };
  }
  async save(input: MailConfigInput, actor: Actor) {
    requireMailAdmin(actor);
    if (!input || typeof input.enabled !== 'boolean' || !Number.isInteger(input.revision)
      || typeof input.host !== 'string' || input.host.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(input.host)
      || ![465, 587, 25].includes(input.port) || !['tls', 'starttls'].includes(input.security)
      || (input.port === 465 && input.security !== 'tls') || (input.port !== 465 && input.security !== 'starttls')
      || typeof input.username !== 'string' || !input.username || input.username.length > 254 || /[\r\n]/.test(input.username)
      || !validEmail(input.fromAddress) || typeof input.fromName !== 'string' || input.fromName.length > 100 || /[\r\n]/.test(input.fromName)
      || (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 2048))) throw new BadRequestException('邮件配置参数不正确。');
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741028)::text`;
      const old = await tx.mailConfig.findUnique({ where: { id: 'smtp' } });
      if ((old?.revision ?? 0) !== input.revision) throw new ConflictException('邮件配置已更新，请刷新后重试。');
      if (!input.password && !old?.encryptedPassword) throw new BadRequestException('请输入 SMTP 密码或授权码。');
      // 改变目的服务器时不能沿用旧密码，避免将已保存凭据发送给新主机。
      if (!input.password && old && (old.host !== input.host.toLowerCase() || old.username !== input.username)) throw new BadRequestException('修改服务器或账号时请重新输入密码。');
      const data = { enabled: input.enabled, host: input.host.toLowerCase(), port: input.port, security: input.security,
        username: input.username, fromAddress: input.fromAddress, fromName: input.fromName,
        encryptedPassword: input.password ? encryptSecret(input.password, 'smtp-password') : old!.encryptedPassword };
      await tx.mailConfig.upsert({ where: { id: 'smtp' }, create: { id: 'smtp', ...data }, update: { ...data, revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role,
        action: 'mail_config.updated', targetType: 'MailConfig', targetId: 'smtp', detail: { enabled: input.enabled, passwordChanged: Boolean(input.password) } } });
    });
    return this.read(actor);
  }
  async test(to: string, actor: Actor) {
    requireMailAdmin(actor);
    if (!validEmail(to)) throw new BadRequestException('请输入有效的测试收件邮箱。');
    const result = await this.db.mailConfig.updateMany({ where: { id: 'smtp', enabled: true,
      OR: [{ lastTestAt: null }, { lastTestAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { lastTestAt: new Date() } });
    if (!result.count) throw new HttpException('请启用邮件配置，或等待一分钟后重试。', 429);
    await this.send(to, '邮件发送测试', '这是一封营商环境指标知识库测试邮件，无需回复。');
    return { ok: true, message: '邮件服务器已接受发送，请检查收件箱或垃圾邮件。' };
  }
  async send(to: string, subject: string, text: string): Promise<void> {
    if (!validEmail(to)) throw new BadRequestException('收件邮箱无效。');
    if (this.inFlight >= 3) throw new HttpException('邮件服务繁忙，请稍后重试。', 429);
    this.inFlight++;
    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    try {
      const config = await this.db.mailConfig.findUnique({ where: { id: 'smtp' } });
      if (!config?.enabled) throw new ServiceUnavailableException('邮箱验证尚未启用。');
      const addresses = await lookup(config.host, { all: true });
      if (!addresses.length || addresses.some(value => !publicMailAddress(value.address))) throw new ServiceUnavailableException('邮件服务器必须使用公网地址。');
      transport = nodemailer.createTransport({ host: addresses[0]!.address, port: config.port,
        secure: config.security === 'tls', requireTLS: true,
        tls: { servername: config.host, minVersion: 'TLSv1.2', rejectUnauthorized: true },
        auth: { user: config.username, pass: decryptSecret(config.encryptedPassword, 'smtp-password') },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
        disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
      const result = await transport.sendMail({ from: { name: config.fromName, address: config.fromAddress }, to, subject, text });
      if (!result.accepted?.length) throw new Error();
    } catch { throw new ServiceUnavailableException('邮件发送失败，请检查 SMTP 配置、证书及服务商限制。'); }
    finally { transport?.close(); this.inFlight--; }
  }
}
