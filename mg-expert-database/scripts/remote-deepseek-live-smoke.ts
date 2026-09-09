import { DeepSeekAiModelGateway } from '/opt/mg-expert-database/current/apps/api/src/deepseek-ai-model.gateway';

async function main() {
  const gateway = new DeepSeekAiModelGateway();
  const status = gateway.status();
  if (!status.configured) throw new Error('DeepSeek gateway is not configured for the smoke process.');

  const startedAt = Date.now();
  let deltaEvents = 0;
  let output = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const event of gateway.stream({
    instruction: '你是接口连通性测试助手。只返回一个 JSON 对象，格式为 {"result":"ok"}，不要添加说明。',
    content: '这是合成测试数据，不包含任何真实业务信息。',
  })) {
    if (event.type === 'delta') {
      deltaEvents += 1;
      output += event.text;
    } else {
      inputTokens = event.inputTokens;
      outputTokens = event.outputTokens;
    }
  }

  let jsonResult = false;
  try {
    const parsed = JSON.parse(output) as { result?: unknown };
    jsonResult = parsed.result === 'ok';
  } catch {
    jsonResult = false;
  }

  const result = {
    configured: status.configured,
    provider: status.provider,
    model: status.model,
    streaming: status.streaming,
    deltaEvents,
    outputCharacters: output.length,
    inputTokens,
    outputTokens,
    jsonResult,
    durationMs: Date.now() - startedAt,
  };

  console.log(JSON.stringify(result));
  if (!deltaEvents || !output.length || !inputTokens || !outputTokens || !jsonResult) process.exitCode = 2;
}

void main();
