import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, OnModuleInit, Post, Put, Req, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { actorFromRequest, AuthenticatedRequest, requireRole } from './auth';
import { PrismaService } from './prisma.service';

@Injectable()
export class ModelConfigService implements OnModuleInit {
  private value: { key: string; enabled: boolean; revision: number; source: string; error?: string } = { key: '', enabled: true, revision: 0, source: 'environment' };
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async onModuleInit() { await this.refresh(); }
  get configured() { return this.value.enabled && Boolean(this.value.key); }
  get apiKey() { return this.configured ? this.value.key : ''; }
  private masterKey(create = false): Buffer {
    const path = process.env.MODEL_CONFIG_KEY_FILE || (process.env.NODE_ENV === 'production' ? '/opt/mg-expert-database/shared/model-config.key' : resolve(process.cwd(), '.runtime/model-config.key'));
    try { const key = readFileSync(path); if (key.length !== 32) throw new Error(); return key; }
    catch (e) {
      if (!create || (e as NodeJS.ErrnoException).code !== 'ENOENT') throw new ServiceUnavailableException('模型配置解密密钥不可用，请检查服务端密钥文件');
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try { writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ServiceUnavailableException('无法创建服务端密钥文件，请检查目录权限'); }
      return readFileSync(path);
    }
  }
  private encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.masterKey(true), iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.'); }
  private decrypt(value: string) { const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64')); if (!iv || !tag || !data) throw new Error(); const cipher = createDecipheriv('aes-256-gcm', this.masterKey(), iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8'); }
  async refresh() {
    const row = await this.db.embeddingModelConfig.findUnique({ where: { id: 'zhipu-embedding' } });
    if (!row) { this.value = { key: process.env.ZHIPU_API_KEY?.trim() || '', enabled: true, revision: 0, source: 'environment' }; return; }
    try { this.value = { key: this.decrypt(row.encryptedKey), enabled: row.enabled, revision: row.revision, source: 'database' }; }
    catch { this.value = { key: '', enabled: row.enabled, revision: row.revision, source: 'database', error: '配置无法解密，请恢复密钥文件或重新保存 API Key' }; }
  }
  read() { return { provider: '智谱', model: 'embedding-3', dimensions: 1024, endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings', enabled: this.value.enabled, configured: this.configured, hasKey: Boolean(this.value.key), revision: this.value.revision, source: this.value.source, error: this.value.error }; }
  async save(input: { apiKey?: string; enabled: boolean; revision: number }, req: AuthenticatedRequest) {
    requireRole(actorFromRequest(req), ['system_admin']);
    if (typeof input.enabled !== 'boolean' || !Number.isInteger(input.revision)) throw new BadRequestException('模型配置参数不正确');
    const key = input.apiKey === undefined || input.apiKey === '' ? this.value.key : input.apiKey;
    if (typeof key !== 'string' || !key.trim() || key.length > 2048 || /\s/.test(key.trim())) throw new BadRequestException('请输入有效的 API Key');
    const encryptedKey = this.encrypt(key.trim());
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741026)::text`;
      const old = await tx.embeddingModelConfig.findUnique({ where: { id: 'zhipu-embedding' } });
      if ((old?.revision || 0) !== input.revision) throw new ConflictException('配置已更新，请刷新后重试');
      await tx.embeddingModelConfig.upsert({ where: { id: 'zhipu-embedding' }, create: { id: 'zhipu-embedding', encryptedKey, enabled: input.enabled }, update: { encryptedKey, enabled: input.enabled, revision: { increment: 1 } } });
      const actor = actorFromRequest(req);
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action: 'embedding_model.updated', targetType: 'EmbeddingModelConfig', targetId: 'zhipu-embedding', detail: { enabled: input.enabled, keyChanged: Boolean(input.apiKey) } } });
    });
    await this.refresh(); return this.read();
  }
}
