# 多模型协同研发与 Agent Harness 研究核验

> 研究对象：用户笔记《多模型协同研发：主代理、子代理与 Agent Harness》
>
> 研究日期：2026-08-22
>
> 范围：核验 Kimi Code CLI 的主代理/子代理、上下文隔离、并发与调度边界、Skills 发现，以及 ACP/MCP 对 Harness 设计的启示。不修改业务代码，不读取或记录 OAuth 凭据、令牌、会话内容。

## 结论摘要

1. 笔记关于“一个主代理负责理解和调度、子代理负责聚焦任务、结果压缩回传”的核心判断，与 Kimi Code 官方 Agent 文档一致。官方明确写出每个会话由 main Agent 驱动，子代理接收任务描述、使用独立上下文，只把最终结果返回主代理。
2. “可并行”是能力描述，不等于无限并发。官方文档确认多个子代理可以并行、支持后台运行和继续调用；未给出公共 API 意义上的固定最大并发数、每模型配额或吞吐 SLA。Kimi 0.36.0 打包的 AgentSwarm 内置提示写有“最多 128 个并自动排队”，这属于当前 CLI 实现提示，不能外推为稳定服务承诺。
3. Kimi Code 的 Skills 已有正式的项目级、用户级、额外目录和一次性 `--skills-dir` 机制，因此“把既有 Codex skill 融合进 Kimi”技术上可行，但不是自动把 Codex 目录原样注入。目录式 `SKILL.md` 必须有 `name` 和 `description`；需要逐项迁移并检查工具语法、路径和权限语义。
4. `kimi acp` 是 IDE/客户端驱动 Kimi 会话的协议入口，不是子代理编排协议。ACP 标准定义 Agent 与 Client 的 JSON-RPC 会话、提示、工具调用、权限和文件操作；MCP 则连接 LLM 应用与外部上下文/工具。Harness 的任务拆分、模型路由、队列、隔离、聚合和合并规则仍需由上层调度器实现。
5. 原笔记把 Claude Code、Codex、Kimi、DeepSeek、MiniMax、ChatGPT 固定成角色是可行的组织方案，但不是这些产品之间的通用协议事实。实施时应以能力契约（上下文、工具、读写范围、结构化回传、成本/超时）定义角色，并允许模型替换。

## 逐项核验

### 1. 主代理、子代理和上下文隔离

Kimi 官方原文确认：每个会话由 main Agent 驱动；main Agent 理解用户意图、规划步骤、调用工具，并在需要时分派子代理。子代理只接收主代理显式传入的任务描述，在独立上下文中工作；不会直接与用户沟通，中间推理和工具记录不会混入主代理历史，只有最终结论回到主代理。

这直接支持笔记中的以下设计：主代理保存目标、边界、接口契约、任务状态和最终决策；子代理获得最小必要上下文；子代理返回结构化摘要而非完整过程。需要补充的是：隔离不自动解决文件冲突、外部系统副作用或结果质量，Harness 仍需定义工作区、权限和合并门禁。

官方还说明内置 `coder`、`explore`、`plan` 三类子代理的工具边界不同；内置子代理默认不能继续派生子代理，避免无限递归。自定义 Agent 可通过 `subagents` allowlist 显式开放更深层委派，且 `Agent`/`AgentSwarm` 会再次检查 allowlist。

来源：

- Kimi Code 官方《Agents and Sub-Agents》：<https://moonshotai.github.io/kimi-code/en/customization/agents.md>
  - “Every session ... is driven by a main Agent”
  - “works in its own isolated context ... only the final result appears in the main Agent's context”
  - “Multiple sub-agents can run in parallel”
  - `coder`/`explore`/`plan`、`subagents` allowlist 与递归终止规则

### 2. 子代理创建、后台运行和并发边界

官方 Agent 文档确认子代理由 main Agent 调度，可按复杂度、上下文消耗和任务独立性自动派发；支持后台运行，完成后结果自动返回，也可以继续调用已有子代理实例。由此可确认“主代理统一调度、独立任务并行”是产品能力。

但官方公开文档没有承诺以下数值：

- 单会话或单账号的最大同时运行子代理数；
- API 速率限制、模型并发配额或每分钟吞吐；
- 不同模型/供应商之间的统一调度公平性；
- 文件系统、网络、数据库等共享资源的并发隔离保证。

本机 `kimi.exe`（`0.36.0`）的内置 AgentSwarm 提示包含“AgentSwarm supports up to 128 subagents, and queues launches automatically”。这可作为当前 CLI 的实现观察：超过可立即启动的资源时会排队；不能作为 Kimi 云服务或未来版本的稳定上限。工程上应把并发上限配置化，并以队列、超时、取消、重试和成本预算控制实际运行规模。

建议的最小调度契约：

| 契约 | 最低要求 |
| --- | --- |
| 任务 | `task_id`、角色、输入上下文引用、读写范围、超时、取消信号 |
| 调度 | 有界队列、每模型/每项目并发额度、优先级和退避 |
| 回传 | `status`、结论、修改文件、验证命令、风险、待处理依赖 |
| 合并 | 唯一合并入口；写任务必须经过冲突检查、测试和人工/主代理审核 |

来源：

- Kimi Code 官方《Agents and Sub-Agents》：<https://moonshotai.github.io/kimi-code/en/customization/agents.md>
- 本机 CLI 只读核验：`kimi --help`、`kimi --version`；二进制内置 AgentSwarm 提示的“up to 128”仅作实现观察，不视为外部 SLA。

### 3. Harness 的职责边界

“Agent Harness”不是单一标准名称。结合一手协议，可以把职责分成两层：

**协议适配层**

- ACP：IDE/客户端通过 JSON-RPC 驱动 Agent 的初始化、认证、`session/new`、`session/prompt`、取消、进度、工具调用和权限请求；客户端负责用户交互及资源访问控制。
- MCP：Host/LLM 应用、Client 连接器和 Server 之间通过 JSON-RPC 协商能力，Server 暴露 resources/prompts/tools，客户端可提供 sampling/roots/elicitation 等能力。

**编排治理层**

- 需求拆分、角色选择、模型路由和执行顺序；
- 上下文裁剪、引用和结果压缩；
- Agent 创建/恢复/取消、超时、重试和有界并发；
- 工作区、分支/临时目录、网络和凭据权限隔离；
- 结构化回传、状态事件、审计和可观测性；
- 独立评审、测试门禁、冲突解决和唯一最终合并入口。

ACP/MCP 只规定通信与能力协商的一部分，不自动提供上述完整项目管理、文件合并或跨模型成本治理。笔记把 Harness 解释为“运行框架和管理外壳”是合理的产品定义，但落地时应明确哪些职责属于协议适配器、哪些属于调度器、哪些属于 CI/人工审批。

来源：

- Agent Client Protocol 官方《Overview》：<https://agentclientprotocol.com/protocol/overview>
  - Agent/Client 的通信模型、JSON-RPC、初始化→会话→提示→更新/取消流程，以及权限和文件操作边界。
- Agent Client Protocol 官方《Prompt Turn》：<https://agentclientprotocol.com/protocol/prompt-turn>
  - `session/prompt`、`session/update`、工具调用和完整 prompt turn 生命周期。
- Model Context Protocol 官方《Specification 2025-06-18》：<https://modelcontextprotocol.io/specification/2025-06-18>
  - Host/Client/Server 角色、JSON-RPC、能力协商、resources/prompts/tools 及安全与用户同意原则。

### 4. Skills 与 Codex 技能接入

Kimi 官方 Skills 文档确认两种形态：目录式 `<name>/SKILL.md`（推荐，可带脚本和引用资料）及扁平 `.md`。目录式 `SKILL.md` 必须显式提供 `name`、`description`；Skills 可由 slash command 手动调用，也可根据 `description`/`whenToUse` 自动调用。

官方发现范围和优先级为 Project > User > Extra > Built-in：

- 用户级：`$KIMI_CODE_HOME/skills/`（默认 `~/.kimi-code/skills/`）、`~/.agents/skills/`；
- 项目级：项目根下 `.kimi-code/skills/`、`.agents/skills/`；项目根按最近 `.git` 向上查找；
- 额外目录：`config.toml` 顶层 `extra_skill_dirs`；
- 当前启动临时覆盖：`kimi --skills-dir <dir>`，可重复，**替换**自动发现的用户/项目目录，而不是追加。

因此，原笔记所说“把 Codex skill 融合进 Kimi”应拆为两种方案：

1. **不复制、显式加载**：使用 `kimi --skills-dir "C:\\Users\\Eden\\.codex\\skills"` 做一次性兼容性试验。该参数只改变本次启动的 Skills 发现路径。
2. **受控迁移**：逐个复制合适的目录 Skill 到项目 `.kimi-code/skills/` 或用户 `~/.kimi-code/skills/`，审查 frontmatter、工具名称、路径假设、动态命令和权限语义。Kimi 官方还提供项目/用户自动发现，因此不必长期依赖跨产品目录。

不能据此宣称“所有 Codex skill 原样兼容”：Codex 专属工具、MCP 名称、技能触发字段、脚本依赖和安全策略仍需逐项验证。当前仓库没有 `.git` 目录，按 Kimi 文档的项目根规则，项目级技能应以当前工作目录作为回退根；实际使用时建议显式放在 `E:\\Projects\\mg-expert-database\\.kimi-code\\skills\\`，避免歧义。

来源：

- Kimi Code 官方《Agent Skills》：<https://moonshotai.github.io/kimi-code/en/customization/skills.md>
- Kimi Code 官方《`kimi` Command》：<https://moonshotai.github.io/kimi-code/en/reference/kimi-command.md>
  - `--skills-dir` 的“替换自动发现目录”语义、`extra_skill_dirs` 的“追加”语义。

### 5. Kimi ACP 的实际边界

`kimi acp` 官方参考将其定义为 ACP server：通过 stdin/stdout 上的 JSON-RPC 与 IDE 或其他 ACP client 通信，让客户端直接驱动 Kimi 的 sessions、prompts 和 tool calls。当前官方能力矩阵显示已实现初始化/认证、新建或加载/恢复会话、提示、取消、会话列表、配置选项、权限请求和文件读写；终端 reverse-RPC 未连接，shell 命令使用本地执行。

这意味着可以把 Kimi 挂到一个更大的 Harness 或 IDE 中，但 ACP 本身并不声明“跨多个模型的主从调度”“任务队列”“代码合并”或“多个子代理的统一生命周期”。这些仍需由 Harness 负责，并应遵守 ACP 的权限请求和路径要求。

来源：

- Kimi Code 官方《`kimi acp` Subcommand》：<https://moonshotai.github.io/kimi-code/en/reference/kimi-acp.md>
- ACP 官方《Overview》：<https://agentclientprotocol.com/protocol/overview>

## 对原笔记的修订建议

### 可以保留

- “主代理统一调度、专业 Agent 分工、上下文隔离、结构化回传、唯一合并入口”作为组织原则；
- Kimi 负责长上下文资料理解、Codex 负责核心工程执行等角色分工，作为当前团队的工作约定；
- 先用 3～5 个稳定角色跑通，再扩展的渐进式落地策略。

### 应改写为有条件的表述

- 将“理论上可以创建很多 Agent”改成“CLI 支持多个子代理/AgentSwarm，实际数量受当前版本实现、模型额度、资源、任务依赖和共享写入冲突约束；公开文档未承诺固定并发上限”。
- 将“Agent Harness 负责一切”拆成 ACP/MCP 协议适配、任务编排、资源隔离、结果治理和合并门禁五个明确层次。
- 将“不同模型天然适合某角色”改成“依据上下文长度、工具能力、延迟、成本、权限和验证结果做可替换路由”。
- 将“skill 可以融合”改成“可通过 `--skills-dir` 临时加载，或迁移到 Kimi 的项目/用户 Skills 目录；每个 skill 需要兼容性审查”。

### 建议的最小落地架构

```text
主代理 / 调度器
  ├─ 任务拆分与契约（JSON）
  ├─ 有界队列与模型路由
  ├─ Kimi/Codex/其他 Agent 适配器（CLI、API 或 ACP）
  ├─ 独立工作区与权限策略
  ├─ 结构化结果收集、评审与测试门禁
  └─ 唯一合并/发布入口
         ├─ 资料研究 Agent（只读）
         ├─ 核心编码 Agent（受限写入）
         ├─ 测试 Agent（验证）
         └─ Review Agent（独立第二视角）
```

对当前营商环境指标知识库项目，第一阶段不需要自建复杂 Harness：先用 Codex 作为唯一合并入口，Kimi 作为只读研究/长上下文 Agent，通过项目 Skills 和结构化 Markdown 回传；确认任务契约、审计和冲突处理稳定后，再接入 ACP 或自建队列。

## 未证实事项与风险

- Kimi Code 官方公开资料未说明跨进程/跨账号的具体并发配额、计费限额、调度公平性和服务端排队时延。
- 打包二进制内置的“128 个 AgentSwarm 子代理”提示是当前版本实现线索，不是公开 API 契约；升级后应重新核验。
- 本研究未验证 Codex 每个具体 Skill 的运行兼容性，也未执行迁移或写入任何 Kimi 目录。
- ACP 当前实现的能力矩阵属于 Kimi 版本实现状态；ACP 标准本身允许不同 Agent 声明不同 capability，不能把 Kimi 的“已实现/未实现”外推给其他 ACP Agent。
- 多模型调用的真实权限、成本、速率和数据合规边界仍需由团队部署环境和供应商合同确认。

## 可复验命令

以下命令只读取帮助、版本和配置结构；不要输出凭据文件或完整会话日志：

```powershell
kimi --version
kimi --help
kimi doctor
kimi acp --help
kimi provider list
Get-Content -Raw .\config.toml
Get-ChildItem -Recurse -File .\.kimi-code\skills, .\.agents\skills -ErrorAction SilentlyContinue
```

官方文档页使用 `.md` 版本便于复核：

- <https://moonshotai.github.io/kimi-code/en/customization/agents.md>
- <https://moonshotai.github.io/kimi-code/en/customization/skills.md>
- <https://moonshotai.github.io/kimi-code/en/reference/kimi-command.md>
- <https://moonshotai.github.io/kimi-code/en/reference/kimi-acp.md>
- <https://agentclientprotocol.com/protocol/overview>
- <https://modelcontextprotocol.io/specification/2025-06-18>
