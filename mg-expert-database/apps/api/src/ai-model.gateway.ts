import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type AiModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number };

export interface AiModelGatewayStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  streaming: boolean;
}

export interface AiModelGateway {
  status(): AiModelGatewayStatus;
  stream(input: { instruction: string; content: string; signal?: AbortSignal }): AsyncGenerator<AiModelEvent>;
}

export const AI_MODEL_GATEWAY = Symbol('AI_MODEL_GATEWAY');

@Injectable()
export class UnconfiguredAiModelGateway implements AiModelGateway {
  status(): AiModelGatewayStatus {
    return { configured: false, provider: null, model: null, streaming: false };
  }

  async *stream(): AsyncGenerator<AiModelEvent> {
    throw new ServiceUnavailableException('AI 服务尚未完成配置。');
  }
}
