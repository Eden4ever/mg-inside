import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailConfigService, publicMailAddress, validEmail } from '../src/mail-config';
import { decryptSecret } from '../src/security-secrets';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), createTransport: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));
const actor = { userId: 'admin', name: '管理员', role: 'system_admin' as const };
const input = { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls' as const, username: 'sender', password: 'test-password', fromAddress: 'sender@example.com', fromName: '知识库', revision: 0 };

function fixture() {
  let row: any = null;
  const db: any = { mailConfig: {
    findUnique: vi.fn(async () => row),
    upsert: vi.fn(async ({ create, update }: any) => { row = row ? { ...row, ...update, revision: row.revision + 1 } : { ...create, revision: 1 }; }),
    updateMany: vi.fn(async () => ({ count: 1 })),
  }, auditLog: { create: vi.fn() }, $queryRaw: vi.fn() };
  db.$transaction = (callback: any) => callback(db);
  return { db, service: new MailConfigService(db), row: () => row };
}
describe('邮件管理安全边界', () => {
  let directory: string;
  beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'mg-mail-test-')); vi.stubEnv('AUTH_CONFIG_KEY_FILE', join(directory, 'auth.key')); });
  afterAll(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true }); });
  it('密码加密保存，不回显，修改目标主机必须重输密码', async () => {
    const { service, row } = fixture();
    const view = await service.save(input, actor);
    expect(JSON.stringify(view)).not.toContain('test-password');
    expect(row().encryptedPassword).not.toContain('test-password');
    expect(decryptSecret(row().encryptedPassword, 'smtp-password')).toBe('test-password');
    expect(() => decryptSecret(row().encryptedPassword, 'totp')).toThrow();
    await expect(service.save({ ...input, host: 'other.example.com', password: '', revision: 1 }, actor)).rejects.toThrow('重新输入密码');
    await expect(service.save({ ...input, password: '', revision: 1 }, actor)).resolves.toMatchObject({ revision: 2 });
    await expect(service.save(input, actor)).rejects.toThrow('配置已更新');
  });
  it('非管理员不可读取、修改或测试配置', async () => {
    const { service, db } = fixture();
    const reader = { ...actor, role: 'reader' as const };
    await expect(service.read(reader)).rejects.toThrow();
    await expect(service.save(input, reader)).rejects.toThrow();
    await expect(service.test('test@example.com', reader)).rejects.toThrow();
    expect(db.mailConfig.findUnique).not.toHaveBeenCalled();
  });
  it('拒绝多收件人、邮件头注入、内网和 IPv4 映射地址', () => {
    expect(validEmail('a@example.com,b@example.com')).toBe(false);
    expect(validEmail('a@example.com\r\nBcc:x@example.com')).toBe(false);
    expect(validEmail('a@example.com')).toBe(true);
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) expect(publicMailAddress(address)).toBe(false);
    expect(publicMailAddress('8.8.8.8')).toBe(true);
  });
  it('固定公网解析结果、要求证书验证，失败响应不泄露凭据', async () => {
    const { service } = fixture();
    await service.save(input, actor);
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const close = vi.fn(); const sendMail = vi.fn().mockResolvedValue({ accepted: ['test@example.com'] });
    mocks.createTransport.mockReturnValue({ sendMail, close });
    await service.test('test@example.com', actor);
    expect(mocks.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: '8.8.8.8', secure: true, requireTLS: true, tls: { servername: input.host, minVersion: 'TLSv1.2', rejectUnauthorized: true } }));
    expect(close).toHaveBeenCalled();
    sendMail.mockRejectedValue(new Error('test-password secret protocol failure'));
    await expect(service.send('test@example.com', '测试', '测试')).rejects.toThrow('邮件发送失败');
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    mocks.createTransport.mockClear();
    await expect(service.send('test@example.com', '测试', '测试')).rejects.toThrow();
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
  it('数据库频率门禁未通过时不发送测试邮件', async () => {
    const { service, db } = fixture();
    db.mailConfig.updateMany.mockResolvedValue({ count: 0 });
    const send = vi.spyOn(service, 'send');
    await expect(service.test('test@example.com', actor)).rejects.toThrow('等待一分钟');
    expect(send).not.toHaveBeenCalled();
  });
});
