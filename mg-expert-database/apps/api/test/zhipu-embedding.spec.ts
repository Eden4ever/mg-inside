import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZhipuEmbedding, normalizeVector } from '../src/zhipu-embedding';
import { appendChunks, splitText } from '../src/semantic-source';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('智谱向量接口', () => {
  it('写入片段和读取问题均使用 embedding-3、1024 维，并按响应索引还原', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'test-key');
    const vector = Array(1024).fill(0); vector[0] = 2;
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }], usage: { total_tokens: 3 } }), { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const gateway = new ZhipuEmbedding();
    expect((await gateway.embed(['指标正文'])).vectors[0]![0]).toBe(1);
    mock.mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }] }), { status: 200 }));
    await gateway.embed(['怎么办理信用修复？']);
    for (const call of mock.mock.calls) expect(JSON.parse(call[1].body)).toMatchObject({ model: 'embedding-3', dimensions: 1024 });
  });
  it('未配置密钥不生成假向量，拒绝格式错误响应', async () => {
    vi.stubEnv('ZHIPU_API_KEY', '');
    await expect(new ZhipuEmbedding().embed(['正文'])).rejects.toThrow('ZHIPU_API_KEY');
    expect(() => normalizeVector([1])).toThrow();
    expect(() => normalizeVector(Array(1024).fill(0))).toThrow();
    expect(() => normalizeVector(Array(1024).fill(NaN))).toThrow();
  });
  it('按字节切分长文本且不丢正文，片段具有稳定标识', () => {
    const text = '中文😀abc'.repeat(1200);
    const parts = splitText(text);
    expect(parts.join('')).toBe(text);
    expect(parts.every(p => Buffer.byteLength(p) <= 1800)).toBe(true);
    const a: any[] = []; const b: any[] = [];
    appendChunks(a, 'node', '一级/二级', '口径', text, { revision: 1 });
    appendChunks(b, 'node', '一级/二级', '口径', text, { revision: 1 });
    expect(a).toEqual(b); expect(a.every(c => Buffer.byteLength(c.text) <= 2800)).toBe(true);
  });
});
