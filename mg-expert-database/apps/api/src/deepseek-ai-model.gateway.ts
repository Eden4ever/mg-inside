import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AiModelEvent, AiModelGateway, AiModelGatewayStatus } from './ai-model.gateway';

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';

@Injectable()
export class DeepSeekAiModelGateway implements AiModelGateway {
  status(): AiModelGatewayStatus {
    const configured = Boolean(this.apiKey() && this.model());
    return {
      configured,
      provider: configured ? 'deepseek-api' : null,
      model: configured ? this.model() : null,
      streaming: configured,
    };
  }

  async *stream(input: { instruction: string; content: string; signal?: AbortSignal }): AsyncGenerator<AiModelEvent> {
    const apiKey = this.apiKey();
    const model = this.model();
    if (!apiKey || !model) throw new ServiceUnavailableException('DeepSeek API 尚未完成配置。');

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs());

    try {
      const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: input.instruction },
            { role: 'user', content: input.content },
          ],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: this.maxOutputTokens(),
          temperature: 0.2,
        }),
      });

      if (!response.ok || !response.body) throw this.responseError(response.status);
      yield* this.readStream(response.body);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if ((error as Error).name === 'AbortError') {
        if (timedOut) throw new ServiceUnavailableException('DeepSeek API 响应超时。');
        throw new ServiceUnavailableException('模型生成已取消。');
      }
      throw new ServiceUnavailableException('DeepSeek API 暂不可用。');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private async *readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AiModelEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const chunk = this.parseChunk(data);
        if (!chunk) continue;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { type: 'delta', text };
        if (chunk.usage) {
          yield {
            type: 'usage',
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      }
    }
  }

  private parseChunk(data: string): {
    choices?: Array<{ delta?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  } | null {
    try {
      return JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
    } catch {
      return null;
    }
  }

  private responseError(status: number): ServiceUnavailableException {
    if (status === 401 || status === 403) return new ServiceUnavailableException('DeepSeek API 认证失败。');
    if (status === 402) return new ServiceUnavailableException('DeepSeek API 余额不足。');
    if (status === 429) return new ServiceUnavailableException('DeepSeek API 请求频率过高。');
    return new ServiceUnavailableException(`DeepSeek API 请求失败（${status}）。`);
  }

  private apiKey(): string {
    return process.env.DEEPSEEK_API_KEY?.trim() ?? '';
  }

  private model(): string {
    return process.env.DEEPSEEK_MODEL?.trim() ?? '';
  }

  private timeoutMs(): number {
    return Math.min(Math.max(Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS ?? 45_000), 5_000), 120_000);
  }

  private maxOutputTokens(): number {
    return Math.min(Math.max(Number(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS ?? 1_200), 128), 8_192);
  }
}
