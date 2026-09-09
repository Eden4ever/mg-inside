# 本轮业务应用生产包

已于 2026-09-08 在原服务器完成上传、备份与正式切换，未执行业务数据库迁移。统一身份中心先行升级后，由主代理明确发出切换指令。

## 生产执行结果

| 应用 | 当前版本 | 备份目录 | 验证 |
| --- | --- | --- | --- |
| Token One | `mg-gateway:20260908T124729Z`，镜像 `sha256:c7455fa54a8fe7c33de8fe2d8d5fa1e5643ea8d2ba00079bda8c9aa58be67099e` | `/opt/mg-gateway/backups/20260908T124729Z-prepare` | 公网 live/ready 200、SSO unified、三 me 未登录 401、docs 200 |
| 指标知识库 | `current`→`/opt/mg-expert-database/releases/stage12-20260908-205200` | `/opt/mg-expert-database/backups/stage12-20260908-205200-prepare` | 公网主页/JS/CSS/health 200、SSO unified、未登录 me 401 |

Token 备份包含 9,512,531 字节业务 SQL dump、原 Compose/env/镜像 ID。Expert 包含 197,629 字节 PostgreSQL custom dump（pg_restore --list 通过）、原 env/systemd/key、web 完整备份及旧 release 指针。真实凭据仅留服务器 0600 文件，未输出。

在线 env 仅增加 `DESKTOP_ORIGIN=https://desktop.meta-gravity.com`、`IDENTITY_TOKEN_MODE=unified`；原 issuer、client secrets、DB 和额度参数保留。Token `DB_SYNCHRONIZE=false`。Expert schema 与迁移完全相同，未运行 migrate/reset/seed。没有关闭鉴权或改变任何生产用户角色、额度。

按主代理后续指令，两机已备份 Nginx 配置、`nginx -t` 成功后 reload，添加 `Content-Security-Policy: frame-ancestors 'self' https://desktop.meta-gravity.com`。Token 仅既有业务 HTTPS server，保留原 HSTS；Expert 仅 `/knowledge-base-inside/` 与其 `/api/` location，站点根路径头部不变。curl 已确认策略生效。配置备份分别在上述备份目录的 `new-api.conf.before-frame-policy`、`yshj.conf.before-frame-policy`。主代理随后已通过生产既有 SSO 会话进入桌面，成功读取 Token 门户和知识库体系列表，未修改业务数据或权限。平台其他验收见 [首版发布记录](./release-20260908T124713Z.md)。

## Token One

- 发布编号：`20260908T124729Z`
- 归档：`C:/Projects/mg-inside/mg-token-one/.runtime/releases/20260908T124729Z/mg-gateway-20260908T124729Z.tar.gz`
- SHA256：`c13d62563626e5939a7f76a6ed498e18e225afc48dfe6795bdb0cd3ca1a434dc`
- 大小：26,724,530 字节。
- 目标：原 1.12.253.86 `/opt/mg-gateway`，保留现有 MySQL、外部网络、端口、业务域名与凭据。

使用既有 `scripts/production_deploy_package.py` 白名单打包和凭据风险校验。包含三应用固定入口、按真实 API 路由选择授权 audience、普通业务用户获得控制台授权即可管理、门户权限不隐式扩大、共享平台导航/主题/图标/文档布局和窗口交互。生产前端明确设置 `VITE_DESKTOP_ORIGIN=https://desktop.meta-gravity.com`。

验证通过：Vue 类型检查、Vite 生产构建、Nest 构建、后端真实 HTTP 三 audience 授权测试、前端门户/控制台/文档独立授权和撤权重载回归。归档有既有 migration 脚本，但**打包不代表授权执行全部历史迁移或上游配置脚本**；本轮由主发布流程比较现有迁移状态并只执行必要步骤，不触碰额度、模型上游凭据或其他用户角色。

## 指标知识库

- 发布编号：`stage12-20260908-205200`
- 隔离 staging：`C:/Projects/mg-inside/mg-expert-platform-release-20260908T124729Z`
- 归档：`C:/Projects/mg-inside/mg-expert-platform-release-20260908T124729Z/artifacts/stage12-20260908-205200.tar.gz`
- SHA256：`2787edf24f570c93a465034f8a8123709ea03f3552e863253adc99dc10ed03a2`
- 大小：23,130,457 字节。
- 目标：原 43.139.78.226 `/opt/mg-expert-database`，保持 systemd、PostgreSQL、业务域名与原目录。

从当前工作树白名单复制源码到隔离同级目录；原工作树和既有 stage11 目录均未修改。以发布前线上 `stage11-20260908-143500` 对应 `artifacts/identity-release-work` 为基准，仅在 staging 恢复以下五个自动指标编码相关文件：

1. `apps/api/src/catalog.service.ts`
2. `packages/contracts/src/index.ts`
3. `apps/web/src/components/IndicatorTreePanel.vue`
4. `apps/web/src/tests/IndicatorTreePanel.test.ts`
5. `apps/api/test/api.integration.spec.ts`

catalog、contracts 源码和 Prisma schema 的 SHA256 已通过远端当前 release 只读逐项核对，与本地基准完全一致；完整 Prisma 目录与基准无差异，无新增迁移。生产继续要求填写指标编码，不包含自动编码功能。

后端相对 stage11 的最终源码差异仅：`auth.ts`、`auth.controller.ts`、`identity.controller.ts` 和新增 `unified-client.ts`。它们接入统一 T、身份映射、CSRF、撤销和桌面登录，保持既有业务角色与体系权限。权威统一客户端与中心副本 SHA256 一致。

前端保留本轮公共平台页头/布局/导航/主题、桌面桥接和路由、个人中心入口、统一认证、表单 dirty/busy 关闭保护。生产构建参数：

```text
VITE_DESKTOP_ORIGIN=https://desktop.meta-gravity.com
VITE_APP_BASE_URL=/knowledge-base-inside/
VITE_API_BASE_URL=/knowledge-base-inside/api
```

验证通过：pnpm 10.11.0 离线锁文件安装、Prisma generate、contracts/API 编译、Vue 类型检查与 Vite 生产构建；7 个前端测试文件共 41 项通过，包括指标编码必填、页头、个人中心、路由和关闭保护。原打包脚本的生产 base/API 检查通过；归档 134 个文件 SHA256SUMS、相对路径、无链接、无真实 env/私钥/依赖目录检查通过。未在此次 staging 重跑依赖真实本地数据库的统一认证集成测试；该契约由本轮主任务 P0 回归覆盖，随后已通过主代理的生产 SSO 读取验收。

## 已完成的统一发布衔接

统一中心新服务身份与应用权限配置、中心迁移和升级先完成，再协调业务与桌面切换。业务包不内置新凭据，生产 issuer 和历史身份映射保留。Token 与知识库分别使用现有服务器，HTTPS/CSP 和真实生产 SSO 读取验收均已完成，详情见文首记录。

两个包均为不可变产物，任何后续源码变更需使用新编号重新构建，不覆盖这些归档或伪造原摘要。
