# MG Token One

公司内部 LLM API 聚合分发网关。

本目录仅保留一个权威实现：`mg-gateway/`。

## 源码结构

```text
mg-gateway/
├── apps/gateway/  # NestJS 后端
└── apps/web/      # Vue 3 + Vite 前端
```

后端提供管理 API、原生 `/v1/chat/completions`、原生 `/v1/responses`、原生 `/v1/messages` 与协议感知的 `/v1/models`；前端提供员工门户、管理后台和接入文档。

## 本地开发

前置条件：Node.js 22+、Docker Desktop（用于 MySQL）。

```powershell
cd mg-gateway
docker compose up -d

cd apps/gateway
copy .env.example .env
node --env-file-if-exists=.env scripts/migrate.mjs
node node_modules/@nestjs/cli/bin/nest.js start --watch

cd ../web
node node_modules/vite/bin/vite.js
```

由于当前依赖目录不包含 Windows 的 `.bin` 链接，直接通过 `node` 调用本地工具入口。

## 校验

```powershell
cd mg-gateway/apps/gateway
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json
npm.cmd run test:gateway
npm.cmd run test:e2e

cd ../web
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
node node_modules/vite/bin/vite.js build
```

运行态检查：

```text
GET /api/health/live
GET /api/health/ready
```

### Codex Desktop GPT-6 Astra

为 Codex Desktop、Codex CLI 和 IDE 安装 Token One 的本地 `gpt-6-astra` 模型目录：

```powershell
irm https://token.meta-gravity.com/codex-gpt6/codex-gpt6-setup.ps1 | iex
```

macOS：

```bash
curl -fsSL https://token.meta-gravity.com/codex-gpt6/codex-gpt6-setup.sh | bash
```

脚本会备份并更新用户级 Codex `config.toml` 中的模型目录和默认模型，不会改写已有 CC Switch provider，也不会写入 API key。完整说明见 [`docs/codex-gpt6-setup.md`](docs/codex-gpt6-setup.md)。

生产文档页提供 Windows/macOS 云端入口。入口自身包含模型目录和安装逻辑，用户无需安装 Python 或下载其他文件。

生产环境必须设置 `NODE_ENV=production`、通过 `npm.cmd run migrate` 显式迁移数据库、保持 `DB_SYNCHRONIZE=false` 和 `AUTO_CIRCUIT_BREAKER_ENABLED=false`，提供至少 32 字符的非默认 `JWT_SECRET`，并由发布脚本写入 `MG_RELEASE_ID`。生产环境不会因连续失败自动临时下线渠道，但同一次请求仍按 `RELAY_MAX_TRIES` 尝试备用渠道；管理员手动停用渠道或供应商账户仍然生效。所有凭据必须存放在部署环境的机密管理系统中。

生产发布后可使用只读审计确认策略已经在运行实例生效：

```powershell
$env:MG_DEPLOY_PASSWORD = '<从机密管理器临时注入>'
python scripts/production-circuit-policy-audit.py
Remove-Item Env:MG_DEPLOY_PASSWORD
```

审计同时检查生产环境、容器环境变量、`/api/health/ready` 返回的实际策略，以及数据库中尚未到期的临时禁用记录；输出中的 `compliant` 必须为 `true`。退出码 `2` 表示服务虽然可用，但自动熔断策略尚未达到生产要求（例如线上仍是旧镜像或缺少开关），不能据此宣称已完成发布验收。脚本只读，不会修改生产数据或重启容器。

### CCTQ 上游密钥发布

`CCTQ_CODEX_KEY` 与 `CCTQ_CLAUDE_KEY` 都是可选的、彼此独立的既有渠道密文更新输入。未提供时，发布不会修改对应渠道的 `keysEncrypted`；提供时，脚本仅在事务中锁定并确认唯一的 `CCTQ-Codex` 或 `CCTQ-Claude` 后更新其密文。缺失或重复渠道会回滚并拒绝发布，绝不创建渠道。凭据更新不触碰供应商账户、模型、`bindings`、`model_routes`、协议、渠道启用状态、健康状态、优先级、权重或请求统计，因此管理员控制和多供应商路由关系在重复发布后保持不变。两个密钥分别经 mode `0600` 的远端临时文件传递，容器仅以环境变量读取，发布成功、失败和回滚路径都会删除临时文件；本地门禁和发布后验收子进程均剥离这两个变量。

原生 Responses 的可靠上游验证必须发送实际模型请求，不能在不持久化新密文且不产生潜在计费副作用的条件下证明运行中路由。因此发布脚本不做不可靠的预提交探测：密文更新后必须通过真实 Responses SSE 和 Codex CLI 验收，任何失败都会触发自动回滚到备份数据库、环境和镜像。密钥仅应从机密管理器临时注入发布进程，禁止写入 `.env`、发布包、日志或命令行。

发布验收还会比较容器环境、健康接口、运行镜像标签和 `mg-gateway:latest` 镜像标签中的发布编号。需要核验指定版本时，可临时设置 `MG_EXPECTED_RELEASE_ID=YYYYMMDDTHHMMSSZ`；任一身份不一致都会返回退出码 `2`。

生产发布脚本在覆盖文件前会保存环境文件、发布文件归档、数据库 SQL、旧镜像标签及 SHA-256 校验清单。若构建、迁移、元数据配置或启动验收任一步失败，会先校验备份，再恢复数据库（仅在数据库阶段已开始时）、文件、环境和旧镜像，最后以旧镜像健康接口和镜像 ID 双重确认回滚结果；回滚失败会保留失败发布文件归档并明确报错。

上传发布包之前还会执行只读前置门禁，确认旧服务与 MySQL 正常、Compose 使用 `mg-gateway:latest`、旧容器与该镜像 ID 一致、数据库备份工具和管理凭据可用，并保留至少 2 GiB 磁盘空间。生产 SSH 连接固定校验 `ssh-ed25519` 主机指纹；主机重装或密钥轮换后必须先通过独立可信渠道核验，再用 `MG_DEPLOY_HOST_KEY_SHA256` 更新预期指纹，禁止自动接受未知主机密钥。

发布包上传后必须通过本地/远端 SHA-256 一致性和压缩包完整性检查，才允许创建备份。新镜像构建期间旧网关继续服务；构建成功后停止旧网关以冻结写入，刷新最终数据库备份及校验清单，再执行迁移和元数据配置，避免使用构建开始前的过期数据库快照回滚。

连接生产服务器之前，发布脚本会重新执行后端全量测试、真实 MySQL E2E、后端构建、前端类型检查和前端生产构建；发布包始终使用该次门禁刚生成的前端产物。任一命令失败都不会建立生产 SSH 连接。

只读前置门禁通过后，发布脚本会原子获取带随机所有权令牌的生产发布锁；锁竞争会在上传前终止，防止两个发布进程互相覆盖备份或回滚。清理锁时必须匹配所有权令牌，进程异常退出遗留的锁不会自动强制删除。
