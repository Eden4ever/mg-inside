> 生产新 GUI、Token One 与知识库单点登录已于 2026-09-08 上线，详见 [发布记录](RELEASE-20260908.md)。

# 元引统一认证

独立的统一身份服务与管理 GUI，生产域名为 `identity.meta-gravity.com`。后端使用 NestJS、PostgreSQL、Prisma 与 OIDC；前端使用 Vue 3、Element Plus，沿用知识库的视觉样式。

## 项目结构

- `src`：账号、登录、MFA、企业微信、禅道、OIDC、授权目录 API。
- `web`：工作台、员工身份、应用授权、账号安全、认证配置 GUI。
- `clients`：业务应用接入 SDK 的契约副本。
- `prisma`：独立数据库结构和版本迁移。
- `scripts`、`test`：初始化、生产验证、集成测试与界面验证。
- `private`：本地凭据与测试输出，禁止提交。

## 本地使用

```powershell
npm ci
npm ci --prefix web
npm run generate
npm run build
node --env-file=private/service-test/service.env dist/main.js
```

界面地址 `http://127.0.0.1:4200/`。本地管理员凭据保存在 `private/service-test/local-admin.json`。原账号在项目搬迁后保留。

前端开发命令 `npm run dev:web`，端口 4201，API 代理至 4200。正式构建由后端同源托管，避免业务应用读取中心 Cookie。企业微信真实扫码及禅道在本地测试配置中关闭；本地应用卡片不跳转生产站点。

当前本地数据使用专用测试数据库容器 `mg-identity-service-test-db`，停止该临时容器会删除数据；不要存放真实业务资料。部署持久数据库请使用 `compose.yaml` 与 `DEPLOY.md`。

## 账号与同步规则

账号仅由统一认证创建、维护。中心管理员授予应用访问权限后，业务系统自动生成身份映射；旧账号迁移时填写原应用用户 ID。姓名冲突不自动合并，必须核对历史映射。业务用户表保留原 ID、角色、额度和历史归属，但不再接受本地建号和身份资料维护。

业务服务启动、每分钟以及登录时同步中心的登录名、姓名、部门、启停与授权状态。完整快照缺失的已绑定用户会停用，冲突时整批回滚并重试。密码和 MFA 密钥只保存在中心，不复制到业务系统。中心或应用退出后，其他应用的下次受保护请求将拒绝旧会话。

## 验证

```powershell
node --env-file=private/service-test/service.env --test test/*.test.mjs
node --env-file=private/service-test/service.env scripts/gui-smoke.cjs
```

中心集成测试要求专用本地测试库，并使用同级 `mg-token-one` 的已编译客户端验证协议兼容。GUI 测试使用本地 Chrome，创建的测试员工会在结束时清理，截图保存在 `private/gui`。

本项目于 2026-09-08 从 Token One 的 `identity/service` 拆出；两个业务项目同处 `C:\Projects\mg-inside`。现有 `C:\Projects\mg-auth-one` 是另一个项目，不受本次拆分影响。生产业务应用尚未切换到本轮新版本，上一阶段发布包需重新构建。

## 多角色与按主体授权

平台身份和应用授权统一由 `Role`、`UserRole`、`RoleApplication` 维护。内置“平台管理员”以唯一 `Role.key=platform-admin` 识别；不能删除、更名或通过普通角色 API 设置内置标识。同名普通角色没有管理能力。`User.role` 仅保留为废弃历史列，不再判权；对外 `user.role=system_admin/member` 从统一角色成员关系实时派生，兼容现有业务客户端。原 `ApplicationUser` 保留用户直接授权及不可随意覆盖的历史账号映射。

有效应用许可为：应用启用、用户启用，并且存在用户直接授权或至少一个角色授权。撤销一个来源不会覆盖其他来源；每次内省、管理接口守卫、OIDC 授权和目录会话校验重新读取数据库，不缓存许可。角色授权建立时记录不带直接许可的应用用户映射，撤销后业务目录仍能收到 `active:false`，不会将全部中心用户暴露给业务名录。

管理界面仅提供管理概览、员工身份、角色管理、应用授权、认证配置。应用授权以“用户”“角色”为主视角；用户视角展示直接授权开关、角色来源和最终生效状态。当前账号个人资料、安全、退出等由个人中心负责，旧 `/account` 路径转入个人中心；中心登录、MFA、`/auth/me` 与 `/account-security` 基础接口仍保留。

管理 API：

- `GET/POST /api/roles`、`PATCH/DELETE /api/roles/:roleId`：角色管理。角色仍有成员或启用应用授权时禁止删除。
- `PUT /api/roles/:roleId/members/:userId {enabled}`：增减成员。
- `PUT /api/roles/users/:userId {roleIds: string[]}`：原子设置一个用户的多个角色。
- `PUT /api/roles/:roleId/applications/:clientId {enabled}`：角色授权。
- `GET /api/applications/users/:userId`：各应用的 `direct`、`effective`、`sources`、`localUserId`、`foundation`。
- 原 `PUT /api/applications/:clientId/users/:userId` 保留，修改直接授权时不会抹去角色授权；不传 `localUserId` 可保留已有映射。

上述管理接口既要求显式 `identity` 应用授权，也要求 `platform-admin` 角色成员关系。所有授权写事务和管理员身份调整共用数据库事务锁，禁止撤销最后一位有效平台管理员。必要基础 audience 仅为承载桌面的 `desktop-one`（可用环境变量指定）与默认应用 `personal-center`、`files`；账号停用及应用停用仍会拒绝其令牌。`app-manager` 与 `identity` 等系统应用和内部应用都需显式授权，授权界面不提供个人中心和文件的分配开关。

Token One 的 `token-one`、`token-one-console`、`token-one-docs` 为三个独立授权 audience。三者复用同一枚中心令牌和同一 Token 服务机器身份；`token-one` 服务只可内省或撤销该固定家族内的目标，桌面服务可查询已登记目标，其余服务只能查询自身。`/api/unified/introspect`、`/api/unified/revoke` 接受 `app_id`（兼容 `targetAppId`）。控制台和文档可沿用门户原有 `localUserId` 映射，但映射存在不授予任何应用访问权。

### 兼容迁移及恢复

新增迁移 `20260908180000_multi_role_authorization` 只增表与必要应用记录，将既有启用系统管理员的旧身份管理能力转换为显式 `identity` 直接授权；不改变任何 `User.role`，不将已有 Token 门户授权自动复制给控制台或文档。新建空库管理员脚本同时授予其身份管理应用权限。

后续迁移 `20260908230000_app_manager_explicit_authorization` 确保 `app-manager` 已登记为可授权应用，保留已有启用状态和授权记录，不自动为用户或角色授权。原迁移保持不变；本地演示管理员的新增授权仅在用户明确指定的隔离环境单独执行，不写入通用迁移。

离线恢复需运维显式注入目标 `DATABASE_URL`，然后运行：

```sh
node scripts/recover-identity-access.mjs --grant-existing-admin existing-admin-username
```

该命令只恢复既有启用 `platform-admin` 角色成员的 `identity` 直接授权并记录审计，不创建管理员、不改密码、不提升普通成员权限。网页无恢复授权旁路。

本轮仅对 `mg_desktop_local_identity` 本地隔离 schema 执行迁移。该 schema 原为直接建表且无迁移记录，先使用 `migrate diff` 与改造前模型比较确认为空差异，再记录既有两条基线并执行增量；未 reset，未运行生产迁移。按用户明确要求，本地 `desktop-preview` 加入“演示管理员”角色并显式授予当时登记的业务应用，后续新增应用不会自动获得授权。

针对性验证：先构建后端及前端，使用本地隔离环境运行 `node --test test/application-access.test.mjs test/role-authorization.integration.test.mjs`。后者仅在允许的本地 schema 中运行，创建并清理独立测试账号和角色；`ROLE_GUI_VERIFY=1` 可额外生成浏览器验证截图。旧 SSO 集成脚本默认端口 4200，不应直接拿它覆盖当前 14200 隔离服务。

### 平台管理员角色迁移与发布顺序

追加迁移 `20260909000000_platform_administrator_role` 为角色增加可空唯一 `key`，取消名称唯一约束；创建内置平台管理员，并仅在该次迁移将既有 `User.role=system_admin` 且启用的用户加入角色。所有旧角色、成员、直接授权和角色应用授权保留。启动初始化只按 key 幂等补齐内置角色，不重复从历史列恢复成员，不给未来应用默认授权。用户创建/修改接受 `roleIds`，旧的可写 `role` 参数明确拒绝；角色分配、账号停用、identity 授权撤销共用事务锁和最后有效管理员保护。

本地演示账号在本轮迁移前后逐个比较全部用户的显式应用授权并集。该隔离环境仅有演示账号一位用户，因此将“演示管理员”已有应用授权并入平台管理员，并移除演示账号的旧角色关系，权限并集未扩大或缩小。此操作不在通用 SQL 中，不应自动复制到生产。

生产发布由统一发布流程执行：

1. 备份目标数据库及当前构建，核验目标数据库、现有启用管理员及其有效 identity 授权，保存用户角色与应用授权快照；确认不存在占用迁移固定角色 ID 的旧记录。
2. 暂停身份管理写操作并停止旧中心进程，部署本版代码和 Prisma Client，再执行 `prisma migrate deploy`；不得重置数据库、重写已应用迁移或运行本地演示授权脚本。
3. 核对旧启用管理员均加入 `platform-admin`、至少一名启用成员仍可访问 identity；原应用授权并集保持一致。启动中心后验证登录、同令牌内省、授权管理、最后管理员保护及默认应用边界，再开放管理写入。
4. `role` 兼容输出仅反映当前统一角色；业务应用仍逐 audience 显式授权。Token/知识库的细分业务权限不在本轮迁移范围。

回滚不能直接启动仍按 `User.role` 判权的旧版本：历史列可能与新角色关系不一致，会让已撤销管理员恢复权限或让新管理员失去权限。首选前向修复；确需旧版回滚时，在停止管理写入后先按 `platform-admin` 成员关系同步兼容列并核对 identity 授权，再切换旧版。若恢复数据库备份，会丢失备份后新增的角色、成员和授权变更，必须先导出并明确处理这些差异。内置角色初始化不是浏览器恢复旁路；离线恢复 CLI 仅接受现存启用平台管理员成员。

### 认证根站与桌面管理页的双构建

前端 `VITE_APP_BASE` 默认为 `/`，用于现有认证域名；登录、MFA、企业微信返回、`/interaction/:id`、`/api/unified/authorize` 和 `/api` 保持认证域名根路径，不改变后端 issuer。桌面管理页构建设置 `VITE_APP_BASE=/apps/identity/`，并通过 `VITE_DESKTOP_ORIGIN` 指定桌面源。Vue Router 和静态资源使用同一 base，HTML 的 `application-base` 元数据供公共 SDK 去掉挂载前缀。

子路径管理页无论嵌入还是独立浏览器访问，都经桌面的 `/api/apps/identity` 代理访问 API。未登录时使用公共 SDK 跳转桌面 `/auth/start?app=identity`，返回参数仅包含应用内管理路径，再由桌面进入既有认证域名；不会在桌面域名提交中心密码或 MFA。根路径包仍显示现有统一登录页。

发布时分别构建并保留两份产物：认证域名用 `/` 包，桌面挂载目录用 `/apps/identity/` 包。不要将桌面子路径包复制到身份后端的根路径静态目录。可在 `web` 工作目录为桌面构建指定独立 `--outDir ../.runtime/release/identity-desktop`，再由统一发布流程放入桌面挂载目录；反向代理需将该子路径下的前端路由回退到同目录 `index.html`。`node scripts/verify-web-bases.mjs` 在独立目录构建两份包并用模拟 API 验证，不覆盖本地运行中的认证服务产物。


## 企业微信头像

追加迁移 `20260909010000_profile_avatar` 添加可空的 `User.avatarUrl` 缓存。中心 `/api/auth/me`、统一令牌内省及管理用户资料返回 `avatarUrl: string | null`；权威客户端允许字段缺省以兼容旧中心。只接受 HTTPS 图片地址，旧企微 qlogo.cn/qpic.cn HTTP 地址升级 HTTPS，头像请求不附带页面来源。头像不可用时客户端回退姓名首字。

现有企微资料同步顺带读取 `avatar`（其次 `thumb_avatar`），不增加拉取范围；企微登录只读取当前已绑定启用账号本人的头像。上游缺少字段、返回无效地址或网络失败会保留缓存，明确空头像才清空。当前应用已有权限不返回头像时，不自动增加 OAuth scope 或额外收集其他资料。

部署时先运行追加迁移，再启动新中心与前端。已登录会话下次资料读取即可看到新缓存，不需要换令牌。要补齐已有绑定账号，请使用中心服务原环境：

```sh
node --env-file=/path/to/service.env scripts/sync-wecom-avatars.mjs
node --env-file=/path/to/service.env scripts/sync-wecom-avatars.mjs --apply
```

首条只预检；第二条只更新既有绑定且启用用户的头像（及常规更新时间），不创建用户、不改姓名、部门、角色或授权。脚本只调用这些绑定成员的 `user/get`，不调用整个通讯录同步；同一账号同步期间解绑、停用、撤销或头像被其他流程更新时跳过。重复执行幂等，只输出总数、更新、未变、未返回头像、失败和跳过计数，不输出用户资料或机密。出现部分失败可安全重跑。数据库字段为向后兼容的可空新增列，回滚代码时保留此列即可。
