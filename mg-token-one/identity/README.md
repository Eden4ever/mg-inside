> 认证后端与 GUI 已独立迁移到同级 `mg-auth-one-identity` 项目。本目录保留账号迁移工具、审批资料与业务接入契约。

# 元引统一身份服务

认证中心部署目标为 `https://identity.meta-gravity.com`。`../mg-auth-one-identity` 可独立构建、部署并使用独立 PostgreSQL 数据库，不依赖业务应用运行进程。账号密码、会话、MFA 和企业微信认证沿用指标库实现，标准授权协议使用 `oidc-provider`。

## 已实现

- 登录页提供“账号密码 / 禅道账号”两个 Tab，以及企业微信官方扫码登录入口；切换 Tab 清空密码。按最新要求继续保留禅道认证。
- 三种认证方式均进入同一中心会话；应用使用授权码和 S256 PKCE，校验签发方、签名、受众、state、nonce。
- Token One、指标库新增默认关闭的 SSO 配置，启用后自动进入中心，保留原用户 ID、权限和数据归属；账号设置与 MFA 在中心完成，业务应用只验证中心签发结果并保留 CSRF；MFA 要求由中心统一判断，业务应用不读取本地遗留 MFA 标记追加认证要求。
- 中心 `/admin` 管理员工身份、企微/禅道绑定和应用原账号映射；服务端检查管理员权限与 CSRF。
- 各应用启动和每分钟读取完整授权快照，登录时即时同步。中心授权的新用户自动生成本地身份映射；登录名、姓名、部门、启停状态均来自中心，保留业务角色、额度和历史用户 ID。整批冲突回滚并重试；已绑定但在完整快照中消失的用户停用。
- 每次受保护的 SSO 网页请求在线检查中心会话。中心退出、会话撤销或应用访问停用后，下次请求即被拒绝。中心不可达时拒绝 SSO 访问。

中心退出或任一应用退出均撤销当前中心会话，两应用下次请求即失效，不影响其他设备。业务应用的撤销接口要求 `session:revoke` 权限及该应用已签发的会话关联，不能凭员工 ID 注销其他设备。

启用 SSO 后，两个应用自动进入认证中心；包括本地管理员在内的旧本地会话与直接认证入口均拒绝访问，`?local=1` 不再提供绕过。业务系统禁止创建、删除账号、修改身份资料、重置密码和管理 MFA；只允许修改业务角色、分组和额度。旧企业微信建号同步关闭。中心 `/admin` 负责建号、员工资料、身份绑定与应用授权；`/account` 提供密码及认证器、邮箱、安全密钥和 MFA 管理。

Token One 的员工 `sk-` API 令牌不随网页登录退出撤销；中心停用经分钟同步及最多 60 秒缓存，正常运行时约两分钟内生效。同步故障会重试，不承诺故障期间的停用时限。企微目录同步只更新已绑定用户的姓名与部门，不根据某次缺失推断离职；离职需在中心明确停用。

## 账号关联

姓名仅去除首尾空格，用于生成核对候选，不做模糊匹配。管理员、重复姓名、停用及撤销身份单独核实。登录时不按姓名自动认领；中心授权后允许自动创建业务身份缓存，业务本身不创建独立账号。中心姓名有唯一约束，暂不允许同名多个身份。

审核后建立中心身份 → 企微 `(corpId, userid)` / 禅道 `(server, account)` → 应用授权。迁移用户填写原用户 ID，新用户留空，以中心 subject 自动生成映射。绑定有唯一约束，不能覆盖其他身份。禅道角色不会提升中心或应用权限。

```powershell
node --test identity/match.test.mjs
node identity/collect.mjs
node identity/collect-production.mjs
```

只读采集器不读取密码、API Token、MFA 密钥及业务正文；完整报告写入 Git 排除的 `identity/private/account-preview.json`。`candidate` 是待核对候选，`manual/conflict/blocked/unmatched` 均不自动写入。

## 本地验证（2026-09-08）

- 中心真实 HTTP 联调：双客户端 SSO、原账号映射、授权码重放拒绝、业务客户端 SDK、目录同步、应用停用、中心退出及旧 OIDC Cookie 不能绕过注销。
- 账号匹配策略 6 项通过；Token One 认证专项 6 项、网关 224 项、MySQL/网关端到端 6 项、生产脚本 75 项通过，前后端构建和类型检查通过。
- 指标库后端全量 82 项通过后新增切换策略测试，再次执行集成 46 项通过；前端全量 118 项通过，含登录页、反向代理子目录和页面路由。前后端生产构建通过。
- 中心空库迁移、重复部署和同名唯一约束通过；禅道绑定、身份不一致拒绝、角色保留和 MFA 衔接测试通过。
- 浏览器确认登录 Tab 切换、密码清空和企微未配置提示。构建时浏览器脚本保持原文，避免服务端 CommonJS 产物进入浏览器。
- Linux Docker 镜像构建及容器启动检查通过，验证了数据库连接、页面资源与未登录管理接口拒绝访问。
- 核对清单导入的成功映射、失败整批回滚、首次设置、重复导入拒绝通过；SDK 实测两个生产应用分别读取 11/16 条映射，且 Cookie 路径覆盖各自真实回调。

以上使用独立测试身份。真实企业微信扫码、生产禅道和业务应用生产登录尚未验收。早期 Keycloak spike 仅为协议调研，最终独立服务不需要 Keycloak。

## 复现

需要 Node.js 22.19+（建议 24）和 Docker，先构建 Token One 后端供客户端 SDK 联调。以下从仓库根目录执行：

```powershell
cd ../mg-auth-one-identity
npm ci
npm run generate
npm run build
cd ../..
node ../mg-auth-one-identity/scripts/local-test-setup.mjs
node --env-file=../mg-auth-one-identity/private/service-test/service.env ../mg-auth-one-identity/node_modules/prisma/build/index.js db push --schema ../mg-auth-one-identity/prisma/schema.prisma
node --env-file=../mg-auth-one-identity/private/service-test/service.env ../mg-auth-one-identity/scripts/seed-test.mjs
node --env-file=../mg-auth-one-identity/private/service-test/service.env ../mg-auth-one-identity/dist/main.js
```

另一终端：

```powershell
node --env-file=../mg-auth-one-identity/private/service-test/service.env --test ../mg-auth-one-identity/test/*.test.mjs
node --env-file=../mg-auth-one-identity/private/service-test/service.env ../mg-auth-one-identity/scripts/verify-migrations.mjs
```

测试结束停止身份进程，再执行 `docker stop mg-identity-service-test-db`，测试容器为临时实例。仅使用本机 15439 专用测试库；不要对业务库运行测试脚本。指标库集成测试可设置 `TEST_DATABASE_SCHEMA=mg_expert_test_唯一后缀`，避免旧测试结构冲突。

## 上线状态

2026-09-08 已完成中心新 GUI 与两业务应用生产 SSO 切换，原业务账号和权限保留。何子轩、刘雯婕已有中心身份已按用户要求设为身份管理员；应用角色不受影响。

详见同级认证项目 [完整发布与验收记录](../../mg-auth-one-identity/RELEASE-20260908.md)。本目录旧发布包已过时；本次 Token One 包为 `private/production/token-identity-gui-20260908.tar.gz`。知识库自动指标编码改动未发布。

## 本轮改造验证与发布边界

新增迁移 `20260908050000_central_provisioning` 允许应用授权的原账号 ID 为空。新账号由中心建立并授权，业务端仅生成身份映射；本地旧密码不再参与 SSO 验证，凭据和 MFA 密钥不会复制到业务系统。代码需构建新版本后再发布，原待发镜像与发布包已过时。业务应用生产开关已启用；指标库工作区的自动指标编码改动仍保留，未纳入认证发版。

本地 GUI：`http://127.0.0.1:4200/`；管理页 `/admin`；账号安全 `/account`。本地管理员凭据保存在受限目录 `../mg-auth-one-identity/private/service-test/local-admin.json`，不提交源码。运行的是独立测试库，不连接生产目录；本地未配置真实扫码登录。
