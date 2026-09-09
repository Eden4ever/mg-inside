# M4 AI 指标专家阶段验收

## 当前结论

M4 的产品协议、治理底座和 DeepSeek 官方 API Adapter 已实现并通过真实连接验收。生产环境使用账号实际可用且完成合成数据烟测的 `deepseek-v4-flash`；服务端密钥只保存在权限为 `0600 root:root` 的环境文件中。GPT、Kimi、MiniMax CLI 仍属于研发协作工具，不是产品运行时依赖。

## 已实现

1. `GET /api/ai/status` 返回模型服务是否完成配置；未配置时前端明确禁用生成能力。
2. 产品业务层只依赖供应商无关的 `AiModelGateway` 接口；DeepSeek 官方 API 作为独立 Adapter 接入，不把传输协议扩散到指标研究模块。
3. `POST /api/indicator-versions/:versionId/indicators/:nodeId/ai-suggestions/stream` 使用 SSE 返回 `meta`、`delta`、`usage`、`completed`、`error` 事件。
4. 上下文只包含当前指标和当前研究模块，并对手机号、邮箱和证件号做基础脱敏；提示词将上下文标记为不可信资料。
5. 用户每次发送前必须确认当前模块资料可由模型服务处理，API 在读取研究工作区前再次校验。
6. 每个用户只允许一个并发生成任务，默认每分钟最多 5 次，可通过 `AI_MAX_REQUESTS_PER_USER_PER_MINUTE` 调整。
7. 模型结果只写入状态为 `pending` 的 `AISuggestion`；只有人工采纳后才会修改正式模块并生成修订。
8. DeepSeek Adapter 支持客户端断开取消、5 至 120 秒超时、最大输出 token、HTTP 错误映射和服务端正文长度限制。

## 当前验证

```powershell
pnpm --filter @mg-expert/api test
pnpm --filter @mg-expert/web test
pnpm --filter @mg-expert/api build
pnpm --filter @mg-expert/web build
```

单元测试使用内存 Fake Gateway 验证业务治理，并模拟 DeepSeek SSE 验证官方端点、Bearer 鉴权、流式内容、token usage、认证失败、供应商限流和请求超时。测试未向任何外部模型发送业务研究资料。

生产真实验收仅发送合成数据。账号可用模型为 `deepseek-v4-flash`、`deepseek-v4-pro` 和 `deepseek-v4-flash-vision-exp`。最终使用持久化生产配置运行 `deepseek-v4-flash`：918ms 内收到 5 个增量事件，统计为 121 输入 token、12 输出 token，输出 JSON 结构正确。公网 `/api/ai/status` 返回 `configured: true`、`provider: deepseek-api`、`streaming: true`。原环境配置已备份至 `/opt/mg-expert-database/backups/m4-20260823-153300/api.env`。

## 后续治理项

1. 明确研究资料的数据分级、允许发送范围、保存策略和 DeepSeek 侧数据处理条款；当前仍要求用户每次发送前主动确认。
2. 根据真实用量评估单次和月度成本，增加组织、用户和模型维度的预算及硬配额。
3. 多实例部署时把当前进程内限流迁移到 Redis 或 API 网关。
4. 建立模型调用成功率、延迟、token 用量和供应商错误码的脱敏监控告警。

## 研发工具边界

项目经理 Skill 可以调用 GPT、Kimi、MiniMax CLI 完成需求分析、代码候选、测试草拟和独立评审，但这些 CLI：

- 不作为产品后端模型服务；
- 不读取产品数据库或用户会话；
- 不把个人 OAuth 作为产品凭据；
- 不直接写正式研究内容或业务数据；
- 只向主代理返回候选结果，由主代理审查、测试和合并。
