# 阶段一工程化验收

验收日期：2026-08-23

## 范围

阶段一包含两个业务边界：

1. 后台路由与页面会话工程化。
2. AI 模块建议采纳的事务原子性与并发控制。

## 路由契约

| 路径 | 名称 | 行为 |
| --- | --- | --- |
| `/systems` | `systems` | 指标体系列表 |
| `/systems/:versionId` | `system-detail` | 独立指标体系详情，展示版本概览、目录统计、模块状态和三级指标入口 |
| `/systems/:versionId/indicators/:indicatorId` | `indicator-workspace` | 三级指标研究工作台 |
| `/users` | `users` | 用户管理，仅系统管理员可进入 |

根路径和未知路径重定向到 `/systems`。生产环境使用 `createWebHistory(import.meta.env.BASE_URL)`，与 `VITE_APP_BASE_URL=/knowledge-base-inside/` 保持一致。

URL 是页面导航状态的单一事实源。体系、指标和全局导航均通过 Router 切换；页面再根据 URL 加载指标树和研究工作台。快速切换时使用请求代次令牌丢弃过期响应，避免旧请求覆盖当前指标。

存在未保存研究内容时，路由前进、后退、导航栏切换和指标切换统一进入导航守卫。用户可以选择保存后继续、放弃修改或留在当前页面；关闭或刷新浏览器时使用 `beforeunload` 提醒。

## 事务边界

模块建议采纳在一个 Prisma 事务中完成：

1. 再次确认建议仍为 `pending`。
2. 按 `expectedRevisionNo` 条件更新研究模块。
3. 写入模块修订和审计日志。
4. 将建议条件更新为 `accepted` 并关联结果修订。

任何一步失败都会回滚整个事务。两个请求并发采纳同一模块修订时只允许一个成功，另一个返回冲突且建议保持 `pending`。

## 本地证据

- Contracts TypeScript：通过。
- API TypeScript：通过。
- Web TypeScript：通过。
- API：4 个测试文件、26 项测试通过。
- Web：8 个测试文件、27 项测试通过。
- 生产 Web 构建：`VITE_APP_BASE_URL=/knowledge-base-inside/` 构建通过。
- 生产 API 基址由应用基路径推导为 `/knowledge-base-inside/api`，发布包脚本会校验构建产物，防止子路径部署请求误发到根路径 `/api`。
- 本地 SPA 深链接：`/systems`、体系详情、三级指标工作台和 `/users` 均返回应用入口。
- 生产发布前基线：首页、`/systems`、`/users` 和 `/api/health` 均返回 200。

真实 Chrome 验收通过：从体系列表进入独立详情后，浏览器后退回到体系列表、前进回到原详情，刷新仍保持详情 URL；详情页可显式返回列表并进入三级指标，研究工作台可显式返回体系详情；进入用户管理后再后退也能返回原详情。编辑模块形成未保存草稿后，`beforeunload` 会阻止离开；全局导航弹出“保存后离开/放弃修改”确认，关闭弹窗留在原页面，放弃修改后才进入目标页面。验证脚本为 `scripts/cdp-stage1-route-check.mjs`。

体系详情在 `1440x900`、`1024x768`、`768x900` 和 `375x812` 四个宽度通过真实 Chrome 验收：应用导航固定、详情内容独立滚动、无横向溢出，概览统计和三级指标研究入口均可见。截图为 `artifacts/system-detail-1440.png` 和 `artifacts/system-detail-375.png`。

## 生产发布证据

- 最终 release：`/opt/mg-expert-database/releases/stage1-20260823-150621`。
- 当前 Web 资产：`assets/index-DcDJhYO8.js`。
- API systemd 服务状态：`active`；服务器本机和公网 `/api/health` 均返回 200。
- Prisma 迁移 `20260822000900_add_indicator_system_access` 状态为 `finished`，`IndicatorSystemAccess` 表和 Prisma Client 模型均存在。
- 最终发布备份：`/opt/mg-expert-database/backups/stage1-20260823-150621`；数据库 dump 为 56,988 字节，Web 备份 4 个文件，前一 release 为 `stage1-20260823-144510`。
- 公网首页、`/systems`、`/users` 和指标详情深链接均返回 SPA；未登录访问 `/api/auth/me` 和体系权限接口返回 401。
- 真实 Chrome 公网验证确认登录页无错误消息、企业微信扫码按钮可用、深链接可挂载；截图为 `artifacts/production-login-1440.png`，验证脚本为 `scripts/cdp-production-public-check.mjs`。
- 企业微信登录启动接口返回 200，目标域名为 `login.work.weixin.qq.com`，包含 `CorpApp`、企业 ID、应用 ID、回调地址和 state；状态 Cookie 使用 `HttpOnly` 与 `SameSite=Lax`。

首次上线 `stage1-20260823-144510` 后，真实浏览器发现生产子路径 API 仍请求根路径 `/api`，登录页出现 404。随后新增 API 基址推导、3 项单元测试和发布包静态门禁，并发布 `stage1-20260823-150621` 完成修复。该问题不能由单纯 HTTP 深链接检查发现，因此真实浏览器检查保留为后续发布门禁。

独立体系详情和返回路径发布为 `stage1-20260823-163007`。发布前通过 Contracts 4/4、API 29/29、Web 39/39、三端类型检查和生产构建；生产数据库备份位于 `/opt/mg-expert-database/backups/stage1-20260823-163007/database.dump`，发布后 `current` 指向对应不可变 release，API 为 `active`，公网首页、体系/用户/详情深链接和健康检查均返回 200。生产本地管理员凭据与开发验收账号不同，因此本次没有重复尝试登录；生产已登录页面仍待具有有效会话的用户补一次直接验收。

## 发布包

运行：

```powershell
.\scripts\build-stage1-release.ps1
```

发布包只包含：

- 完整 `apps/api/src`、Prisma Schema 和迁移
- `packages/contracts/src` 与本地构建的 `dist`
- `web/` 生产静态产物
- `SHA256SUMS`

发布入口只接受 SSH 私钥：

```powershell
.\scripts\deploy-stage1.ps1 `
  -IdentityFile C:\path\to\deploy-key `
  -ArchivePath .\artifacts\stage1-YYYYMMDD-HHMMSS.tar.gz `
  -ReleaseId stage1-YYYYMMDD-HHMMSS
```

远端脚本会从当前 release 复制出新的 immutable release，备份数据库和 Web 目录，执行 API 类型检查、Prisma Client 生成和正式迁移，再原子切换 `current`、重启 API 并等待健康，最后切换静态目录。失败时不会自动回滚，必须先检查脚本输出的备份目录和现场状态。
