# MiniMax CLI 降低 GPT 使用成本研究

> 研究对象：MiniMax 官方 `mmx-cli`，用于当前“营商环境指标知识库”的多模型 Agent Harness。

> 产品边界：本文讨论的是研发期 Agent Harness。`mmx` 不接入产品 API、不作为 AI 指标专家的运行时模型、不读取产品数据库，也不复用个人 OAuth 承担产品请求；产品模型需另行选型和授权。
>
> 证据快照：MiniMax 官方仓库 `main` 在 2026-08-21 的提交 `e3cb7b901b354c17cf54587253cf495b388ab0a2`；npm 当前发布版本为 `1.0.22`。本文只使用 MiniMax 官方仓库、官方 npm 包元数据和官方发布页作为能力证据。价格、折扣和配额没有在这些材料中得到统一的固定数值，相关内容不作未经证实的承诺。

## 结论摘要

1. `mmx-cli` 可以作为 Harness 的低风险执行节点：通过 `mmx text chat` 批量处理文本，通过 `mmx search query` 做候选资料检索，通过 `mmx vision describe` 做图片内容提取，并用 `--output json`、`--quiet`、`--non-interactive` 输出可被程序消费的结果。
2. CLI 提供 `--tool` 工具定义和 `mmx config export-schema`，可以把可选命令导出为 Anthropic/OpenAI 兼容的 JSON Tool Schema，适合接入主代理的工具注册层。但这不等于 MiniMax CLI 自己会创建、调度和合并子代理。
3. 成本优化的核心不是把所有请求无条件改发 MiniMax，而是建立任务路由：把可重试、可校验、低风险、批量性强的工作发给 MiniMax；把架构、安全、权限、数据库迁移、生产发布和最终裁决留给 Codex/GPT 或人工。
4. CLI 支持配置优先级、OAuth/API Key、国内/国际区域、默认文本模型和配额查询。官方 README 要求 Node.js 18+，当前 npm 发布版本为 `1.0.22`。
5. 官方材料没有确认 MiniMax CLI 提供稳定的服务端并发上限、Agent/子代理 API、工作区隔离、文件锁、结果合并或成本折算规则。这些必须在 Harness 中自行实现并通过本项目验收。

### 本机现状（2026-08-22）

已完成本机安装与运行验证：Node.js `v24.19.0`、npm `11.17.0`、pnpm `11.19.0` 可用；全局安装 `mmx-cli@1.0.22`，并将 `C:\Users\Eden\AppData\Roaming\npm` 加入当前用户 PATH。`mmx auth status --output json --quiet --non-interactive` 已检测到 OAuth 配置；使用 `mmx text chat --model MiniMax-M3 --message "只回复 OK" --max-tokens 8 --temperature 0 --output json --quiet --non-interactive` 的最小真实请求返回 `OK`。认证凭据未被读取、输出或修改。

## 事实证据

| 事实 | 官方证据 | 对本项目的意义 |
| --- | --- | --- |
| CLI 可安装为 npm 全局包，也可作为 Agent Skill 安装 | [README_CN.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/README_CN.md) 的“安装” | 可先在研发 Harness 中用 CLI 适配器验证任务路由；不修改产品 API。 |
| Node.js 要求为 `>=18`，npm 当前版本为 `1.0.22` | [package.json](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/package.json)；[npm latest 元数据](https://registry.npmjs.org/mmx-cli/latest) | 当前项目 Node.js 运行环境满足要求；安装版本应锁定并定期复核。 |
| 支持 OAuth 或 API Key；`mmx auth status` 是认证状态检查命令 | [README_CN.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/README_CN.md)；[auth/status.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/commands/auth/status.ts) | Harness 启动时应单独检查认证；凭据不得进入仓库、任务提示词或日志。 |
| 当前源码把 OAuth 放在 `~/.mmx/config.json` 的 `oauth` 字段，配置文件按 JSON 写入且权限为 `0600` | [credentials.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/auth/credentials.ts)；[loader.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/config/loader.ts) | 以当前 README/源码为准；仓库中的旧设计文档仍写 `config.yaml`，不能混用。 |
| 凭据解析顺序为命令行 API Key、OAuth 配置、配置文件 API Key | [resolver.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/auth/resolver.ts) | 研发 Harness 应优先使用受控环境变量或短期注入，不把密钥写入项目配置。 |
| 支持 `--non-interactive`、`--quiet`、`--output json`、`--dry-run`，并以退出码区分认证、配额、超时、网络和内容过滤错误 | [skill/SKILL.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/skill/SKILL.md)；[command.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/command.ts)；[errors/codes.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/errors/codes.ts) | 适合 CI/队列调用；Harness 可按退出码重试、降级或转人工。 |
| 非 TTY 或显式 JSON 模式会输出机器可读 JSON；文本聊天支持消息文件和 stdin | [formatter.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/output/formatter.ts)；[text/chat.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/commands/text/chat.ts) | 可用固定 JSON 输入/输出契约减少主代理上下文和解析成本。 |
| `text chat` 支持系统提示、重复消息、模型、最大 token、温度、top-p 和重复 `--tool` | [skill/SKILL.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/skill/SKILL.md)；[text/chat.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/commands/text/chat.ts) | 可为每类批处理任务固定短提示、输出格式和 token 上限，控制无效消耗。 |
| `config export-schema` 导出适合 Agent 工具注册的 Anthropic/OpenAI 兼容 JSON Schema，并排除 auth/config/update | [export-schema.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/commands/config/export-schema.ts)；[utils/schema.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/utils/schema.ts) | 可动态注册安全的文本、搜索、视觉和媒体工具；危险管理命令不能暴露给模型。 |
| CLI 命令包括文本、图像、视频、语音、视觉、搜索、文件和配额；视频支持 `--async`/`--no-wait` | [registry.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/registry.ts)；[video/generate.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/commands/video/generate.ts) | 当前指标研究优先采用文本、搜索、视觉和文件读取；视频/语音属于非核心扩展。 |
| 搜索接口每次最多返回 10 条且没有翻页参数 | [search/query.ts](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/src/commands/search/query.ts) | 只能作为候选发现，不可当作完整政策资料库；需要改写关键词并人工核验来源。 |
| 官方提供 Node SDK 导出入口和自定义 base URL | [SDK.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/SDK.md)；[package.json](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/package.json) | 仅可作为研发 Harness 的后续实现选项，不能据此推导产品运行时模型。 |
| 官方发布页显示 `v1.0.22` 是当前最新发布版本 | [GitHub Releases](https://github.com/MiniMax-AI/cli/releases) | 研发环境不要直接跟随 `main`；固定版本并在升级前重新跑验收。 |

### 证据中的不确定性

- 仓库 `docs/cli-design.md` 仍描述 `~/.mmx/config.yaml` 和旧的 credential 路径，与当前 README、`src/config/loader.ts`、`src/auth/credentials.ts` 不一致。接入时以当前发布包和源码实现为准，并在升级时重新确认。
- README 的 `npx skills add MiniMax-AI/cli -y -g` 说明的是把 MiniMax CLI Skill 加到其他 Agent，不是把其他 Agent 的 Skill 自动融合进 MiniMax CLI。
- MiniMax 官方仓库没有为本 CLI 声明稳定的 Agent/子代理创建 API、固定并发配额、工作区沙箱或跨任务文件锁。不能把这些能力从“支持工具 Schema”推断出来。
- 本报告没有确认具体 token 单价、免费额度或 GPT 对比节省比例。应通过 `mmx quota show --output json`、请求日志和账单数据测量，而不是预先承诺百分比。

## 面向当前项目的任务路由矩阵

| 任务 | 默认路由 | MiniMax 适合度 | 约束与回退 |
| --- | --- | --- | --- |
| 研究工作簿/政策文件的分段摘要 | MiniMax `text chat` | 高 | 分段输入，要求 JSON 摘要；原文和出处保留，失败转 Kimi/GPT。 |
| 指标字段归一化、枚举映射、缺失字段识别 | MiniMax `text chat` | 高 | 使用 JSON Schema/程序校验；不得直接写正式字段。 |
| 研究模块初稿、问题清单和整改建议候选 | MiniMax `text chat` | 中高 | 输出必须标注依据、置信度、待核验项；只形成研发任务候选文件或结构化回传。 |
| 公开政策/案例候选搜索 | MiniMax `search query` | 中高 | 每次最多 10 条；仅候选发现，人工核验 URL、发布日期和适用范围。 |
| 图片/扫描表格内容提取 | MiniMax `vision describe` | 中 | OCR/视觉结果必须人工或程序复核，敏感材料先脱敏。 |
| 批量测试用例草拟、文档整理、格式转换 | MiniMax `text chat` | 高 | 任务可重试、结果可 diff；不授予仓库写权限。 |
| 前端视觉第二意见、可访问性问题清单 | MiniMax `vision`/`text` | 中 | 只返回建议，最终由 Codex/人工按项目规范验收。 |
| 领域模型、Prisma schema、API/权限设计 | Codex/GPT 主代理 | 低 | 需要全局上下文和一致性决策，不适合作为无人值守批处理。 |
| 认证、企业微信、Session/CSRF、安全策略 | Codex/GPT + 人工 | 不替代 | 风险高、需要运行态证据；MiniMax 只能做独立审阅。 |
| 生产代码核心修改、迁移、发布和最终 Review | Codex/GPT 主代理 | 不替代 | 保留唯一最终合并入口；MiniMax 不直接写工作区。 |
| 研究结论发布、政策定性和对外答辩话术 | 人工审核 + 主代理 | 不替代 | AI 只能产生候选建议，不能自动确认或发布。 |

## 最小接入方案

### 1. 固定版本和认证

```powershell
# Node.js >= 18
npm install -g mmx-cli@1.0.22
mmx --version

# 交互式 OAuth，或通过受控密钥登录
mmx auth login
# CI/服务账号也可使用环境变量，不把密钥提交到仓库
$env:MINIMAX_API_KEY = "<从凭据管理器注入>"
mmx auth status --output json --non-interactive --quiet
```

凭据只放在本机用户配置或凭据管理器中。不得把 `~/.mmx/config.json`、环境变量值、完整提示词中的密钥、HTTP verbose 日志或 API 返回的 token 写入任务产物。

### 2. 先做只读 CLI 适配器

Harness 只允许调用一个封装入口，例如 `runMiniMaxTask(task)`，由封装层负责：

- 固定 `--non-interactive --quiet --output json`；
- 为每个任务生成临时 JSON 消息文件或通过 stdin 传入；
- 设置 `--timeout`、模型和最大 token；
- 捕获 stdout、stderr、退出码和耗时；
- 将结果包装成统一结构：`taskId`、`provider`、`model`、`status`、`content`、`usage`、`evidence`、`errorCode`、`createdAt`；
- 只输出候选建议，不执行写库、发布、删除和 Git 合并。

示例：

```powershell
@'
[
  {"role":"system","content":"你是营商环境指标研究助手。只返回 JSON，不把推测写成事实。"},
  {"role":"user","content":"请把输入材料归纳为问题、依据、待核验项。输出字段：issues,evidence,verificationItems。"}
]
'@ | mmx text chat --model MiniMax-M3 --messages-file - --non-interactive --quiet --output json
```

### 3. 工具注册采用白名单

```powershell
mmx config export-schema > .tmp/mmx-tool-schemas.json
```

从 Schema 中只白名单注册 `mmx_text_chat`、`mmx_search_query`、`mmx_vision_describe` 和经过审查的 `mmx_file_upload`。不要注册 `auth`、`config`、`update`，不要把 `video`、外网搜索或文件上传默认开放给所有 Agent。工具参数仍需在 Harness 中做路径、大小、域名和内容校验。

### 4. 统一研发回传边界

MiniMax CLI 只向研发主代理返回候选文件或结构化结果，并携带任务 ID、所用模型、依据、置信状态和待核验项。主代理必须审查其内容，并通过正常的代码修改、测试和评审流程决定是否采用。CLI 不调用产品 API，不写 `AISuggestion`，不访问产品数据库，也不能直接 PATCH 研究模块、确认模块、审核或发布版本。

## 分阶段实施

### M0：测量基线

- 固定 `mmx-cli@1.0.22`，记录认证方式、模型、区域和配额快照。
- 从历史研究任务抽取匿名样本，记录 GPT 当前 token、耗时、人工返工率和错误类型。
- 定义 `quality_pass_rate`、`human_accept_rate`、`cost_per_accepted_suggestion`、`fallback_rate` 四个指标。

### M1：只读批处理

- 接入 CLI 子进程适配器，只支持摘要、字段归一化和格式化任务。
- 每次调用使用固定 JSON 输入/输出、超时、退出码处理和结果落盘。
- 不触及 API、Prisma、权限和正式研究字段。

### M2：证据候选与路由

- 增加搜索和视觉任务，但所有 URL、政策结论和 OCR 内容标记为待核验。
- 主代理根据任务风险、上下文长度、是否需要代码执行和是否可自动校验来选择 MiniMax、Kimi 或 GPT/Codex。
- 并行只在 Harness 队列中实现；设置全局并发、每供应商并发、单任务超时、取消和重试上限。官方没有给出可直接采用的 MiniMax 并发 SLA。

### M3：研发质量闭环

- 将 MiniMax 结果保存为隔离的研发候选产物，由主代理支持接受、拒绝、补充依据和转化为代码修改。
- 在研发 Harness 日志中记录 provider、model、任务模板版本、输入摘要哈希、结果哈希、耗时、退出码和主代理决定，不记录凭据和完整敏感原文。
- 用验收样本对比 GPT/Codex 基线，只有质量和人工成本均满足阈值的任务才扩大流量。

### M4：研发 Harness 稳定化（可选）

- 当子进程启动开销或并发管理成为瓶颈，可在研发 Harness 内评估官方 Node SDK；这不代表将 MiniMax 纳入产品运行时。
- SDK 仍必须经过同一权限、超时、审计、配额和主代理审查边界；不能因为改成 SDK 就扩大其产品权限或数据访问范围。

## 风险与控制

| 风险 | 控制 |
| --- | --- |
| 成本节省被误判为“单价更低” | 只比较相同任务、相同输入/输出质量下的实际账单和人工返工；官方资料未给出固定折算比例。 |
| JSON 输出不完整或被模型夹带 Markdown | 先解析 JSON，再做 JSON Schema 校验；失败进入重试或人工队列。 |
| 搜索结果不全或来源不可靠 | 遵守每次最多 10 条的官方限制；保存 URL、日期和检索词，人工核验后才可作依据。 |
| 提示词或政策材料泄露 | 脱敏、最小化上下文、禁止 verbose、临时文件销毁、供应商区域和合规审查。 |
| 误写正式研究内容 | CLI 适配器无业务写权限；所有结果只形成隔离的研发候选产物，由主代理审查后决定是否转化为代码或文档修改。 |
| 并发过高造成限流、配额耗尽或主代理上下文膨胀 | Harness 自建队列、并发令牌、预算、取消、重试和结构化摘要；不采用未证实的并发上限。 |
| CLI 升级改变参数或认证路径 | 锁定 npm 版本，升级前执行完整验收并复核 README/源码；特别关注 README 与旧 `cli-design.md` 的配置路径差异。 |
| 外部进程和工作目录不隔离 | Harness 为每个任务创建临时目录，显式传入输入路径；CLI 本身未承诺工作区沙箱或文件锁。 |

## 验收命令

以下命令只做安装、认证和只读能力验证，不会修改本项目业务数据：

```powershell
node --version
npm view mmx-cli version
mmx --version
mmx auth status --output json --non-interactive --quiet
mmx config show --output json --non-interactive --quiet
mmx config export-schema > .tmp/mmx-tool-schemas.json

# 只验证请求构造，不发起 API 请求
mmx text chat --model MiniMax-M3 --message "输出 JSON: {\"ok\":true}" --dry-run --output json --non-interactive --quiet

# 需要已登录且会消耗配额；在专用测试账号运行
mmx text chat --model MiniMax-M3 --message "只返回 {\"ok\":true}" --output json --non-interactive --quiet
mmx search query --q "营商环境 指标 政策" --output json --non-interactive --quiet
mmx quota show --output json --non-interactive --quiet
```

验收标准：

1. `mmx --version` 与锁定版本一致，`auth status` 成功且输出不包含完整凭据。
2. `config export-schema` 可解析为 JSON，且 Harness 白名单不含 `auth`、`config`、`update`。
3. `--dry-run` 不产生网络请求；非交互模式缺少参数时快速返回退出码 2，而不是挂起等待输入。
4. 正常文本调用能解析为约定 JSON；认证、配额、超时、网络和内容过滤分别映射到退出码 3、4、5、6、10，并进入相应回退路径。
5. 搜索结果数量不超过官方声明的 10 条，所有结果带检索词和待核验状态。
6. 运行至少 30 个匿名历史样本，与 GPT/Codex 基线比较质量通过率、人工采纳率、返工率、耗时和 `cost_per_accepted_suggestion`；在没有真实账单和质量数据前，不宣称节省比例。
7. 研发 Harness 集成测试证明 MiniMax 只能生成隔离候选产物，不能调用产品 API、写产品数据库或修改正式模块。

## 官方来源

- [MiniMax CLI README_CN.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/README_CN.md)
- [MiniMax CLI Agent Skill](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/skill/SKILL.md)
- [MiniMax CLI command design](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/docs/cli-design.md)
- [MiniMax CLI source tree](https://github.com/MiniMax-AI/cli/tree/e3cb7b901b354c17cf54587253cf495b388ab0a2/src)
- [MiniMax CLI SDK.md](https://github.com/MiniMax-AI/cli/blob/e3cb7b901b354c17cf54587253cf495b388ab0a2/SDK.md)
- [MiniMax CLI releases](https://github.com/MiniMax-AI/cli/releases)
- [mmx-cli npm package metadata](https://registry.npmjs.org/mmx-cli/latest)
