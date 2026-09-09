import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekAiModelGateway } from '../src/deepseek-ai-model.gateway';

describe('DeepSeekAiModelGateway', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_REQUEST_TIMEOUT_MS;
    delete process.env.DEEPSEEK_MAX_OUTPUT_TOKENS;
  });

  it('未同时配置密钥和模型时保持不可用', () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    expect(new DeepSeekAiModelGateway().status()).toEqual({
      configured: false,
      provider: null,
      model: null,
      streaming: false,
    });
  });

  it('使用官方端点和 Bearer 鉴权并解析 SSE 内容及用量', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
    let requestedUrl = '';
    let authorization = '';
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        'data: {"choices":[{"delta":{"content":"建议"}}],"usage":null}\n\n' +
        'data: {"choices":[{"delta":{"content":"正文"}}],"usage":null}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":18,"completion_tokens":5}}\n\n' +
        'data: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }));

    const gateway = new DeepSeekAiModelGateway();
    const events = [];
    for await (const event of gateway.stream({ instruction: '系统要求', content: '研究内容' })) events.push(event);

    expect(requestedUrl).toBe('https://api.deepseek.com/chat/completions');
    expect(authorization).toBe('Bearer test-key');
    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: '系统要求' },
        { role: 'user', content: '研究内容' },
      ],
    });
    expect(events).toEqual([
      { type: 'delta', text: '建议' },
      { type: 'delta', text: '正文' },
      { type: 'usage', inputTokens: 18, outputTokens: 5 },
    ]);
  });

  it('不把认证响应正文或密钥暴露到错误信息', async () => {
    process.env.DEEPSEEK_API_KEY = 'secret-test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"secret-test-key invalid"}}', { status: 401 })));
    const gateway = new DeepSeekAiModelGateway();

    await expect(async () => {
      for await (const _event of gateway.stream({ instruction: '系统要求', content: '研究内容' })) void _event;
    }).rejects.toThrow('DeepSeek API 认证失败');
  });

  it('把供应商限流映射为稳定的业务错误', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 })));

    await expect(async () => {
      for await (const _event of new DeepSeekAiModelGateway().stream({ instruction: '系统要求', content: '合成内容' })) void _event;
    }).rejects.toThrow('DeepSeek API 请求频率过高');
  });

  it('达到配置超时时间后中断供应商请求', async () => {
    vi.useFakeTimers();
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
    process.env.DEEPSEEK_REQUEST_TIMEOUT_MS = '5000';
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })));

    const request = (async () => {
      for await (const _event of new DeepSeekAiModelGateway().stream({ instruction: '系统要求', content: '合成内容' })) void _event;
    })();
    const rejection = expect(request).rejects.toThrow('DeepSeek API 响应超时');
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });
});
