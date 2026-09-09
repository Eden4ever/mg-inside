# 营商环境指标知识库

面向营商环境考核指标的结构化知识库。保存即记录，不设提交审核、退回或发布流程；历史版本也按编辑权限继续维护。当前完成 M0-M3，并建立 M4 的模型协议与治理底座：领域契约、指标体系与三级指标树、八模块研究工作台、依据材料、不可变修订、乐观锁，以及 AI 候选建议的人工采纳与拒绝契约。系统采用服务端会话，支持本地账号、用户与角色管理，并预留企业微信 `CorpApp` 扫码登录。

“专家库”指拟人的 AI 指标专家能力，不是现实专家人员通讯录。M4 通过供应商无关的模型接口接入 DeepSeek 官方 API；服务端必须显式配置密钥和模型才会启用。研发期使用的 GPT、Kimi、MiniMax CLI 不属于产品运行时。AI 只创建待核验候选建议，不能直接修改正式记录。

## 技术栈

- Web：Vue 3、TypeScript、Vite、Element Plus
- API：Node.js、NestJS、Fastify、Prisma
- Database：PostgreSQL 17
- Workspace：pnpm Monorepo

## 本地启动

环境要求：Node.js 22+、pnpm 10、Docker Desktop。

```powershell
pnpm install
Copy-Item .env.example .env
# 配置 POSTGRES_PASSWORD、对应 DATABASE_URL 和 SEED_ADMIN_PASSWORD 后再初始化数据
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

启动后访问：

- Web：http://localhost:5173
- API 健康检查：http://127.0.0.1:4100/api/health
- PostgreSQL：`127.0.0.1:5437`（仅本机 IPv4，避免 `localhost` 优先解析 IPv6 导致连接等待）

数据库端口仅绑定本机回环地址。已有数据库卷不会因修改 `POSTGRES_PASSWORD` 自动更改密码：保留卷及备份，先由数据库管理员轮换数据库角色密码，再同步更新 `.env` 中的密码与连接串；不要删除卷来完成轮换。

Web 默认通过同源 `/api` 访问后端，由 Vite 开发代理转发至 `127.0.0.1:4100`，避免浏览器跨域和回环地址隔离问题。

所有业务接口均要求登录，角色只从服务端用户记录读取。浏览器伪造 `X-User-Role` 或 `X-User-Name` 不会获得权限；写操作还必须通过会话绑定的 CSRF 校验。

企业微信扫码登录默认关闭。启用前由企业管理员配置 `WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_APP_SECRET`、`WECOM_REDIRECT_URI`，并将 `WECOM_LOGIN_ENABLED` 设为 `true`。管理员还需在“用户管理”中把已有账号绑定到稳定的企业微信 `UserID`；首次扫码不会自动创建用户或自动授予角色。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

若当前 Codex 运行环境的 pnpm 包装器反复重建依赖，可直接使用工作区本地编译器执行等价检查：

```powershell
.\node_modules\.bin\tsc.CMD -p packages\contracts\tsconfig.json --noEmit
.\node_modules\.bin\tsc.CMD -p apps\api\tsconfig.json --noEmit
.\apps\web\node_modules\.bin\vue-tsc.CMD --noEmit -p apps\web\tsconfig.json
```

API 集成测试会自动使用 PostgreSQL 中独立的 `mg_expert_test` Schema，并只清理该测试 Schema 的数据，不会覆盖开发库或演示数据。

M4 已接入 DeepSeek 官方 API Adapter，默认只有在服务端配置 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL` 后才启用；研发环境可使用合成数据完成真实流式烟测。验收记录见 `docs/verification-m4.md`。

## 指标目录导入

当前目录导入只接受 `.xlsx`，第一张工作表至少包含：

| 列名 | 说明 |
| --- | --- |
| `level` / `层级` | 仅允许 1、2、3 |
| `code` / `指标编码` | 当前导入文件内唯一 |
| `name` / `指标名称` | 不允许空白 |
| `parentCode` / `父级编码` | 二、三级必填，父级必须恰好高一级 |
| `sortOrder` / `排序` | 可选 |

系统先预检并展示行号、字段和错误原因，预检通过后再正式导入。原研究工作簿 A-BL 的字段映射维护在 `packages/contracts/src/workbook-mapping.ts`，空白单元不会作为已确认事实写入。

## 领域边界

- 只有三级指标建立研究记录；四级指标作为具体监测事项进入指标画像。
- 八模块编码固定，定义来自 `docs/research-module-schema.json`。
- 默认查看，一次只编辑一个模块；保存通过 `revisionNo` 防止覆盖并发修改。
- 发布版本只读，后续修改必须复制新版本。
- AI 只能创建候选建议；人工采纳后才产生正式模块修订。

M0-M3 验收边界见 `docs/acceptance-m0-m3.md`，M4 运行验收见 `docs/verification-m4.md`。

## 后台路由与页面会话

后台导航使用 Vue Router。指标体系列表、体系详情、三级指标研究工作台和用户管理分别拥有独立 URL，支持浏览器前进、后退和深链接刷新。未保存研究内容由统一路由守卫拦截，快速切换指标时会丢弃过期异步响应。

阶段一工程化的路由契约、AI 采纳事务边界、测试证据和发布方式见 `docs/verification-stage1-engineering.md`。


2026-09-09 公共服务契约批次：expert-database.api 1.1.0 三查询已正式启用，前端最终 20260908T190645Z。新建体系改为成功才关闭、失败保留输入重试，体系和语义库创建期间保护关闭及导航，公共页面标题与当前模块同步。契约与权限验证见 services/README.md，发布证据见 ../mg-desktop-one/deploy/services-release-20260909.md。
