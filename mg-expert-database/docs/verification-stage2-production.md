# 阶段二生产发布验收

验收日期：2026-08-24

## 发布范围

阶段二将体系级权限模型及其管理界面发布到生产环境，并将 API 运行方式从 `tsx` 源码执行切换为本地编译后的 Node.js 产物。生产服务器只执行 Prisma Client 生成和数据库迁移，不执行 TypeScript 或 Web 构建。

## 发布包

- Release ID：`stage2-20260823-190000`
- 本地归档：`artifacts/stage2-20260823-190000.tar.gz`
- SHA256：`1bc6bfcb6b9af65d218349d297ef9b4383dda59660c7952fed9bda57206451c3`
- 归档大小：507,962 字节
- Web 基路径：`/knowledge-base-inside/`
- Web API 基路径：`/knowledge-base-inside/api`

上传后在生产服务器再次计算 SHA256，结果与本地一致。归档内 64 项文件的 `SHA256SUMS` 校验全部通过。

## 生产变更

- `current` 已从 `/opt/mg-expert-database/releases/stage1-20260823-163007` 切换到 `/opt/mg-expert-database/releases/stage2-20260823-190000`。
- systemd 服务为 `active`。
- `WorkingDirectory=/opt/mg-expert-database/current`。
- `ExecStart=/usr/bin/node apps/api/dist/apps/api/src/main.js`。
- API 本机健康检查返回 `status: ok`。
- Prisma 识别 10 个迁移，数据库 Schema 为最新状态。
- `20260822000900_add_indicator_system_access` 已完成。
- 生产库有 4 个指标体系和 45 条体系权限记录。
- 何子轩账号状态为 `system_admin / active / wecom`。

## 备份与回滚点

备份目录：`/opt/mg-expert-database/backups/stage2-20260823-190000`

- PostgreSQL 自定义格式备份：`database.dump`，61,090 字节。
- 旧 systemd 单元：`mg-expert-database-api.service`，604 字节。
- 旧 Web 静态文件：已完整复制到备份目录。
- 旧 release 指针：`stage1-20260823-163007`。
- 旧 Web 目录：`/var/www/mg-expert-database/.knowledge-base-inside.stage2-20260823-190000.previous`。

远端发布脚本在失败时会尝试恢复旧 `current`、systemd 单元和 Web 目录，并重启旧 API。本次发布未触发回滚。

## 公网验收

以下地址从独立公网请求返回 200：

- `/knowledge-base-inside/`
- `/knowledge-base-inside/login`
- `/knowledge-base-inside/systems`
- `/knowledge-base-inside/api/health`
- `/knowledge-base-inside/api/auth/wecom/status`

未登录请求 `/knowledge-base-inside/api/systems` 返回 401。企业微信状态接口返回 `enabled: true`；启动接口返回 200，登录目标为 `login.work.weixin.qq.com/wwlogin/sso/login`，包含随机 state，状态 Cookie 具有 `HttpOnly`、`SameSite=Lax` 和 `Secure`。

真实 Chrome 验收确认首页及任意指标深链接均能挂载登录界面，标题、账号密码输入、企业微信扫码按钮正常，按钮可用且无前端错误消息。截图为 `artifacts/production-login-1440.png`，该目录不进入 Git。

## 未覆盖项

生产环境不保存管理员明文密码，开发环境管理员凭据与生产不一致；当前浏览器也没有可复用的生产登录会话。因此本次未自动执行登录后的浏览器返回/前进、体系详情刷新及权限对话框保存流程。数据库迁移、角色数据、本地自动化测试和权限表数据均已验证，但不能替代这项用户流程证据。

补充验收时应使用现有企业微信账号登录生产环境，再依次运行：

```powershell
$env:APP_BASE_URL='https://yshj.meta-gravity.com/knowledge-base-inside'
node scripts/cdp-stage1-route-check.mjs
node scripts/cdp-system-access-check.mjs
```

权限脚本只切换一名非管理员用户的发布权限，保存成功后立即恢复原值，并校验最终权限数组与修改前一致。
