import { MODULE_DEFINITIONS } from '../src/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiStreamEvent } from '@mg-expert/contracts';
import type { AiModelGateway } from '../src/ai-model.gateway';
import { UnconfiguredAiModelGateway } from '../src/ai-model.gateway';
import { AiService } from '../src/ai.service';

const workspace = {
  templateRevision: 1, moduleDefinitions: MODULE_DEFINITIONS,
      system: { name: '测试体系', year: 2026, version: 'V1', region: '测试区' },
  indicator: { code: 'L3', name: '三级指标', level1Name: '一级', level2Name: '二级' },
  modules: [{ moduleKey: 'portrait', revisionNo: 1, values: [{ fieldKey: 'assessment_scope', value: '联系人 13800138000', evidence: [{ id: 'e1', title: '政策依据', excerpt: '联系 test@example.com' }] }] }],
  recentRevisions: [{ id: 'r1', moduleKey: 'portrait' }],
};

describe('AiService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AI_MAX_REQUESTS_PER_USER_PER_MINUTE;
  });

  it('流式转发模型内容，脱敏上下文，并只创建待人工处理的候选建议', async () => {
    const created: Array<Record<string, unknown>> = [];
    const catalog = {
      requireResearchPermission: vi.fn().mockResolvedValue(undefined),
      workspace: vi.fn().mockResolvedValue(workspace),
      createSuggestion: vi.fn(async (_versionId: string, _nodeId: string, input: Record<string, unknown>) => { created.push(input); return { id: 'ai-1' }; }),
    };
    let gatewayInput = '';
    const gateway: AiModelGateway = {
      status: () => ({ configured: true, provider: 'test-provider', model: 'test-model', streaming: true }),
      async *stream(input) {
        gatewayInput = JSON.stringify(input);
        yield { type: 'delta', text: '建议补充' };
        yield { type: 'delta', text: '考核范围。' };
        yield { type: 'usage', inputTokens: 20, outputTokens: 6 };
      },
    };
    const service = new AiService(catalog as never, gateway);
    const events: AiStreamEvent[] = [];
    await service.generate('v1', 'n1', { moduleKey: 'portrait', prompt: '检查考核范围', modelProcessingConfirmed: true }, { userId: 'u1', name: '研究员', role: 'researcher' }, (event) => events.push(event));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'delta', text: '建议补充' }),
      expect.objectContaining({ type: 'completed', suggestionId: 'ai-1', status: 'pending' }),
    ]));
    expect(created[0]).toMatchObject({ content: '建议补充考核范围。', fieldKey: 'assessment_scope', modelId: 'test-model', promptVersion: 'indicator-expert-v1' });
    expect(created[0]).not.toHaveProperty('status');
    expect(gatewayInput).not.toContain('13800138000');
    expect(gatewayInput).not.toContain('test@example.com');
    expect(gatewayInput).toContain('[已脱敏手机号]');
    expect(gatewayInput).toContain('[已脱敏邮箱]');
  });

  it('未配置模型时拒绝生成且不访问工作区', async () => {
    const catalog = { workspace: vi.fn(), createSuggestion: vi.fn() };
    const service = new AiService(catalog as never, new UnconfiguredAiModelGateway());
    await expect(service.generate('v1', 'n1', { moduleKey: 'portrait', prompt: '生成建议', modelProcessingConfirmed: true }, { userId: 'u1', name: '研究员', role: 'researcher' }, () => undefined)).rejects.toThrow('尚未完成配置');
    expect(catalog.workspace).not.toHaveBeenCalled();
  });

  it('未逐次确认外部处理时不读取研究工作区', async () => {
    const catalog = { workspace: vi.fn(), createSuggestion: vi.fn() };
    const gateway: AiModelGateway = {
      status: () => ({ configured: true, provider: 'test-provider', model: 'test-model', streaming: true }),
      async *stream() { yield { type: 'delta', text: '不会调用' }; },
    };
    const service = new AiService(catalog as never, gateway);
    await expect(service.generate('v1', 'n1', { moduleKey: 'portrait', prompt: '生成建议' }, { userId: 'u1', name: '研究员', role: 'researcher' }, () => undefined)).rejects.toThrow('必须确认');
    expect(catalog.workspace).not.toHaveBeenCalled();
  });

  it('超过每用户分钟请求上限时拒绝继续调用模型', async () => {
    process.env.AI_MAX_REQUESTS_PER_USER_PER_MINUTE = '1';
    const catalog = { requireResearchPermission: vi.fn().mockResolvedValue(undefined), workspace: vi.fn().mockResolvedValue(workspace), createSuggestion: vi.fn().mockResolvedValue({ id: 'ai-1' }) };
    const gateway: AiModelGateway = {
      status: () => ({ configured: true, provider: 'test-provider', model: 'test-model', streaming: true }),
      async *stream() { yield { type: 'delta', text: '合成建议' }; },
    };
    const service = new AiService(catalog as never, gateway);
    const input = { moduleKey: 'portrait' as const, prompt: '生成建议', modelProcessingConfirmed: true };
    const actor = { userId: 'u1', name: '研究员', role: 'researcher' as const };
    await service.generate('v1', 'n1', input, actor, () => undefined);
    await expect(service.generate('v1', 'n1', input, actor, () => undefined)).rejects.toThrow('过于频繁');
    expect(catalog.workspace).toHaveBeenCalledTimes(1);
  });
});
