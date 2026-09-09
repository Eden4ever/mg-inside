import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ModelConfigService } from './model-config';

export const EMBEDDING_MODEL = 'embedding-3';
export const EMBEDDING_DIMENSIONS = 1024;

export function normalizeVector(input: unknown): number[] {
  if (!Array.isArray(input) || input.length !== EMBEDDING_DIMENSIONS || input.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('智谱返回的向量格式不正确');
  const norm = Math.hypot(...input);
  if (!norm) throw new Error('智谱返回空向量');
  return input.map(v => v / norm);
}

@Injectable()
export class ZhipuEmbedding {
  constructor(@Optional() @Inject(ModelConfigService) private readonly config?: ModelConfigService) {}
  get configured() { return this.config ? this.config.configured : Boolean(process.env.ZHIPU_API_KEY?.trim()); }
  async embed(input: string[]): Promise<{ vectors: number[][]; tokens: number }> {
    await this.config?.refresh();
    if (!this.configured) throw new ServiceUnavailableException('尚未配置后端 ZHIPU_API_KEY');
    if (!input.length || input.length > 16 || input.some(t => !t.trim() || Buffer.byteLength(t, 'utf8') > 2800)) throw new Error('向量化输入超出限制');
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${this.config ? this.config.apiKey : process.env.ZHIPU_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, input }),
        });
      } catch { if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; } throw new Error('智谱连接失败或超时，请重试'); }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) { await response.body?.cancel(); await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
        // 不回传供应商原始响应，避免泄露输入和密钥。
        throw new Error(`智谱请求失败（HTTP ${response.status}），请检查余额、密钥和调用限额`);
      }
      const payload = await response.json() as { data?: { index: number; embedding: unknown }[]; usage?: { total_tokens?: number } };
      if (!Array.isArray(payload.data) || payload.data.length !== input.length) throw new Error('智谱返回的向量数量不匹配');
      const rows = [...payload.data].sort((a, b) => a.index - b.index);
      if (rows.some((row, i) => row.index !== i)) throw new Error('智谱返回的向量索引不匹配');
      return { vectors: rows.map(row => normalizeVector(row.embedding)), tokens: Math.max(0, Number(payload.usage?.total_tokens) || 0) };
    }
    throw new Error('智谱暂不可用');
  }
}
