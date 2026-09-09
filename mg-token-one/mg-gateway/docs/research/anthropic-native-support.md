# Anthropic Messages API 原生支持研究

> 研究日期：2026-08-19
>
> 目标：为 Token One 增加 Anthropic Messages API 原生渠道。这里的“原生”是保留 Anthropic 的请求、响应、事件和错误契约，不把 Anthropic 请求转换为 OpenAI Chat Completions 或 Responses，也不把响应包装成另一种协议。

## 结论摘要

- 对外新增 `POST /v1/messages`，上游同样调用 `/v1/messages`。
- Anthropic 的鉴权不是 OpenAI 的 `Authorization: Bearer`：客户端使用 `x-api-key`，请求还需要 `anthropic-version`；`anthropic-beta` 是可选的能力声明头。
- `system`、消息 content blocks、`tools`、`tool_choice`、`thinking` 必须作为 Anthropic 结构原样传递。网关只允许替换映射后的顶层 `model`，不做字段转换或重排。
- `stream=true` 时必须按 SSE 原始事件透传，至少覆盖 `message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`，并允许穿插 `ping` 和 `error`。
- 上游错误应保留 HTTP 状态、JSON body、`Content-Type` 和 `request-id`，不能改写成 OpenAI 错误格式。
- Anthropic 有官方 `GET /v1/models`，但模型对象没有足够的协议、工具或 thinking 能力字段；Token One 仍需使用自己的模型能力元数据和渠道协议声明。
- 当前 CCTQ-Claude 已拒绝普通 Chat 和简单 Messages 探测并要求标准 Claude Code 客户端。它应作为供应商特定的兼容性问题单独验证，不能据此改变 Anthropic 标准协议实现。

## 官方事实

以下链接均为 Anthropic 官方文档或官方 SDK 源码；旧域名 `docs.anthropic.com` 与新文档域名的同路径页面语义一致。

### 请求与鉴权

官方创建消息接口是 `POST https://api.anthropic.com/v1/messages`。请求头要求：

```http
x-api-key: <api-key>
anthropic-version: 2023-06-01
content-type: application/json
```

`anthropic-beta` 可选，可以声明一个或多个 beta 能力。`anthropic-version` 是 Anthropic API 版本，不应与模型版本或网关自身版本混用。

核心请求字段：

```json
{
  "model": "claude-...",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "system": "You are helpful",
  "stream": true,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather",
      "input_schema": {"type": "object", "properties": {}}
    }
  ],
  "tool_choice": {"type": "auto"},
  "thinking": {"type": "enabled", "budget_tokens": 2048}
}
```

`model`、`max_tokens`、`messages` 是核心必填字段。`messages[].role` 只使用 `user` 或 `assistant`；system prompt 是顶层 `system` 字段，不是 `messages` 中的 `system` role。`content` 可以是字符串，也可以是 content block 数组。实现必须继续接受文本、图片、工具结果、thinking 和供应商后续新增的 block 类型。

`tools` 使用 Anthropic 的 `name`、`description`、`input_schema`（JSON Schema），不能直接套用 OpenAI 的 `function.parameters`。工具选择包括 `auto`、`any`、指定 `tool`，并可带 `disable_parallel_tool_use`。工具调用通过 assistant 的 `tool_use` block 返回，客户端把结果作为后续 user 的 `tool_result` block 发送。

`thinking` 至少包含 `{"type":"enabled","budget_tokens":...}`；较新的模型/版本可能提供 `adaptive` 等模式。网关不应枚举未知模式后丢弃，而应按版本和能力配置决定是否透传。

来源：

- [Messages API](https://platform.claude.com/docs/en/api/messages)
- [API versioning](https://platform.claude.com/docs/en/api/versioning)
- [Beta headers](https://platform.claude.com/docs/en/api/beta-headers)
- [官方 TypeScript SDK Messages 类型](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)

### 非流式响应与 usage

成功响应是 Anthropic `Message` 对象：

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "claude-...",
  "content": [{"type": "text", "text": "Hello"}],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 12,
    "output_tokens": 7
  }
}
```

`content` 是 block 数组，不应被压缩成一个字符串。常见 block 包括 `text`、`tool_use`、`thinking` 和 `redacted_thinking`。`stop_reason` 可能是 `end_turn`、`max_tokens`、`stop_sequence`、`tool_use`，也可能随模型能力出现 `pause_turn`、`refusal` 等值；未知值应保留。

计量至少读取 `usage.input_tokens` 与 `usage.output_tokens`。缓存和服务器工具可能增加 `cache_creation_input_tokens`、`cache_read_input_tokens`、`server_tool_use`、`service_tier` 等字段。计量器只提取已知数值字段，原始响应仍完整返回，不能因为出现新 usage 字段而判定响应无效。

### SSE 事件

`stream=true` 返回 `Content-Type: text/event-stream`。标准事件序列为：

| 顺序 | 事件 | 作用 |
| --- | --- | --- |
| 1 | `message_start` | 消息外壳和初始 usage |
| 2 | `content_block_start` | 开始一个内容 block |
| 3 | `content_block_delta` | 增量文本、工具 JSON、thinking 或签名 |
| 4 | `content_block_stop` | 结束当前 block |
| 5 | `message_delta` | stop reason/sequence 与最终累计 usage |
| 6 | `message_stop` | 消息结束 |

`ping` 可以穿插在上述事件之间。`content_block_delta.delta.type` 至少需要支持 `text_delta`、`input_json_delta`、`thinking_delta`、`signature_delta`；模型能力扩展时还可能出现 citations 等 delta。流式错误使用 `event: error`，其 data 仍是 Anthropic error envelope。

网关应复制每个 SSE chunk 的原始字节，包括 `event:`、`id:`、`data:`、注释和空行，不要只解析 `data:` 再重新生成事件。这样可以保留事件名、顺序、未知字段和客户端重连语义。旁路解析只用于首 token、usage 和审计指标。

来源：[Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)

### 错误

Anthropic 错误的 JSON 形状是：

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "..."
  },
  "request_id": "req_..."
}
```

官方错误页明确列出的稳定集合至少包括：`400 invalid_request_error`、`401 authentication_error`、`403 permission_error`、`404 not_found_error`、`413 request_too_large`、`429 rate_limit_error`、`500 api_error`、`529 overloaded_error`。服务未来可能增加状态或错误类型，代理不得依赖封闭枚举。流式错误使用同一 envelope，但作为 SSE `error` 事件发送。

响应中的 `request-id`/`request_id` 都应在网关边界保留：前者是 HTTP header，后者是 body 字段。错误代理不应把上游 body 改写成 `{error:{message,type,code}}` 等 OpenAI 形状。

来源：[Errors](https://platform.claude.com/docs/en/api/errors)

### 模型发现

Anthropic 提供 `GET https://api.anthropic.com/v1/models` 和单模型查询。请求仍使用 `x-api-key` 与 `anthropic-version`，支持 `before_id`、`after_id`、`limit` 分页；响应包含 `data`、`has_more`、`first_id`、`last_id`，模型对象核心字段为 `type=model`、`id`、`display_name`、`created_at`。

该对象没有可依赖的 `chat`/`responses`/`anthropic` 协议能力，也没有稳定的工具或 thinking 能力矩阵。因此 Token One 的 `/v1/models` 必须从“渠道协议 + 模型配置”生成，而不是把上游模型列表直接当成能力发现结果。

来源：[List Models](https://platform.claude.com/docs/en/api/models/list)

## 对 Token One 的设计影响

### 路由与协议边界

1. 将 `anthropic` 作为独立的 `RelayProtocol`，新增 `POST /v1/messages`；现有 `/v1/chat/completions` 和 `/v1/responses` 路径继续只选择对应协议渠道。
2. 同一个渠道可以声明 `protocols: ["chat", "responses", "anthropic"]`，但每个端点必须独立探测和计量。`channel.type` 只能表示凭据/供应商配置模板，不能替代协议能力。
3. `/v1/models` 存在响应形状冲突：OpenAI 客户端期望 `{object:"list",data:[...]}`，Anthropic 客户端期望 Anthropic 分页对象。优先按鉴权头/版本头判定 Anthropic 请求并返回 Anthropic 形状；无法可靠判定时宁可增加显式 provider 路径或返回明确错误，不要让一个响应同时伪装两种协议。

### 鉴权与上游头

- 网关入口接受并验证客户端 `x-api-key`（网关 token）；为保持现有 OpenAI 客户端兼容，Bearer 仍只用于 OpenAI 端点。
- Anthropic transport 向上游注入渠道密钥为 `x-api-key`，并转发经过白名单校验的 `anthropic-version`、`anthropic-beta`。绝不能把客户端网关 token 原样转发为上游凭据。
- 原始 Authorization、x-api-key、工具输入、thinking 内容和 prompt 不进入普通请求日志；调试抓包必须脱敏并限制在本地 fixture。

### Transport 与数据完整性

- 新建 `AnthropicMessagesTransport`，与 Chat/Responses transport 对称；唯一职责是构造 `/v1/messages` URL、注入 Anthropic headers、替换 `model`、转发 JSON/SSE、提取最小 usage。
- 非流式响应原样发送；流式响应按字节透传；错误保留 status/body/content-type/request-id。
- Relay 编排层只消费协议无关的 `RelayResult` 和计量摘要，不在主服务中解析 Anthropic content blocks。
- `usage` 映射到内部 accounting 时仅使用 input/output token 数；保留原始 usage 或扩展 JSON 供审计，避免缓存 token 或 server tool 使用被静默丢失。

### 模型能力与后台配置

现有 `supportsTools`、`supportsReasoning` 可复用于 Anthropic，但 `supportsResponses` 不能表示 Messages。建议增加 `supportsAnthropic`（或更通用的协议能力集合）并在渠道绑定层同时校验模型能力和 `protocols`。后台测试请求必须根据协议发送最小合法请求：Anthropic 请求必须有 `max_tokens`、`messages`、`anthropic-version`，不能复用 Chat 的 body。

## 分阶段实施计划

### P0：协议契约与安全边界

- 固化 DTO/类型：Messages request、Message response、SSE event、Anthropic error envelope；未知 block/event/usage 字段宽松保留。
- 扩展协议枚举、渠道池选择、请求日志和 `/v1/models` 能力过滤。
- 为 token middleware 增加 `x-api-key` 入口，建立上游 header 白名单和敏感值脱敏规则。

### P1：原生 transport 与主链

- 实现 `AnthropicMessagesTransport`，禁止调用任何 Chat/Responses converter。
- 将成功、上游错误、客户端断开、SSE 中止分别写入协议维度调用日志；结算只对可确认 usage 结算。
- 增加真实 Nest + 隔离数据库 + 假 Anthropic 上游 E2E：非流式、SSE 全事件、未知 block、工具调用、thinking、错误状态透传、模型映射和 token 计量。

### P2：模型发现和管理界面

- `/v1/models` 按 Anthropic 形状生成配置模型，分页参数行为可预测；不要宣称上游列表包含能力。
- Channels/Models 管理页增加 Anthropic 协议、版本头、beta 头和 tools/thinking 能力配置及探测结果。
- 增加迁移、回滚和配置审计；默认禁止自动 schema synchronize。

### P3：CCTQ-Claude 专项验证

当前 CCTQ-Claude 的普通 Chat 和简单 Messages 探测均被拒绝，并提示需要标准 Claude Code 客户端。专项工作必须先抓取一次标准客户端的**脱敏请求元数据**：method/path、非敏感 headers 名称、Anthropic version/beta 值、body 顶层字段和 SSE 首尾事件；不得记录 token、prompt、tool input 或 thinking 原文。

在未知项确认前，不应：

- 把 CCTQ-Claude 标成“Anthropic Messages 已连通”；
- 为通过探测而硬编码未证实的 `User-Agent`、私有 header、OAuth 流程或 beta 值；
- 把供应商私有协议塞进通用 Anthropic transport。

确认后可新增 `CctqClaudeProfile`（仅负责额外 header/握手策略），底层仍复用原生 Anthropic Messages transport，并用独立 E2E fixture 验证升级风险。

## 验收门槛

- 标准 Anthropic client 可用网关 `x-api-key` 调用 `/v1/messages`，非流式和流式均收到原生响应。
- `system`、多 block content、tool_use/tool_result、thinking、未知 usage 字段和 SSE event/id/data 未被改变。
- 上游 400/401/403/404/413/429/500/529 及 SSE error 均保留 Anthropic envelope、状态码和 request id。
- `/v1/chat/completions`、`/v1/responses` 不会选择只声明 `anthropic` 的渠道；反之 `/v1/messages` 不会回退到 OpenAI 协议渠道。
- CCTQ-Claude 只有在标准 Claude Code 请求元数据和真实端到端结果均通过后，才更新为可用协议；否则保持 disabled/unknown 状态并记录阻塞原因。


