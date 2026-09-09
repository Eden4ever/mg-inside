# 企业微信认证与用户管理接入说明

> 状态：M1 认证改造的实现依据，最后按企业微信官方开发者中心于 2026-08-21 核对。
>
> 本文只规定认证接入和用户管理边界。真实实施完成前，当前 `X-User-Role` / `X-User-Name` 演示请求头不得被视为安全认证，也不得在生产环境保留为授权来源。

## 1. 接入决策

本系统是企业内部的桌面 Web 系统，推荐先以**单一企业的自建应用**接入：

| 访问场景 | 应采用的官方能力 | 不应采用的能力 |
| --- | --- | --- |
| PC 或普通桌面浏览器的登录页 | 新版「企业微信 Web 登录」扫码组件或其跳转登录链接，`login_type=CorpApp` | 企业微信内网页授权；旧版扫码登录 |
| 企业微信客户端内打开本系统 | 「网页授权登录」OAuth2 链接 | PC 扫码登录作为唯一入口 |
| 多企业 SaaS，且本系统已具备服务商资质 | `login_type=ServiceApp`，另行实现服务商套件与授权企业上下文 | 把自建应用 `corpsecret` / `gettoken` 流程套用于服务商 |

企业微信的 Web 登录文档建议旧版扫码登录迁移至新版方式。当前需求未给出服务商资质和多租户授权信息，M1 应实现 `CorpApp`；可预留 `WECOM_LOGIN_TYPE`，但不应伪实现 `ServiceApp`。

## 2. PC 扫码登录流程

### 2.1 推荐的登录页行为

登录页提供「企业微信扫码登录」作为企业成员的主入口；账号密码仅在业务确认需要本地应急账号时保留。前端获取的 `code` 只交给本系统 API，不能自行请求企业微信令牌，也不能把 `Secret`、`access_token` 或企业微信返回的成员身份保存在浏览器持久化存储中。

推荐使用官方 `@wecom/jssdk`（版本不低于 `2.3.2`）的 `ww.createWWLoginPanel`：

```ts
ww.createWWLoginPanel({
  el: '#wecom-login',
  params: {
    login_type: 'CorpApp',
    appid: CORP_ID,
    agentid: AGENT_ID,
    redirect_uri: CALLBACK_URL,
    state,
    redirect_type: 'callback',
    panel_size: 'middle',
    lang: 'zh',
  },
  onLoginSuccess({ code }) {
    // 只把 code + 本地会话绑定的 state 交给后端。
  },
  onLoginFail(error) {
    // 记录可诊断但不含 code、token 的错误信息。
  },
});
```

`redirect_type='callback'` 时，组件在 `onLoginSuccess` 返回 `code`。若采用页面跳转，而非组件，后端应生成如下 URL 后重定向浏览器：

```text
https://login.work.weixin.qq.com/wwlogin/sso/login
  ?login_type=CorpApp
  &appid=CORP_ID
  &agentid=AGENT_ID
  &redirect_uri=URL_ENCODED_CALLBACK_URL
  &state=URL_ENCODED_STATE
  &lang=zh
```

参数规则：

| 参数 | CorpApp 要求 | 处理规则 |
| --- | --- | --- |
| `login_type` | 固定 `CorpApp` | 服务商模式才使用 `ServiceApp` |
| `appid` | 企业 `CorpID` | 不是 AgentId |
| `agentid` | 自建应用的 `AgentId` | 必填使用；扫码成员必须在该应用可见范围内 |
| `redirect_uri` | 本系统服务端回调地址 | 必须 URL 编码，域名必须配置为该应用的可信域名 |
| `state` | 每次登录随机生成 | 必须 URL 编码；企业微信成功后原样回传 |
| `lang` | 可选 `zh` 或 `en` | 本系统使用 `zh` |

成功时企业微信会回调 `redirect_uri?code=CODE&state=STATE`。`code` 不是本系统登录凭据，必须只在后端一次性换取身份；不可写入 URL 日志、分析系统、审计明细或前端状态持久化。

### 2.2 回调、CSRF 与本系统会话

1. `GET /api/auth/wecom/start` 由服务器生成至少 128 位密码学随机值 `state`，并在服务端保存其哈希、发起会话、`returnTo`、创建时间和未使用状态；有效期建议 10 分钟。
2. 服务器把 `state` 绑定到临时 `HttpOnly`、`Secure`（生产）、`SameSite=Lax` Cookie 或服务端预认证会话，再重定向到企业微信登录地址。
3. `GET /api/auth/wecom/callback?code=...&state=...` 仅接受 HTTPS 的 GET 回调。先做常量时间比较，确认 state 存在、未过期、未使用且属于同一浏览器会话；不通过时返回通用登录失败页并清理预认证会话。
4. state 校验成功后立即标记为已使用，再用 `code` 请求企业微信身份接口。企业微信也规定 `code` 一次性且 5 分钟过期；重放、重复回调、缺失参数均拒绝。
5. 仅当返回了本企业内部成员 `userid`、且本地用户已启用并已授权时，创建本系统 Session。Session ID 本身应为高熵不透明随机值，服务端只存哈希；响应通过 `HttpOnly; Secure; SameSite=Lax; Path=/` Cookie 返回。
6. 回调完成后 303 跳转到已校验的站内 `returnTo`，不得信任请求中任意外部跳转 URL。登出时销毁服务端 Session 并清除 Cookie。

所有需要登录的业务 API 先解析本系统 Session，再从服务端用户记录获取角色；必须删除 `actorFromHeaders` 的演示降级路径。未登录返回 `401`，已登录但无权返回 `403`，不要把不同原因暴露给未认证方。

## 3. 企业微信内网页授权流程

网页授权仅用于用户已在企业微信客户端内打开页面的场景。服务器构造：

```text
https://open.weixin.qq.com/connect/oauth2/authorize
  ?appid=CORP_ID
  &redirect_uri=URL_ENCODED_CALLBACK_URL
  &response_type=code
  &scope=snsapi_base
  &agentid=AGENT_ID
  &state=STATE
  #wechat_redirect
```

规则如下：

- `response_type` 固定为 `code`；末尾 `#wechat_redirect` 必须保留。
- 默认使用 `snsapi_base`，可获得成员基础身份。`snsapi_privateinfo` 会请求成员授权并涉及详细信息，不是本系统默认登录所需权限。
- `agentid` 建议始终携带；`snsapi_privateinfo` 时必须携带。成员还必须在应用可见范围内。
- `state` 只使用字母数字且不超过 128 字节，并按第 2.2 节由服务器保存、绑定、一次性校验。
- `redirect_uri` 需 URL 编码，且必须属于应用可信域名；不可把前端开发地址或任意临时 IP 当作生产回调地址。
- 回调仍为 `code + state`，身份换取和本地会话签发与 PC 扫码相同。

## 4. 服务端令牌与成员身份换取

### 4.1 获取并缓存应用 access_token

在服务器侧使用本应用的 `CorpID` 与 `Secret` 请求：

```text
GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=CORP_ID&corpsecret=APP_SECRET
```

`access_token` 的有效时间由响应 `expires_in` 指定，正常为 7200 秒。官方要求缓存令牌，不能频繁调用 `gettoken`；同一企业不同应用的令牌相互独立。缓存键至少应包含 `CorpID + AgentId`，设置小于实际过期时间的提前刷新窗口，并在企业微信表示令牌失效后单飞刷新重试一次。绝不把 `access_token` 返回给客户端。

### 4.2 用回调 code 获取成员身份

```text
GET https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=ACCESS_TOKEN&code=CODE
```

成功的内部成员响应包含 `userid`；网页授权返回的 `snsapi_privateinfo` 场景还可能包含短期 `user_ticket`。本系统的认证主键应为稳定的 `(corp_id, userid)`，而不是姓名、手机号或邮箱。

若响应是 `openid`、`external_userid` 或不能确定为内部成员的身份，拒绝创建登录会话，并给出“该企业微信账号未获系统内部成员授权”的通用提示。不得因为收到一个企业微信外部身份就自动创建本地账号或赋予角色。

## 5. 用户管理与身份绑定

### 5.1 最小数据模型（实施项）

现有 Prisma schema 尚没有用户、企业微信身份或 Session 实体。M1 实施时至少需要新增以下服务端实体并建立唯一约束：

| 实体 | 必需字段 | 约束 |
| --- | --- | --- |
| `User` | `id`、`display_name`、`status`、`created_at`、`updated_at` | `status` 至少有 `active`、`disabled` |
| `UserRole` | `user_id`、`role` | 用户角色显式配置；不可由扫码响应决定 |
| `WeComIdentity` | `user_id`、`corp_id`、`userid`、`bound_at`、`last_login_at` | `(corp_id, userid)` 唯一；一条身份不能绑定多个本地用户 |
| `AuthSession` | `id_hash`、`user_id`、`expires_at`、`revoked_at`、`last_seen_at` | 原始 session ID 只存在浏览器 Cookie，数据库只存哈希 |
| `AuthAttempt` / `AuditLog` | `actor_id?`、`provider`、`outcome`、`reason_code`、`at` | 审计不记录 code、token、Secret 或完整回调 URL |

管理员应在用户管理中完成：创建/邀请本地用户、绑定或解除 `(CorpID, UserID)`、分配角色、查看上次登录、禁用用户和强制注销全部会话。首次扫码仅允许匹配既有且启用的绑定；是否允许管理员在受控页面中“首登认领”必须单独确认，默认不启用。

### 5.2 离职、调岗和失效处理

- 本地用户被禁用后，立即撤销其全部本系统 Session；之后任何企业微信扫码也不得创建 Session。
- 企业微信返回“成员不在应用可见范围”、找不到成员、`userid` 已无绑定或本地账户禁用时，一律拒绝登录，不返回内部用户存在性细节。
- 企业管理员应将离职人员移出应用可见范围或停用企业微信账号；本系统还应通过企业微信通讯录变更回调或管理员定期同步，将离职/移除人员禁用并撤销会话。回调接入需要单独配置 Token、EncodingAESKey 和签名/解密校验，不能把 HTTP 事件直接视作可信。
- 调岗只改变本地 `UserRole` 授权后生效；企业微信目录字段不自动覆盖系统角色。角色改变、绑定解除和禁用必须写入审计日志。

## 6. 配置与凭据管理

### 6.1 需要企业管理员提供

| 项目 | 用途 | 由谁提供或配置 |
| --- | --- | --- |
| `CorpID` | `CorpApp` 登录 URL 与 `gettoken` | 企业微信管理后台的企业信息 |
| `AgentId` | 指定自建应用及可见范围 | 目标自建应用管理员 |
| `Secret` | 后端换取应用 `access_token` | 目标自建应用管理员；仅交付给部署密钥系统 |
| 生产回调 URL | 扫码和网页授权完成后的本系统地址 | 系统部署管理员确定，企业微信管理员登记 |
| 可信域名 | 允许 `redirect_uri` 的域名 | 企业微信管理员在目标应用中配置；与回调域名一致 |
| 应用可见范围 | 能够扫码登录的企业成员范围 | 企业微信应用管理员 |
| 是否启用企业微信内网页授权 | 决定是否配置 OAuth2 入口 | 业务负责人 |
| 本地账号密码应急策略 | 决定是否保留第二种认证方式 | 业务安全负责人 |
| 离职同步方式 | 目录回调或定期同步所需的管理员授权与配置 | 企业微信管理员、业务安全负责人 |

本地环境的 `http://127.0.0.1`、`localhost` 不能替代已配置的生产可信回调域名。为多人开发可配置专用测试域名和测试应用，但不得复用生产 `Secret`。

### 6.2 环境变量建议

```dotenv
# 不提交到版本库，也不输出到日志
WECOM_LOGIN_ENABLED=true
WECOM_LOGIN_TYPE=CorpApp
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000002
WECOM_APP_SECRET=replace-with-deployment-secret
WECOM_REDIRECT_URI=https://kb.example.gov.cn/api/auth/wecom/callback
AUTH_SESSION_SECRET=replace-with-32-or-more-random-bytes
AUTH_SESSION_TTL_SECONDS=28800
```

生产环境应把 `WECOM_APP_SECRET` 和 `AUTH_SESSION_SECRET` 保存在部署平台的密钥管理服务中，按最小权限授予 API 服务读取权；`.env`、前端构建变量、浏览器网络响应、错误消息、日志、数据导出与审计日志中都不得出现 Secret、`access_token`、`code`、`user_ticket` 或原始 Session ID。变更或泄露后须立即轮换 Secret，并撤销所有本系统会话。

## 7. 错误处理与可观测性

| 场景 | 系统处理 | 面向用户的结果 |
| --- | --- | --- |
| 缺少或无效 `state`，过期、已使用或会话不匹配 | 拒绝、记录安全审计、清理临时状态 | “登录请求已失效，请重新扫码” |
| 缺少或过期 `code`，或回调重复 | 拒绝，不重试同一个 code | “授权已失效，请重新扫码” |
| `gettoken` 短暂失败或 token 失效 | 单飞刷新 token 后仅重试一次身份接口 | “企业微信服务暂不可用，请稍后重试” |
| 企业微信 API 返回非零 `errcode` | 记录 `errcode` / `errmsg` 和关联 ID，不记录敏感值；按官方错误码分类告警 | 使用通用错误文案 |
| 用户不在应用可见范围或不是内部成员 | 不创建本地用户或 Session | “当前账号未获系统访问授权” |
| 本地用户不存在、未绑定或已禁用 | 拒绝并审计 | “当前账号未获系统访问授权” |
| 可信域名配置错误（官方常见 `50001`） | 不在运行时绕过；由管理员修正应用可信域名 | “登录配置暂不可用，请联系管理员” |

应为认证流程记录不可逆关联 ID、认证提供方、结果、企业微信 `errcode`、本地用户 ID（若已识别）与时间。指标体系的创建、编辑、审核、发布等业务审计必须使用已认证的 `User.id` 和服务端角色，不再使用客户端传入的姓名与角色。

## 8. 验收清单

1. 未登录请求业务 API 返回 `401`；手工设置 `X-User-Role` 不能获得权限。
2. 后端生成的扫码 URL 具有 `CorpApp`、`CorpID`、`AgentId`、已编码回调地址和一次性 state；state 缺失、篡改、重放、过期均被拒绝。
3. 模拟企业微信成功回调时，后端用 `code` 换取 `userid`，只允许已绑定且 `active` 的用户建立本系统 Cookie Session。
4. `reader`、`researcher`、`reviewer`、`publisher`、`catalog_manager` 与 `system_admin` 的实际 API 授权与 `docs/domain-model.md` 相符；角色来自本地数据库而非浏览器。
5. 登出、禁用用户、解除绑定与角色降级都立即使既有 Session 失效。
6. `access_token` 缓存按应用隔离，失效后刷新；测试和日志断言不包含 Secret、token、code、ticket 或 Session ID。
7. PC 扫码、企业微信内网页授权（若启用）和可信域名错误各有端到端测试；服务商模式未配置时明确禁用。

## 9. 官方文档

- [企业微信 Web 登录：开始开发](https://developer.work.weixin.qq.com/document/path/98151)
- [企业微信 Web 登录：Web 登录组件与跳转 URL](https://developer.work.weixin.qq.com/document/path/98152)
- [企业微信 Web 登录：获取用户登录身份](https://developer.work.weixin.qq.com/document/path/98176)
- [企业微信 JS-SDK：Web 登录组件 API](https://developer.work.weixin.qq.com/document/path/98268)
- [网页授权登录：开始开发](https://developer.work.weixin.qq.com/document/path/91335)
- [网页授权登录：构造网页授权链接](https://developer.work.weixin.qq.com/document/path/91120)
- [网页授权登录：获取访问用户身份](https://developer.work.weixin.qq.com/document/path/91023)
- [企业 `access_token` 获取与缓存说明](https://developer.work.weixin.qq.com/document/path/91039)
- [企业微信服务端 API 错误码查询](https://developer.work.weixin.qq.com/devtool/query)

