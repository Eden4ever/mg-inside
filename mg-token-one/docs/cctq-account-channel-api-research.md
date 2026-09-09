# CCTQ 账户余额与客户渠道信息接口研究

> 研究日期：2026-08-19（Asia/Shanghai）  
> 研究对象：用户所说的“ootq”按上下文解释为 CCTQ（`www.cctq.ai`）。没有使用任何生产密钥、账户 Cookie 或登录凭据。

## 结论摘要

CCTQ 当前公开站点确实暴露了两类可供 Token One 对接的接口，但它们的权限边界不同：

1. **API 令牌级余额/额度**：New API 的 `GET /api/usage/token/`，使用 CCTQ API Key 作为 `Authorization: Bearer <token>` 鉴权，返回该令牌的总额度、已用额度、可用额度、是否无限额、模型限制和过期时间。这是最适合 Token One 首期同步“上游客户渠道余额”的接口。
2. **登录账户级余额、用量和客户信息**：`GET /api/user/self`、`GET /api/log/self/stat`、`GET /api/log/self`、`GET /api/data/self`、`GET /api/user/self/groups`、`GET /api/user/models`、`GET /api/subscription/self` 等，需要 CCTQ **Dashboard Access Token**（不是 API Key）。这些接口能看到账户余额、累计用量、请求次数、分组、模型、日志和订阅，但不应让 Token One 直接保存个人登录密码或浏览器 Cookie。
3. **管理端渠道信息**：`/api/channel/*`、`/api/user/*` 管理接口属于 CCTQ 管理员权限；公开前端能证明这些路由存在，但没有证据表明普通客户令牌可以访问。Token One 不应尝试调用或模拟管理端接口。
4. **公开模型/计价/路由信息**：`GET /api/status` 和 `GET /api/pricing` 无需登录即可访问，适合做公开模型与分组目录快照，但不包含某个客户账户的余额。

因此，建议先做“**按渠道配置 API Key，定时读取 `/api/usage/token/`**”的只读适配；若确需账户级明细，再由客户在 CCTQ 侧创建专用、最小权限的 Dashboard Access Token，并单独实现账户适配。当前没有确认 CCTQ 提供面向第三方的正式 OAuth、Webhook 或专用余额 API；这些应向 CCTQ 运营方书面确认。

## 已确认的官方站点接口

### 1. `/api/status`：公开系统配置与 API 地址

- 请求：`GET https://www.cctq.ai/api/status`
- 2026-08-19 实测：HTTP 200，JSON `success: true`。
- 公开返回字段（本次响应中确认）：`version`、`system_name`、`server_address`、`api_info`、`quota_display_type`、`quota_per_unit`、`usd_exchange_rate`、公告、地区和站点模块开关等。
- `api_info` 返回了主线路 `https://www.cctq.ai` 和优选 API `https://cf-fast.cctq.ai`，并说明 Codex 场景需要追加 `/v1`。
- **不返回账户余额、账户 ID、API Key、个人用量或客户渠道明细。**
- 证据：官方接口 [https://www.cctq.ai/api/status](https://www.cctq.ai/api/status)；响应头包含 `x-new-api-version: v1.0.0-rc.24-311-g1bb1ade47`。

### 2. `/api/pricing`：公开模型、分组和价格目录

- 请求：`GET https://www.cctq.ai/api/pricing`
- 2026-08-19 实测：HTTP 200，JSON `success: true`。
- 本次响应确认的字段：
  - `data[]`：`model_name`、`model_ratio`、`completion_ratio`、`cache_ratio`、`create_cache_ratio`、`enable_groups`、`supported_endpoint_types`、可选 `billing_mode`/`billing_expr`；
  - `group_ratio`：分组倍率；
  - `usable_group`：分组描述；
  - `supported_endpoint`：公开协议路径；
  - `pricing_version`：价格目录版本。
- 该接口可用于同步 CCTQ 的模型和分组目录、价格展示和协议能力提示，但 `model_ratio` 是 CCTQ 内部计费倍率，不等于账户余额。
- 本次公开目录显示 `supported_endpoint` 包含 `anthropic: /v1/messages` 和 `openai: /v1/chat/completions`。不能据此推断所有模型都支持原生 Responses，也不能据此推断某个客户渠道可用。
- 证据：官方接口 [https://www.cctq.ai/api/pricing](https://www.cctq.ai/api/pricing)。

### 3. `/api/usage/token/`：API Key 级额度（首期推荐）

- 请求：`GET https://www.cctq.ai/api/usage/token/`
- 鉴权：`Authorization: Bearer <CCTQ API Key>`。New API 路由将该接口挂在 `TokenAuthReadOnly` 中间件下；无效令牌实测返回 HTTP 401、`{"message":"Invalid token","success":false}`。
- 上游 New API 控制器公开的成功响应结构：

```json
{
  "code": true,
  "message": "ok",
  "data": {
    "object": "token_usage",
    "name": "...",
    "total_granted": 0,
    "total_used": 0,
    "total_available": 0,
    "unlimited_quota": false,
    "model_limits": {},
    "model_limits_enabled": false,
    "expires_at": 0
  }
}
```

- 字段含义：
  - `total_granted`：总授予额度（上游 quota 单位）；
  - `total_used`：已使用额度；
  - `total_available`：剩余额度；
  - `unlimited_quota`：是否无限额；
  - `model_limits` / `model_limits_enabled`：令牌级模型限制；
  - `expires_at`：令牌过期时间（Unix 秒，控制器原样返回）。
- 注意：CCTQ 页面公开配置中 `quota_per_unit` 当前为 500000，且站点显示模式为 CNY；Token One 必须保存原始 quota 整数，并按 `/api/status` 的货币配置做展示换算，不能把 quota 直接当人民币。
- 证据：CCTQ 官方前端构建产物 `https://www.cctq.ai/static/js/index.784a9f4151.js` 明确调用 `/api/usage/token/`；接口无效令牌响应已在官方站点实测。响应字段结构来自 New API 官方仓库控制器（见“来源与版本”）。成功响应仍需使用授权的测试 API Key 做一次脱敏验收。

### 4. 登录账户级接口（需要 Dashboard Access Token）

以下接口均在 CCTQ 官方站点实测为无效令牌 HTTP 401，说明它们不是匿名接口。`Authorization` 使用 Dashboard Access Token；不能用管理密码、生产 JWT 或 Token One 的 `sk-` 令牌替代。

| 接口 | 账户侧用途 | 已确认字段/限制 |
|---|---|---|
| `GET /api/user/self` | 当前账户资料与账户余额 | New API 官方 DTO 返回 `id`、`username`、`display_name`、`role`、`status`、`group`、`quota`、`used_quota`、`request_count`、邀请额度字段、`permissions` 等 |
| `GET /api/log/self/stat` | 指定时间范围的账户统计 | 查询参数 `type`、`start_timestamp`、`end_timestamp`、`token_name`、`model_name`、`channel`、`group`；返回 `data.quota`、`data.rpm`、`data.tpm` |
| `GET /api/log/self` | 当前账户消费/错误日志 | 支持分页、时间、模型、令牌等筛选；返回结构需用授权账户确认，不能只按前端猜测 |
| `GET /api/data/self` | 按时间聚合的账户额度数据 | `start_timestamp`/`end_timestamp`；时间跨度超过一个月会被拒绝；返回 `data[]` 聚合记录 |
| `GET /api/data/flow/self` | 按分组/模型/令牌聚合的账户用量 | 需要完整时间范围；同样受登录权限和时间范围约束 |
| `GET /api/user/self/groups` | 当前账户可用分组及倍率/描述 | 返回 `data.{group}.ratio`、`data.{group}.desc` |
| `GET /api/user/models` | 当前账户可见模型 | 可选 `group` 参数；返回 `data[]` 模型名 |
| `GET /api/subscription/self` | 当前账户订阅 | 返回 `billing_preference`、`subscriptions`、`all_subscriptions`；订阅对象包含计划、总额度/已用额度、有效期、状态等 |

账户级接口证据：

- 官方站点匿名/无效令牌实测：`/api/user/self`、`/api/user/models`、`/api/user/self/groups`、`/api/log/self`、`/api/log/self/stat`、`/api/data/self`、`/api/subscription/self` 均返回 `AUTH_UNAUTHORIZED`/HTTP 401。
- CCTQ 官方前端构建产物 `https://www.cctq.ai/static/js/index.784a9f4151.js` 包含这些路由字符串和调用模块。
- New API 官方仓库路由与控制器（固定提交 `f116414284162ad15d8925f7bca494c109b83e93`）：
  - [api-router.go](https://github.com/QuantumNous/new-api/blob/f116414284162ad15d8925f7bca494c109b83e93/router/api-router.go)：路由与鉴权中间件；
  - [user.go](https://github.com/QuantumNous/new-api/blob/f116414284162ad15d8925f7bca494c109b83e93/controller/user.go)：`GetSelf` DTO；
  - [token.go](https://github.com/QuantumNous/new-api/blob/f116414284162ad15d8925f7bca494c109b83e93/controller/token.go)：`GetTokenUsage` 响应字段；
  - [log.go](https://github.com/QuantumNous/new-api/blob/f116414284162ad15d8925f7bca494c109b83e93/controller/log.go)、[usedata.go](https://github.com/QuantumNous/new-api/blob/f116414284162ad15d8925f7bca494c109b83e93/controller/usedata.go)、[subscription.go](https://github.com/QuantumNous/new-api/blob/f116414284162ad15d8925f7bca494c109b83e93/controller/subscription.go)：用量、数据和订阅接口。

### 5. `/v1/models`：API 令牌可见的模型列表

- 请求：`GET https://www.cctq.ai/v1/models`
- 2026-08-19 无 Authorization 实测：HTTP 401，`Invalid token`。
- 它适合在渠道测试时验证“该 API Key 当前能看到哪些模型”，但不是余额接口，且模型对象是否包含价格/协议能力不能假定，必须以实际响应为准。

### 6. 管理端渠道接口：存在，但不建议作为客户对接面

官方前端构建产物暴露以下管理操作路由：`/api/channel`、`/api/channel/update_balance/:id`、`/api/channel/fetch_models/:id`、`/api/channel/:id/codex/usage`、`/api/channel/status/batch` 等。这些是 New API 管理员的渠道维护能力，涉及渠道密钥、健康状态、余额刷新和 Codex 用量刷新。

当前没有证据表明普通 CCTQ 客户 API Key 可以访问这些接口；不能把它们当成 Token One 获取“客户渠道信息”的公共 API。对接管理渠道需要 CCTQ 运营方提供明确的服务账号、最小权限和接口契约。

## 对 Token One 的建议

### 阶段一：只读的 API Key 余额同步（推荐先做）

在 Token One 的 `Channel` 配置中增加一个“上游账户信息同步”配置，不改变现有转发协议：

```text
accountSync.provider = cctq_new_api
accountSync.baseUrl = https://www.cctq.ai
accountSync.authMode = api_key_bearer
accountSync.usagePath = /api/usage/token/
accountSync.modelsPath = /v1/models
accountSync.interval = 10m（可配置，带随机抖动）
```

建议数据模型（独立于渠道转发密钥，密钥仍使用现有加密存储）：

- `provider_account_ref`：业务侧名称/别名，不存明文账号密码；
- `credential_type`：`api_key`；
- `last_sync_at`、`next_sync_at`、`last_status`、`last_error_code`；
- `quota_total_raw`、`quota_used_raw`、`quota_available_raw`、`quota_unlimited`、`expires_at`；
- `model_limits`、`visible_models`（脱敏后）；
- `source_request_id`（只存 CCTQ 返回的请求 ID，不存 Authorization）。

同步规则：

1. 只调用 GET，超时 5-10 秒，指数退避；
2. 429/5xx/网络错误不覆盖上一次成功余额，标记 `stale`；
3. 401 立即标记 `credential_invalid`，不要反复重试；
4. `unlimited_quota=true` 时不把余额显示为 0；
5. 保留原始 quota 单位，展示层再按 CCTQ 的 `quota_per_unit`/货币配置换算；
6. 余额低于阈值只做告警，不自动停渠道，除非用户明确配置自动熔断；
7. `/v1/models` 与 `/api/usage/token/` 分开记录，避免把模型列表失败误判成余额不足。

### 阶段二：客户账户级用量与订阅（需要供应商确认）

只有在 CCTQ 允许并提供专用 Dashboard Access Token 后再做：

- 令牌必须是服务账号/专用账号，不使用个人登录 Cookie；
- 最小权限只读；
- Token One 只请求 `/api/user/self`、`/api/log/self/stat`、`/api/user/self/groups`、`/api/user/models`、`/api/subscription/self`；
- 账户明细按租户隔离，禁止将用户名、邮箱、日志 prompt/body 同步入 Token One；
- 先做字段白名单和合规评估，再决定是否暴露给 Token One 管理员。

### 阶段三：管理员渠道/余额刷新（暂不规划实现）

除非 CCTQ 运营方提供正式的管理 API、服务账号、权限范围、速率限制和变更通知机制，否则不对接 `/api/channel/*`。不应通过抓取管理页面、复用浏览器 Cookie、绕过角色校验或模拟内部接口实现。

## 尚未确认的事项

- `/api/usage/token/` 成功响应在 CCTQ 自定义版本中是否完全与 New API 上游结构一致；需要使用一个专门的低额度测试 Key 做脱敏验收。
- CCTQ 是否允许第三方服务端定时读取余额；是否有条款、IP 白名单、速率限制或 API Key scope 限制。
- 是否提供正式 OAuth2 Client Credentials、只读服务账号、Webhook 或专用账户余额 API。
- Dashboard Access Token 的申请方式、有效期、刷新方式、撤销方式和最小权限。
- `/v1/models` 成功响应是否带 CCTQ 价格、分组、协议能力字段；不能从 `/api/pricing` 直接推断。
- 余额字段的单位和舍入规则，尤其是 `quota_per_unit=500000` 与 CNY 展示的换算关系。
- API Key 余额与账户余额/订阅额度之间的扣减关系；不能默认二者相加或互相替代。
- CCTQ 的自定义渠道管理 API 是否向合作方开放，以及 `/api/channel/update_balance/:id` 是否只刷新上游供应商账户余额而非客户 API Key 余额。

## 建议向 CCTQ 运营方确认的问题

1. 是否书面允许 Token One 服务器定时调用 `GET /api/usage/token/`？允许的频率是多少？
2. 成功响应字段、quota 单位、过期时间单位和错误码是否有稳定版本承诺？
3. 是否可创建只读服务账号，用于 `/api/user/self` 等账户级接口？
4. 是否有官方 OAuth/Client Credentials、Webhook 或余额变更通知？
5. API Key 是否可限制到模型/分组/来源 IP，是否支持单独轮换？
6. 余额查询是否会触发风控，是否需要固定 User-Agent 或额外请求头？
7. 是否允许获取渠道健康状态、上游渠道余额和模型同步结果？若允许，请提供正式 endpoint、scope 和响应 schema。

## 来源与证据

- CCTQ 主页：<https://www.cctq.ai>
- CCTQ 公开状态接口：<https://www.cctq.ai/api/status>
- CCTQ 公开计价接口：<https://www.cctq.ai/api/pricing>
- CCTQ 官方文档：<https://doc.cctq.ai/guide/create-token.html>（说明 API Key、API 地址和 Codex `/v1` 规则）
- CCTQ 官方文档：<https://doc.cctq.ai/guide/recharge.html>（说明账户充值/额度的用户流程；不提供第三方余额 API 契约）
- CCTQ 官方前端构建产物（公开路由字符串）：<https://www.cctq.ai/static/js/index.784a9f4151.js>
- New API 官方仓库：<https://github.com/QuantumNous/new-api>，研究固定提交 `f116414284162ad15d8925f7bca494c109b83e93`。该仓库只用于核对公开路由和 DTO 结构，不能替代对 CCTQ 自定义版本的实测。

## 最终建议

先实现阶段一的 `cctq_new_api` 只读同步适配，并让用户在 Token One 中为每个 CCTQ 渠道显式配置“余额同步已授权”。不要在首期采集账户日志、邮箱、订阅或管理渠道数据。完成一个授权测试 Key 的脱敏验收后，再决定是否需要阶段二；没有 CCTQ 书面授权和稳定契约，就不做管理员渠道 API 对接。
