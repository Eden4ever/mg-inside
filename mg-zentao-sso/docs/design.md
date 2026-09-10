# 禅道接入统一身份单点登录

让用户从平台免密进入禅道。做法是给禅道加一个 OIDC 依赖方扩展，以统一身份中心为身份源。不改禅道原始代码，走官方扩展目录，升级不覆盖。

本轮不做登录时效与单点登出：禅道会话与平台会话相互独立，平台登出不会踢掉禅道会话。

## 现场事实（均在服务器实测确认）

### 禅道

| 项 | 值 |
| --- | --- |
| 版本 / 版次 | 22.1，`$config->edition = 'open'`（开源版） |
| 部署 | `106.52.90.82`，官方镜像 `thub.zentao.net/app/zentao:22.1`，容器 `zentao-app` + `zentao-db` |
| 应用根 | 容器内 `/apps/zentao` |
| 唯一 bind 挂载 | 宿主 `/opt/zentao/data` → 容器 `/data`，其中只有 `www/data` 被软链回应用目录 |
| 扩展开关 | `$config->framework->extensionLevel = 1`，公共扩展会加载 |
| 对外访问 | 容器内可访问 `https://identity.meta-gravity.com`，discovery 返回 200 |

开源版没有 LDAP（企业版及以上），`user` 模块只有 `login`/`deny`/`logout`，没有令牌登录入口。内置 `sso` 模块只硬编码了然之与飞书两家，不是通用入口。飞书那条是标准 OAuth2 授权码流，本方案照它的形状实现。

### 扩展机制

`router.class.php` 的两处决定了写法：

- `setActionExtFile()` 按 `extension/custom/<模块>/ext/control/<方法名小写>.php` 查找；命中时**该文件替代模块的 control.php 被引入**，同时注册自动加载让原类仍可用。
- 第 1726 行：`$className = class_exists("my$moduleName") ? "my$moduleName" : $moduleName;`

所以每个扩展动作是一个独立文件，内容为 `class mySso extends sso { ... }`。多个动作各自一个文件，各自定义同名类，因为一次请求只引入其中一个，不会重复声明。

### 统一身份中心

标准 OIDC provider，`https://identity.meta-gravity.com`：

| 端点 | 地址 |
| --- | --- |
| authorization | `/auth` |
| token | `/token` |
| userinfo | `/me` |
| jwks | `/jwks` |
| end_session | `/session/end` |

- `grant_types_supported` 含 `authorization_code`
- `code_challenge_methods_supported` 为 `S256`
- `token_endpoint_auth_methods_supported` 含 `client_secret_basic`、`client_secret_post`
- `scopes_supported`：`openid`、`profile`、`directory:read`、`session:revoke`
- `claims_supported` 含 `sub`、`preferred_username`、`name`、`department`、`local_user_id`

## 流程

1. 用户在禅道登录页点「统一身份登录」，进入 `sso/mgAuthen`。
2. 扩展生成 `state` 与 PKCE `code_verifier`，存入禅道会话，重定向到中心 `/auth`。
3. 中心认证完成后回调 `sso/mgLogin?code=...&state=...`。
4. 扩展校验 `state`，用 `code` + `code_verifier` 向 `/token` 换取令牌（后端直连，带 client_secret）。
5. 用 access token 调 `/me` 取用户信息，取 `preferred_username` 作为映射键。
6. 按映射键查禅道用户；**只认已存在且未删除的账号**，找不到就报错提示管理员先建号绑定，不自动建号、不按姓名认领、不从中心提升权限。
7. 命中后 `user->identify()` + `user->login()` 建立禅道会话，跳转到 `my/index`。

第 6 步与平台侧 `mg-auth-one-identity/src/zentao-auth.ts` 的既有策略保持一致（“只认已审核的稳定绑定；不按姓名认领、不建号、不从禅道提升角色”），方向相反但原则相同。

## 账号映射

绑定关系已经存在于身份中心：`ZentaoIdentity` 表有 10 条 `(https://pm.meta-gravity.com, account) → userId` 记录，`approved-bindings.json` 中同样 10 位用户带 `zentaoAccounts`，`ZENTAO_ENABLED` 已为 true。禅道账号与平台账号是同一批人。

**但不能用 `preferred_username` 做映射。** 实测这 10 位用户中只有 5 位的平台 `username` 与禅道账号相同，另外 5 位（许向玲、刘雯婕、颜高飞、刘基军、谢丹）平台用户名为空，`preferred_username` 取不到值，登录会失败。

按「谁执行谁拥有数据」，绑定关系由身份中心拥有，应由中心在 userinfo 中下发禅道账号。因此：

- 身份中心需要新增一个 `zentao_account` 声明，取自该用户的 `ZentaoIdentity` 绑定。这是本方案剩余的唯一开发项。
- 扩展按 `accountClaims` 顺序取值：先 `zentao_account`，回退 `preferred_username`。在中心补上声明之前，只有用户名恰好一致的 5 位可用；补上之后 10 位全部可用。

不采用按 `sub` 在 `zt_user` 加列的方案，那需要一次性回填，且把绑定关系复制到了禅道侧，与数据归属原则相悖。

## 安全约束

- `client_secret` 只存在禅道服务器的配置文件里，不进代码仓库、不出现在前端。
- `state` 与 `code_verifier` 存服务端会话，回调时一次性校验并清除。
- 只接受中心签发且 `iss` 匹配的令牌。
- 账号停用（`deleted` 或禅道侧禁用）时拒绝登录。
- 不改动原有账号密码登录入口，扩展只是新增一条通道；出问题删掉扩展目录即可回滚。

## 待办与风险

- **扩展持久化**：容器内 `/apps/zentao/extension` 位于镜像写层，宿主 `/opt/zentao/data/zentao/extension` 与之不是同一目录，entrypoint 也不同步。拷贝进容器可立即生效且随时回滚，但镜像升级重建容器后需要重新放置。要长期持久需加 bind mount，那需要重建容器，生产会有一次中断。
- **需要在身份中心注册禅道这个 OIDC 客户端**。客户端登记在 `43.139.78.226:/opt/mg-identity/secrets/identity.json` 的 `clients` 数组，条目形如 `{client_id, client_name, redirect_uris[], client_secret}`，现有 7 个。redirect_uri 为 `https://pm.meta-gravity.com/index.php?m=sso&f=mgLogin`。
- **需要在禅道 `config/my.php` 放开匿名访问**：`$config->openMethods[] = 'sso.mgauthen';` 与 `$config->openMethods[] = 'sso.mglogin';`。判定逻辑在 `common/model.php` 的 `isOpenMethod()`，方法名小写匹配。未放开时入口会被登录检查拦截并 302 跳回登录页——已实测确认。
- 容器内 PHP 不在默认 PATH，做语法检查需要先定位 php 可执行文件。
