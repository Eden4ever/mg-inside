# 独立身份服务部署

> 当前生产状态以 [2026-09-08 发布记录](RELEASE-20260908.md) 为准：中心新 GUI 和两业务 SSO 均已上线。

## 配置

本目录可独立部署。创建仅含应用注册信息的 JSON，将占位域名换为实际业务域名：

```json
[
  {"client_id":"token-one","client_name":"Token One","redirect_uris":["https://token.meta-gravity.com/api/auth/sso/callback"]},
  {"client_id":"expert-database","client_name":"指标数据库","redirect_uris":["https://yshj.meta-gravity.com/knowledge-base-inside/api/auth/sso/callback"]}
]
```

运行 `node scripts/generate-secrets.mjs 应用注册.json secrets`，目标目录必须尚不存在。身份私钥、Cookie 密钥、加密密钥和客户端机密只写入文件，不输出终端。`token-one.env` 与 `expert-database.env` 分别给对应后端使用，开关默认关闭，机密不能混用。

按 `config.example` 创建 `secrets/postgres.env`、`secrets/service.env`。数据库用强随机密码，`DATABASE_URL` 密码须 URL 编码，compose 数据库主机为 `db`。机密文件仅允许运行服务的 UID 1000 和受控管理员读取；Windows 用 ACL 限制访问。不要提交密钥、报告或备份。

企微配置沿用指标库的 `WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_APP_SECRET`，回调改为 `https://identity.meta-gravity.com/api/auth/wecom/callback`。后台配置中心域名、应用可见范围和可信 IP 后启用 `WECOM_LOGIN_ENABLED`。扫码入口打开企业微信官方登录页。

用户提供的实际上游配置保存在仓库外发版范围的 `identity/private/production/providers.env`，目录 ACL 仅允许当前 Windows 用户和 SYSTEM 读取。已经通过受控 SSH 渠道合入服务器 `secrets/service.env`，未放入镜像。中心服务器 `1.12.253.86` 的可信 IP 已生效；应用信息、8 个部门及 17 名成员均读取成功。

2026-09-08 公网 DNS 查询确认 `identity.meta-gravity.com` 已解析到 `1.12.253.86`。沿用现有域名解析时，中心部署与企微信任 IP 应选择此服务器；本次没有修改 DNS。

2026-09-08 已部署域名校验文件 `/var/www/mg-identity/public/WW_verify_HVb3TsF9mFBIsqUv.txt`，HTTP 与 HTTPS 根路径均返回 200，SHA-256 与用户原文件一致。已配置 `/etc/nginx/conf.d/identity.meta-gravity.conf` 并签发该域名的 Let's Encrypt 证书（本次到期日 2026-12-07），现有 Certbot 定时续期和 Nginx reload hook 可继续使用。已保留校验文件及 ACME 路径，其余 HTTPS 请求代理到 `127.0.0.1:4200`。两个业务站点检查仍正常。

域名验证已完成，企业微信配置中的回调域名为 `identity.meta-gravity.com`。实际扫码入口指向官方 `login.work.weixin.qq.com`，回调 URI 已核对；真实员工扫码仍须由员工本人完成验收。

可复验：从仓库根目录执行 `node --env-file=../mg-token-one/identity/private/production/providers.env scripts/check-providers.mjs`；服务器验证使用 `check-wecom-server.mjs 服务器IP`。后者使用 SSH Agent 和既有主机密钥校验，机密通过 SSH 的 stdin 传入远端内存，不写入服务器文件。仅输出状态码、出口 IP 和可见数量，不输出上游令牌、Secret 或员工资料。

禅道地址为 `ZENTAO_BASE_URL=https://pm.meta-gravity.com`，确认账号映射后启用 `ZENTAO_ENABLED=true`。生产要求 HTTPS。沿用现有 REST `tokens` / `user` 接口，密码仅用于当次验证，不存储、不发送给业务应用。中心管理页先关联审核过的禅道账号。

2026-09-08 已通过 SSH Agent 的“腾讯云”密钥，以 root 连接 `106.52.90.82` 并核对既有 SSH 主机密钥。服务器运行 `hub.zentao.net/app/zentao:22.1`，Nginx 将该域名代理到本机 `127.0.0.1:18080`。外网 HTTPS 校验通过，未认证的 `GET /api.php/v1/user` 返回 401，`OPTIONS /api.php/v1/tokens` 返回 204。该检查未提交真实账号密码，也未更改禅道服务器配置。

## 启动

```sh
docker compose build identity
docker compose up -d db
docker compose run --rm identity node node_modules/prisma/build/index.js migrate deploy
```

初始化仅允许空身份库。通过机密管理器或受限临时环境文件，向初始化进程注入 `IDENTITY_BOOTSTRAP_USERNAME`、`IDENTITY_BOOTSTRAP_PASSWORD`（至少 15 位）及可选 `IDENTITY_BOOTSTRAP_NAME`，执行 `node scripts/bootstrap-admin.mjs`。使用 compose 时将这些变量加入 `docker compose run --rm identity` 的环境。完成后移除初始化密码。命令不会输出密码或覆盖既有用户。

运行 `docker compose up -d identity`。服务只映射宿主机 `127.0.0.1:4200`，数据库不开放宿主机端口。完成域名 DNS 与可信证书后启用 `nginx.conf.example`，Nginx 终止 HTTPS 并覆盖转发头，不得把身份容器直接暴露公网。检查 `/health`、`/.well-known/openid-configuration`；签发方必须精确为 `https://identity.meta-gravity.com`。

## 灰度接入

1. 只读盘点并核对历史账号。在中心 `/admin` 创建或选择唯一身份，关联企微/禅道账号，填写各应用原用户 ID。中心角色和各应用角色分别管理。
2. 备份业务库。Token One 用现有 `npm run migrate` 执行 `migration-add-identity.sql`；指标库执行 Prisma `migrate deploy`，包含 `20260908030000_identity_sso`。仅加列和索引，不重建用户。指标库可能有其他待发布迁移，发版前核实范围。
3. 各应用后端注入对应客户端配置，回调与注册白名单完全一致。指标库 `WEB_APP_URL` 仍为业务域名。
4. 核对完成后把灰度应用 `IDENTITY_ENABLED=true`，应用自动进入中心。三种认证方式共用中心 SSO。普通员工旧会话需重新登录，旧直接认证与企微建号同步停止。包括本地管理员在内的直接认证均关闭，`?local=1` 不提供绕过；企微与禅道在中心继续保留。
5. 验收真实扫码、禅道/本地登录、两应用 SSO、权限隔离、MFA、额度/Token/数据归属、并发绑定冲突、同步、停用和中心退出。按最新需求保留禅道认证。

## 恢复

中心故障时 SSO 网页请求拒绝访问；业务系统不保留绕过统一认证的本地管理员登录。目录每分钟按应用完整快照同步，失败重试；缺页不当成员删除。离职在中心明确停用。

任一应用退出会调用中心撤销接口，使当前中心会话在两应用同时失效；应用机密必须获 `session:revoke`，且只能撤销已向该应用签发过授权的会话。撤销失败时界面提示重试，不宣称已全局退出。其他设备会话不受影响。

## 本次发布记录

- 中心：`/opt/mg-identity`，镜像 `mg-identity-service:20260908-sso`，PostgreSQL 无宿主机端口，身份服务只监听 `127.0.0.1:4200`。
- 初始化及导入前后备份：`/var/backups/mg-identity/20260908`，包含数据库、密钥和原 Nginx 配置。
- 用户清单与批准记录：本地受限目录 `identity/private/production/approved-bindings.json`。已导入 16 名员工、27 条原应用映射、10 条禅道关联；中心角色均为普通成员，应用角色没有提升。
- 独立初始化管理员凭据：本地受限 `identity/private/production/secrets/bootstrap.env`；已从生产服务环境和挂载目录移除，受限备份仍保留。生产账号密码与管理接口已用此账号核验，检查会话随后撤销。
- 后续已完成两业务生产启用，指标自动编码未纳入本次发布，见最新发布记录。

备份 PostgreSQL、`identity.json`、`auth-config.key`；后者丢失会导致 MFA/邮件配置密文无法恢复。签名轮换保留旧公钥直到相关令牌失效；Cookie 密钥数组首项用于签名、其余用于验证。客户端机密更新需协调对应应用，旧登录流程最长 10 分钟。

生产故障优先修复当前认证兼容版本；不得通过关闭 `IDENTITY_ENABLED` 恢复旧入口绕过中心停用或 MFA。保留新增列、绑定和审计数据，不删除用户或覆盖新业务数据。原 SSO 会话需重新登录；关闭开关不会清除中心同步的停用标志，恢复用户访问应单独核实。

## 独立 GUI 构建

Docker 构建会安装 `web` 的锁定依赖并构建 Vue/Element Plus GUI，静态文件和认证 API 由同一端口提供。直接在本地构建前运行 `npm ci` 和 `npm ci --prefix web`。服务代码已迁至 `C:\Projects\mg-inside\mg-auth-one-identity`。业务项目修改后必须重新打包；不得使用拆分前的旧发布包。
