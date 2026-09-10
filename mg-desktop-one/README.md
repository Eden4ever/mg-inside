# MG 统一桌面

2026-09-09：桌面、统一身份、文件、Office One 和资源管理已统一迁移到 `43.139.78.226`。详见 [迁移记录](deploy/migration-20260909.md)。

本地入口：`http://127.0.0.1:4301/`。登录统一跳转身份中心。桌面与业务服务使用中心签发的同一枚访问令牌，浏览器仅持有 HttpOnly Cookie，应用各自保留业务角色、数据权限和额度。

## 目录职责

- `mg-platform`：唯一公共前端源码，包括框架、页头、导航、页面容器、会话客户端与桌面协议。三个既有应用及个人中心直接引用，不生成副本。
- `mg-desktop-one`：桌面前端、窗口管理及迁移验证。
- `mg-platform-kernel`：Java 桌面后端，负责应用目录、统一 API 代理、偏好与服务治理。
- `mg-personal-one`：个人资料、账号安全、桌面偏好。硬件安全密钥仍回统一认证原站点管理，保持已有 WebAuthn 来源与凭证绑定。
- `mg-auth-one-identity`：统一令牌与身份管理、员工及应用授权、认证配置。
- `mg-token-one`：同一仓库提供门户、控制台和文档三个独立桌面入口，继续共用业务后端。
- `mg-expert-database`：指标知识库业务。

Token One 三个入口使用各自应用 ID 独立授权；统一认证模式下，控制台由 `token-one-console` 授权决定访问，不再要求旧业务管理员标志。个人中心通过独立接口白名单代理本人信息和账号安全，不能借此调用员工或应用管理接口。

## 本地开发

要求 Node >=22.19，各仓库已安装依赖。应用通过 Vite alias 引用同级 `mg-platform/packages/frontend`；CI 也需要检出平台的固定版本。内部 npm 包发布是后续规划，当前没有运行时 CDN 依赖。

`scripts/prepare-local.mjs` 使用现有本地数据库连接配置，创建隔离的体验 schema/数据库，生成 `.runtime/local/*.env` 和体验账号。数据库保护检查只接受明确的本地端口；账号密码和服务机密不写入本文档。

| 服务 | 端口 | 本地配置 |
| --- | --- | --- |
| 身份中心 API/前端静态页 | 14200 | `.runtime/local/identity.env` |
| Token API / Vite | 14310 / 14311 | `token.env` / `web.env` |
| 知识库 API / Vite | 14320 / 14321 | `expert.env` / `web.env` |
| 个人中心 Vite | 14331 | 个人中心目录 `.env.local` |
| 桌面 API / Vite | 4300 / 4301 | `desktop.env` |

在桌面目录运行：

```powershell
npm run dev:server
# 另一个终端
npm run dev:web
```

`dev:server` 启动同级 `mg-platform-kernel` 的 Java JAR，默认读取 `.runtime/local/desktop.env`，可通过 `DESKTOP_ENV_FILE` 指定配置。首次启动前在内核项目执行 `scripts/java-maven.ps1 package`；优先使用 `JAVA_HOME`，其次使用项目便携 Java 25。

应用注册现在仅从 `SERVICE_DATABASE_URL` 指向的数据库读取；缺少配置时不再回退内置目录。先按 [应用注册唯一来源](../mg-platform-kernel/docs/application-registration.md) 显式迁移注册清单；既有数据库可执行 `desktop-applications schema` 升级结构。`npm run test:applications` 使用独立 PostgreSQL 与 JAR 验证完整注册读取链路，不占用现有本地端口。

旧 `apps/server` 暂时保留用于兼容对照和离线治理工具，默认开发入口已切换为 Java。内核构建仍引用旧目录中的 OpenAPI Schema，删除旧后端前需要迁移该资源及相关构建、验证脚本。

其余应用在各自目录启动，显式传入上述环境文件。中心前端由后端提供，改动后在 `mg-auth-one-identity/web` 构建，再在 `mg-auth-one-identity` 执行 `node scripts/copy-static.mjs`。个人中心使用 `npm run dev`。现有本地服务不要重复占用端口，也不要停止非本任务服务。

## 统一窗口规则

`apps/web/src/windows/geometry.ts` 是唯一位置边界计算来源：

1. 所有模式无外边距；移动、缩放和恢复使用同一裁切函数。
2. 普通浮窗可进入 Dock 区域；Dock 保持在窗口上层，空白区域不阻挡窗口操作。
3. 最大化、左右半屏截止 Dock 顶边；半屏无中缝。
4. 保留圆角和外阴影；工作区允许阴影向 Dock 区域延伸。
5. 桌面标题栏透明，应用画布延伸到标题下面；业务内容预留 42px 窗口控制区，阴影和圆角底色在同一文档内绘制。

## 验证入口

```powershell
npm test
npm run typecheck
node scripts/verify-p0.mjs
node scripts/verify-proxy.mjs
node scripts/verify-desktop-ui.mjs
node scripts/verify-standalone.mjs
node scripts/verify-platform-ui.mjs
node scripts/verify-new-apps.mjs
```

真实联调使用隔离体验账号。`verify-new-apps` 的偏好写入在浏览器上下文中模拟，不覆盖用户真实偏好；代理脚本的偏好持久化使用独立临时目录。业务关闭保护测试仅操作本地“桌面体验示例 · 非业务数据”。

生产已发布到 `https://desktop.meta-gravity.com`，系统与默认应用使用桌面域名下的应用路径；认证签发者沿用现有独立认证域名。Token One 与指标知识库在各自原有服务器原地更新。服务器连接通过 1Password 中的腾讯云 SSH Agent，不保存私钥副本。版本、备份及验证记录见 `deploy/`。
