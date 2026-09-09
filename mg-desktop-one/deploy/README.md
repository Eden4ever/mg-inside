# 统一桌面生产部署

## 服务目录数据库补充（2026-09-09）

正式服务目录已迁移至独立 `mg-service-registry-db-1` / `mg_services`，桌面 compose 同时加载私密 `desktop.env` 和 `services.env`。新建环境必须先准备数据库、安装表结构并导入经过校验的目录，不直接从旧 JSON 覆盖已有数据库。现有数据库配置随发布目录保留；后续核心发布使用已更新的 `release-service-governance.py`，同时备份真实数据库。首次迁移脚本不能用于重复切换。

迁移、断库行为、备份及保留最新写入的回退流程见 [服务管理独立存储](../docs/service-storage.md)。以下较早的初始迁移说明保留历史上下文，服务目录当前数据源以该文档为准。

最新状态（2026-09-09）：桌面、统一身份、文件、Office One 和资源管理已迁移到 `43.139.78.226`，版本 `20260908T155000Z`。以下首版拓扑作为历史记录保留，当前部署与回滚依据见 [统一迁移记录](./migration-20260909.md)。

状态更新：2026-09-08，首版平台 `20260908T124713Z` 已正式上线 `https://desktop.meta-gravity.com`，统一身份仍使用 `https://identity.meta-gravity.com`。Token One 已原地发布 `20260908T124729Z`，知识库已原地发布 `stage12-20260908-205200`。完整结果见 [首版发布记录](./release-20260908T124713Z.md) 与 [业务发布记录](./business-release-20260908.md)。

主代理已通过生产既有 SSO 会话进入桌面，并成功读取文件根目录、Token 门户、知识库体系列表和身份管理概览；HTTPS、匿名访问拒绝与 PDF MIME 检查通过。没有为验证改动业务数据或增加生产用户的应用授权。企微头像和全屏按钮属于后续独立补丁，不在此首版已上线范围。

下文保留实际采用的部署拓扑、候选脚本使用方式与回滚步骤，供后续发布复用；示例编号必须替换成新的唯一 UTC 时间戳，禁止覆盖既有镜像或归档。不要复制本地演示用户、权限、额度、数据库或 `.runtime/local`。本轮使用 1Password SSH Agent 授权并成功复用连接，没有导出私钥。

业务备份：Token `/opt/mg-gateway/backups/20260908T124729Z-prepare`；知识库 `/opt/mg-expert-database/backups/stage12-20260908-205200-prepare`。两个业务站点已设置 `frame-ancestors 'self' https://desktop.meta-gravity.com` 白名单，知识库策略仅限 `/knowledge-base-inside/` 及其 API 路径；Token 原 HSTS 与其他站点规则保留。

## 已核实的生产拓扑

| 主机 | 服务 | 现有部署与健康检查 |
| --- | --- | --- |
| 1.12.253.86 | 统一身份 | `/opt/mg-identity/compose.yaml`，容器 `mg-identity-identity-1`，本轮平台包已升级，Node 24.20.0，loopback 4200，`GET /health` |
| 1.12.253.86 | 身份数据库 | `postgres:17-alpine`，网络 `mg-identity_default`，Compose 卷 `identity-postgres`，不暴露宿主机端口 |
| 1.12.253.86 | Token One 三入口 | `/opt/mg-gateway/docker-compose.yml`，容器 `mg-gateway`，现镜像 `mg-gateway:20260908T124729Z`，Node 22.23.2，loopback 3001→3000，网络 `mg-token-one_internal`，`GET /api/health/live` 和 `/api/health/ready` |
| 43.139.78.226 | 指标知识库 | systemd `mg-expert-database-api.service`，账号 `mgexpert`，`/opt/mg-expert-database/current`→`releases/stage12-20260908-205200`，实际运行 Node 24.20.0，loopback 4100，`GET /api/health`，本机 PostgreSQL 5432 |

Token 和知识库原地发布，保留现有数据库、业务域名与服务目录。不会迁移到桌面容器或合并业务数据库。第三台禅道上游 106.52.90.82 不参与本轮发布。

远端 DNS 查询确认 `desktop.meta-gravity.com` 和 `identity.meta-gravity.com` 都解析到 1.12.253.86。本机代理返回的 198.18.* 地址不用于发布判断。

新桌面部署到 1.12.253.86 的 `/opt/mg-desktop`，独立 Compose 项目 `mg-desktop`。桌面 API 4300 和 Files API 14350 仅监听 loopback，容器用 host 网络，不加入旧业务数据库网络。Files 单进程写本地存储，不可同时启动多个实例共用该目录。

| 公开入口 | 用途 |
| --- | --- |
| `https://desktop.meta-gravity.com/` | 桌面与会话代理 |
| `/apps/personal-center/` | 个人中心静态应用 |
| `/apps/app-manager/` | 应用管理静态应用 |
| `/apps/files/` | 文件静态应用 |
| `/apps/identity/` | 身份管理静态应用 |
| `https://identity.meta-gravity.com` | 保持唯一身份 issuer、登录页、认证 API 与回调 |
| `https://token.meta-gravity.com` | 原地发布 Token 门户、控制台和文档 |
| `https://yshj.meta-gravity.com/knowledge-base-inside` | 原地发布知识库 |

身份管理静态应用放桌面域名，不改变 issuer。登录页 `/` 与管理应用 `/apps/identity/` 必须分别构建；`build-release.ps1` 已处理两份产物。

## 发布前置条件

1. 主代理完成当前代码与授权回归。桌面 `config.ts` 已单独允许**明确的 Files loopback 服务端地址**，且继续禁止 HTTP 公开应用入口。模板使用 `FILES_API_URL=http://127.0.0.1:14350/api`，发布时确认携带该版本。
2. 统一中心必须已支持同一 T、各应用独立 audience、用户与角色授权并集；注册 desktop-one 和 files 两个独立服务身份，以及本轮应用目录。只在服务端私密文件存储凭据。新增应用不自动给生产用户扩权；默认 files、personal-center 按中心默认应用规则处理。
3. 桌面 client 回调为 `https://desktop.meta-gravity.com/auth/callback`。中心及业务服务配置 `DESKTOP_ORIGIN=https://desktop.meta-gravity.com`；旧的 issuer、数据库 URL、身份加密 key、企微回调和本地用户映射保留。
4. 检查现有 Nginx/CSP/X-Frame-Options 不阻止桌面嵌入 Token、知识库；仅允许可信桌面 origin。不要全局删除保护。浏览器跨站 Cookie 与桌面桥接真实登录必须回归。
5. 核对所有待部署 Prisma/业务迁移。本次知识库已在隔离 staging 排除自动指标编码变更，沿用生产必填编码规则；后续发布仍须明确业务范围，不能借平台发布顺带推送未审核功能。

## 构建与上传

先在各仓库按锁文件安装依赖并完成测试。此脚本只在本地构建、白名单打包，不连接服务器：

```powershell
& C:/Projects/mg-inside/mg-desktop-one/deploy/build-release.ps1 -ReleaseId 20260908T120000Z
```

将示例时间替换为实际唯一 UTC 编号。产物为 `artifacts/platform-<编号>.tar.gz`，包含桌面 bundle、四个静态应用、Files TS 服务、身份 dist/Prisma/脚本和部署配置。不带 node_modules、真实 env 或私钥。所有文件记录 SHA256SUMS，归档摘要由脚本输出。

有其他开发并行进行时，可用 `-FilesAppSource`、`-FilesServerSource` 和 `-IdentityBackendSource` 显式指定已冻结的源码目录，避免将后续功能混入本轮补丁。Files 服务源目录须包含 `server/` 与 `package.json`；身份后端源目录须包含 `src/`、Prisma、脚本及锁文件。快照可复用本地依赖，但发布包仍不携带依赖目录。

保持兄弟 `mg-platform` 工作区参与前端本地构建。原身份 Dockerfile 只复制自身 web，不包含兄弟公共包，因此本轮使用这里的 `identity.Dockerfile` 从已构建 dist 创建镜像；Linux 容器内重新 npm ci 与 Prisma generate，不携带 Windows 原生引擎。身份后端及两份前端直接输出到独立 release 目录，不覆盖本机 14200 使用的 dist/public 或 web/dist。

使用用户已经授权的 SSH Agent 或既有长驻连接上传，**不使用导出 1Password 私钥的旧辅助脚本**。远端先校验归档摘要，再解压到全新 `/opt/mg-desktop/releases/<编号>`；目录存在就终止，不覆盖旧版本。解压前检查 tar 成员为相对路径、无 `..`、无符号链接。`/opt/mg-desktop`、`releases`、当前 release 目录允许 Nginx 遍历（0755），仅 `static` 公开子目录和文件分别 0755/0644；`secrets`、`backups`、`shared` 保持私密，绝不能为静态访问将这些目录一起开放。随后运行：

```bash
bash /opt/mg-desktop/releases/<编号>/deploy/build-images.sh <编号>
```

脚本仅构建 `mg-desktop-service:<编号>`、`mg-files-service:<编号>`、`mg-identity-service:<编号>`，不切换服务。原 latest 与历史 tag 均保留。服务器剩余约 46G 磁盘、1.4Gi 可用内存且无 swap，应串行构建，不与其它服务重建并行。

## 备份与身份中心先行

已完成客户端注册的平台补丁可以执行 `activate-identity.sh <编号> --preserve-config`：仍先停服备份数据库和既有配置、再执行追加迁移，但完全保留当前客户端、签名密钥和服务环境文件。首次部署默认 `--prepare-config`，才运行客户端注册准备脚本。

暂停身份管理写入并停止旧身份服务后备份：现有 Compose、`secrets/identity.json`、`auth-config.key`、其它现有 secrets 和 PostgreSQL custom dump；文件权限保持 0600/目录 0700。备份文件不写入会话输出。加密 key 与库必须成套保留，不能重新生成替代旧 key。

创建仅覆盖 identity image 的新 Compose override，保留 `/opt/mg-identity` 原 project、db、端口、网络与 secrets 挂载。例如：

```yaml
services:
  identity:
    image: mg-identity-service:<编号>
```

在 `/opt/mg-identity` 使用 `docker compose -f compose.yaml -f <新override> run --rm identity node node_modules/prisma/build/index.js migrate deploy`，再同组合 `up -d identity`。不要 `down -v`、reset 或重新 bootstrap 生产库。迁移失败停止发布，保留备份并分析；不要自动退回绕过统一认证/MFA 的旧代码。

验证 `/health`、OIDC discovery issuer、既有登录/MFA、应用目录、三 Token audience 和默认应用内省，再执行业务应用与桌面切换。中心 client/role 数据更新必须由主代理审核且只迁移结构与明确授权，不套用本地 demo 脚本。

## Token 与知识库原地发布

**Token：** 使用 `mg-token-one/scripts/production_deploy_package.py` 的白名单构建包与本仓库前端现有生产 build，包内包含最新三入口和按真实路由选择 audience 的后端。网关原 Dockerfile 可从 gateway 源码构建、复制预构建 web-dist。保持 `/opt/mg-gateway/mg-gateway.env`、原外部 Docker 网络 `mg-token-one_internal` 和 loopback 3001；新建 `mg-gateway:<编号>`，用 Compose override 指定该 tag，避免默认 build/覆盖 latest。先备份业务 DB、Compose、env 和当前镜像 ID。不要顺带执行旧部署脚本里不属于本轮的额度/计费迁移。健康检查两个 `/api/health/*`，再验证三条 `/api/auth/me/{token-one,token-one-console,token-one-docs}`；普通业务用户仅有 console 授权也可进入控制台，无 console 授权的 admin 应拒绝。旧 token-docs:3200、new-api、MySQL、Redis 和其它站点均不改。

**知识库：** 使用既有 `scripts/build-stage1-release.ps1` 打包与 `scripts/deploy-stage1.ps1` 发布到 43.139.78.226；编号遵循 `stageN-yyyyMMdd-HHmmss`。前端必须 `/knowledge-base-inside/` base、API `/knowledge-base-inside/api`。现有 remote-deploy 脚本已完成 SHA 校验、数据库 dump、env/key/static/service 备份、锁文件安装、Prisma generate+migrate、不可变 releases、current 原子切换和健康检查。实际 API runtime 固定 `/opt/mg-expert-database/runtimes/node-v24.20.0-linux-x64/bin/node`，不要换成 shell 默认 Node20。同一 T 和身份映射不改变业务权限。发布前先确定当前所有待迁移 SQL 与自动编码变更的范围。

现有 Token Paramiko 发布封装读取 key/password，不直接适配本次 Windows Agent；优先用已建立的原生 OpenSSH 连接执行同等已审计流程，不调用导出 key 的 PowerShell 脚本。Expert 原生 ssh/scp 可使用 Agent。

## 桌面、Files 与 Nginx 切换

在 `/opt/mg-desktop/secrets` 私密创建 desktop.env/files.env（参考模板），赋 0600；DESKTOP_FLOW_KEY 生成一次后持久保留。不要把凭据置于 release 静态目录。执行 `activate-desktop.sh <编号>` 前完成上述中心与业务验收。

激活脚本停止旧桌面/Files 写入、一起备份 shared 目录、以新不可变镜像启动并等健康，通过后切换 `/opt/mg-desktop/current`。Files `metadata.json` 与 `objects` 必须一起备份，目录归容器 node UID1000，单进程写入。失败不会擅自回滚身份或业务数据库，按下节明确处理。

现有 Nginx 使用 `/etc/nginx/conf.d`，Certbot 续期 timer 已启用。先建立只含 80 的 desktop 站点：`/.well-known/acme-challenge/` root `/var/www/operation-certbot`；其它路径临时返回 503。`nginx -t` 后 reload，再执行：

```bash
certbot certonly --webroot -w /var/www/operation-certbot -d desktop.meta-gravity.com
```

沿用已注册的 Certbot 账户与续期方式，不新建猜测的邮箱。证书成功后安装候选 `nginx-desktop.conf`，`nginx -t && systemctl reload nginx`。保留 `/etc/nginx/conf.d/identity.meta-gravity.conf` 内企微校验静态 location 与身份原代理，保留 Token、知识库和其它站点。不要把已有 HTTPS 配置提前指向不存在的证书。

上传上限是 50MiB，Nginx 50m 对应原始 body；修改业务限制时同步代理限制。下载不缓存、不丢失 attachment/nosniff。检查 PDF worker 的 `.mjs` MIME，必要时只在新站点追加 JavaScript MIME 映射。

## 验收与回滚

验收实际 HTTPS 登录、MFA、桌面应用目录、三 Token 独立授权、身份系统权限、浏览器直访/桌面模式、默认 Files/个人中心、上传/下载/目录隔离与注册弹窗。只使用被授权的生产测试账户与唯一测试对象；不改其他用户角色、额度。新旧业务 health 都通过才交付。

桌面回滚：记录 backups/<编号>/previous-release 中的旧 release；停止 mg-desktop Compose，显式指定旧 RELEASE_ID 和旧 compose 重新启动并恢复 current 链接。仅代码兼容时复用最新 shared 数据；需要回退存储结构时先停写，再将完整备份恢复到新的目录并切换挂载，不能只恢复 metadata 或覆盖在线 objects。初次部署没有旧 release，则停止新服务并移除新 Nginx 站点，保留数据与镜像以便修复。

Token 回滚：恢复发布前记录的不可变镜像 ID/tag 与原 Compose，保留 DB/env/身份加密 key；只有当前 schema 兼容才代码回退。知识库按其 remote-deploy 规则优先前向修复；不能退回单因素旧认证版本。身份中心有新迁移时必须确认兼容性，必要停服成套恢复数据库和密钥备份；不得通过 IDENTITY_ENABLED=false 绕过认证恢复业务。

本轮 SSH 经 1Password Agent 授权，初始会话 Token/Identity 57657、Expert 98755 保持连接并用于业务发布；主代理另建自有连接且复用成功。会话编号仅在创建它的代理作用域内有效，不能跨代理直接复用 PTY 编号，也不能保证后续网络断开后仍存活。没有导出私钥。
