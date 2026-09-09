# M0-M3 验收证据

更新时间：2026-08-21

## 自动化结果

| 范围 | 结果 | 覆盖 |
| --- | --- | --- |
| 共享契约 | 4/4 | JSON Schema、自校验、八模块/字段唯一性、工作簿八类语义映射和现实专家字段隔离 |
| API 集成 | 15/15 | 登录、Session/CSRF、角色权限、目录完整性、三级指标限制、八模块、依据、修订、AI 模块/摘要建议、审核发布、版本复制 |
| Web 组件 | 14/14 | 树筛选、默认查看、单模块编辑、取消/保存、必填阻断、未保存切换、不适用理由、研究授权/撤销、依据新增/状态/编辑/删除、摘要保存、AI 模块/摘要建议采纳 |
| 类型检查 | 通过 | contracts、API、Web |
| 生产构建 | 通过 | `pnpm -r build` |
| Prisma | 通过 | `prisma generate`、9 个迁移已部署 |

API 集成测试使用独立 `mg_expert_test` Schema，不清理开发库。

## 真实 HTTP

- `http://127.0.0.1:4100/api/health` 返回 `200` 和 `status: ok`。
- 通过 `http://localhost:5173/api/auth/login` 使用本地种子账号登录成功；验证脚本从 `AUDIT_ADMIN_USERNAME`、`AUDIT_ADMIN_PASSWORD` 环境变量读取凭据，不在仓库记录密码。
- `/api/auth/wecom/status` 在未配置环境返回 `enabled: false`，不会模拟扫码成功。
- 真实指标树返回一级、二级、三级节点；三级工作台固定返回 `portrait, policy, data, quality, governance, rectify, optimize, contacts` 八个模块。

## 前端组件直接证据

- `ResearchWorkspace.test.ts` 直接验证管理员打开授权对话框、提交研究员授权、撤销已有授权，并断言对应事件载荷。
- 同一组件测试直接验证依据新增、核验状态更新、编辑/替换和删除事件；依据状态事件只携带目标依据 ID 和新状态。
- 同一组件测试验证摘要保存必须携带来源修订编号，并发出 `saveSummary` 事件；摘要建议不在工作台组件中直接写入正式摘要。
- `AiExpertPanel.test.ts` 直接验证模块候选和研究摘要候选的依据计数、待核验状态，以及“采纳为正式摘要”事件；AI 面板仅发出人工处理事件。

## 桌面与移动端

验证脚本：[cdp-layout-check.mjs](../scripts/cdp-layout-check.mjs)

脚本通过 Chrome DevTools Protocol 强制设置设备指标并保存截图：

- `1440x900`：`scrollWidth === clientWidth`，工作台三栏存在，Tab 键可到达主要操作。
- `390x844`：`innerWidth/clientWidth/scrollWidth = 390/390/390`，指标树收起按钮显示，AI 收起后显示竖向入口，Tab 键可到达主要操作。

截图输出：`artifacts/workspace-desktop.png`、`artifacts/workspace-mobile-390.png`。

## 已知边界

- M4 真实模型、SSE 流式对话、提示词编排和导出不在 M0-M3 范围内；当前 AI 仅能产生候选建议，模块/摘要均须人工采纳后才形成正式修订。
- 企业微信 `CorpApp` 认证代码已实现，但必须由部署方配置 CorpID、AgentID、Secret 和回调地址后才能启用真实扫码。

## M0-M3 逐项核对

| 编号 | 结论 | 直接证据 |
| --- | --- | --- |
| M0-01 | 通过 | API 集成“健康检查可用，只有三级指标可建立八模块工作台”；`catalog.service.ts` 服务端层级校验 |
| M0-02 | 通过 | API 集成重复打开三级指标用例；`MODULE_KEYS` 固定八键 |
| M0-03 | 通过 | 契约测试 4/4；`research-module-schema.json` 自校验、模块和字段 ID 唯一 |
| M0-04 | 通过 | 领域模型和 AI API 仅创建/处理 `AISuggestion`，无现实专家人员实体 |
| M0-05 | 通过 | Prisma `Evidence`、`AISuggestion`、`ResearchRevision`、`ResearchSummaryRevision`、`IndicatorVersion` 模型及 API 集成修订/发布用例 |
| M0-06 | 通过 | 契约工作簿映射测试覆盖八类研究语义，空白单元不会导入为事实 |
| M1-01 | 通过 | Web/API/契约工作区构建通过，技术栈符合 Vue 3 + TypeScript + Element Plus + Node.js |
| M1-02 | 通过 | `@mg-expert/contracts` 被 API 和 Web 共同引用，契约构建和类型检查通过 |
| M1-03 | 通过 | API 集成真实登录、伪造角色头无效、reader 写入 403、角色授权用例 |
| M1-04 | 通过 | PostgreSQL 容器健康；真实 Web `5173`、API `4100/health` 可访问 |
| M1-05 | 通过 | API 集成覆盖保存、确认、退回、发布、复制和用户/会话审计；服务端 `audit()` 统一写入 |
| M2-01 | 通过 | API 目录完整性/排序/删除/检索用例，Web 指标树组件测试覆盖筛选和收起 |
| M2-02 | 通过 | API 集成目录完整性用例覆盖重复编码、非法层级、叶子约束和父子关系 |
| M2-03 | 通过 | API 集成“重复打开同一三级指标返回同一份八模块研究记录” |
| M2-04 | 通过 | API 集成 Excel 预检行号/字段/错误及导入一致性用例；预检角色收紧为目录管理员/系统管理员 |
| M2-05 | 通过 | API 集成发布后复制版本用例，断言副本可编辑且源版本不变 |
| M2-06 | 通过 | API 集成研究员授权/撤销和目录角色权限用例；服务端 `requireRole` 校验 |
| M3-01 | 通过 | API 与 Web 均按 Schema `displayOrder` 固定渲染八模块 |
| M3-02 | 通过 | Web `ResearchWorkspace.test.ts` 默认查看和单模块编辑用例 |
| M3-03 | 通过 | Web 保存/取消用例；API 集成陈旧 `revisionNo` 冲突用例 |
| M3-04 | 通过 | Web 必填阻断/不适用理由用例；API Schema 类型和确认/发布校验用例 |
| M3-05 | 通过 | Web 依据新增、状态更新、编辑、删除直接事件测试；API 依据生命周期用例 |
| M3-06 | 通过 | Web AI 模块/摘要候选展示和采纳事件测试；API 采纳生成修订、拒绝不改正式内容 |
| M3-07 | 通过 | API 提交审核、退回、确认状态链路；Web 退回原因和审核操作 |
| M3-08 | 通过 | `cdp-layout-check.mjs` 桌面/390px 无横向滚动、树和 AI 可收起、Tab 可达主要操作 |
| M3-09 | 通过 | Web 摘要保存携带来源修订测试；API 摘要建议仅人工采纳后生成正式摘要修订 |
