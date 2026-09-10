# 现有系统应用审计

按「谁执行谁拥有数据，内核只做对应用的出口」审计当前登记的 12 个平台应用。依据为 `.runtime/local/application-migration.json` 的注册清单、各应用前端实际调用的接口，以及 `mg-platform-kernel` 源码。

## 符合准则的部分

| 应用 | 执行方 | 数据归属 | 说明 |
| --- | --- | --- | --- |
| identity、personal-center | 身份中心 | 身份库 | 认证、账号安全由身份中心执行并拥有；`upstream` 指向它，personal-center 还按能力收窄了路径 |
| files、office-one | 文件服务 | 文件服务 | office-one 走 `/api/office` 子路径，共用文件服务后端 |
| expert-database、token-one、resource-manager、low-alt-cockpit | 各自后端 | 各自库 | 独立业务后端，内核只转发 |
| service-manager、app-manager | 内核 | 内核 | 纯前端；服务注册与个人外链由内核执行，也由内核拥有 |

最后一行正是安全中心要走的模式：应用只有前端，后端在内核。已有两个先例，不是新发明。

## 发现的问题

### 一、应用注册配置存在三份副本

内核文档写明 `desktop_applications` 是运行目录的唯一来源，不再回退内置目录。但仓库里同一份配置目前有三处：

- `desktop_applications` 表（声称的唯一来源）
- `mg-desktop-one/apps/server/src/config.ts` 的 Node `registry` 常量
- `mg-desktop-one/.runtime/local/application-migration.json`

低空驾驶舱被写进了 `config.ts`。按内核的迁移进度文档，Java 内核已经替代生产 Node 桌面后端，那份 Node registry 现在是对照实现而非运行来源。

**已核实（2026-09-10，直接查线上 `mg_services` 库）：`low-alt-cockpit` 在 `desktop_applications` 表中存在且已启用，桌面上有这个应用，没有造成缺失。** 但三份副本不同步的问题依然成立：线上表有 14 个应用，本地 `application-migration.json` 只有 12 个，线上多出 `desktop-one` 与 `document-one`。以哪份为准在仓库里看不出来，这才是风险本身。

### 二、`upstream` 无法反映应用的真实后端

service-manager 的 `upstream` 是身份中心且只放行 `/auth/me`，但它前端实际只调 `/api/service-registry/**`，由内核 `ServiceRegistryController` 提供。app-manager 同理，实际调 `/api/applications`，由内核 `PlatformController` 提供。

也就是说这两个应用的 `upstream` 字段是形式上的，真实后端在内核，注册表里没有任何字段能表达这件事。安全中心将成为第三例。建议二选一：把这类应用的 `upstream` 显式指向内核自身，或者在注册文档里把这个模式写成明确约定。否则以后无法从注册表判断一个应用的后端在哪。

### 三、五个应用的 API 代理不限路径

`allowedApiPaths` 为 `null` 表示不限前缀，内核文档明确要求「应按应用实际能力配置」。

**线上实测（2026-09-10）为五个，不是四个**：files、expert-database、token-one、token-one-console，**以及 identity**。本审计最初依据本地 `application-migration.json`，漏掉了 identity——它是身份中心自己的管理界面，不限前缀意味着经代理可以调用身份中心的全部接口，是这五个里最该收窄的一个。

同期新登记的 `document-one` 已收窄到 `/api/v1`，说明新应用在按规范做，问题集中在存量应用。

其中两处值得单独说：

- **token-one 与 token-one-console 共用同一个 `upstream`（`14310/api`）且都不限路径**。两者的访问授权是分开的（文档强调控制台访问由其独立应用授权决定，不再由门户 admin 角色推断），但代理层不区分能调哪些接口，任一应用获得授权后都能调对方全部接口。这削弱了拆成两个应用的意义。同组的 token-one-docs 反而收窄到了两个前缀，说明收窄是可行的，只是没做。
- **files 不限路径而 office-one 收窄到 `/api/office`**，两者共用文件服务，files 可以经代理调用 office 的接口。

### 四、low-alt-cockpit 的形态与登记类型不一致

登记为 `internal`，但 `entryUrl` 是公网域名 `https://lowalt.meta-gravity.com`，且 `allowedApiPaths` 为 `[]`（不开放代理），平台对其业务流量没有任何管辖。形态上更接近 external。此外它在 Node 侧 `main.ts:108` 有一段专门的 audience 兜底分支，是目录接口异常时的特例处理。

### 五、操作日志只覆盖了一半流量

内核已经有完整的调用记录设施：`ServiceRegistry.record(serviceId, operationId, actor, status, durationMs)` 写入 `service_activity`，`ServiceMetrics.Query` 支持时间范围（最长 31 天）、服务、操作、结果与分页，并通过 `/api/service-registry/insights` 对外提供。

但记录只发生在 `/api/services/**` 这条注册服务调用路由上。`/api/apps/**`——也就是所有应用的日常 API——完全不记录。安全中心的操作日志应当扩展这套现成设施，而不是另起炉灶。

### 六、缺少把内核事实与应用业务语义关联的键

按准则，各业务应用各自保存业务语义审计（身份中心与知识库都有 `AuditLog`，字段形状相近）是对的：谁执行谁拥有。但内核只在响应头写 `X-Request-Id`，且出站请求头白名单里没有它，上游应用拿不到，两边无法关联。

要让操作日志既有「谁在什么时候从哪个 IP 调了哪个接口」（内核事实），又有「编辑了哪个服务」（应用语义），必须把请求标识下传给上游。这与真实客户端 IP 的下传是同一处改动。

## 处理进展

### 已处理

- **第一条的仓库侧**：`mg-desktop-one/apps/server/src/config.ts` 的 `registry` 上方加了说明，写明它不是运行目录来源、仅用于本地联调与跨语言对照，线上变更必须走内核的 migrate 或受控数据库流程。没有删除该常量——按迁移进度文档它仍是保留的 Node 对照实现。类型检查通过。
- **已核实**：线上 `desktop_applications` 位于 `43.139.78.226` 的 `mg-service-registry-db-1` 容器、`mg_services` 库。表中 14 条记录，`low-alt-cockpit` 在列且已启用。同时确认不限前缀的应用为五个（含 identity），已据实修正上文第三条。

### 已查清、待受控变更

第三条要收窄的 `allowedApiPaths`，从各应用前端代码里查到的实际接口前缀如下。这些都是 `desktop_applications` 的配置修改，`migrate` 对同 ID 不同配置是拒绝而非覆盖，必须走受控数据库变更，本地无法应用。

| 应用 | 建议的 `allowedApiPaths` | 依据 |
| --- | --- | --- |
| expert-database | `/systems`、`/indicator-versions`、`/users`、`/auth`、`/account-security`、`/mail-settings`、`/semantic-libraries`、`/model-management` | `apps/web/src/api/client.ts` 中出现的全部前缀 |
| files | `/entries` | `src/api.ts` 中唯一的前缀；`/my-files`、`/recent` 等是界面路由不是接口 |
| identity | 需按身份中心管理界面实际调用的前缀收窄 | 线上实测为 null，本轮新发现 |
| token-one、token-one-console | 需应用团队确认 | 见下 |

files 的建议值需要应用团队复核上传下载是否走同一前缀。收窄 files 还有一个附带收益：它与 office-one 共用文件服务，目前不限前缀意味着 files 可以经代理调用 office-one 的 `/office` 接口。

### 需要决策，无法单方面处理

- **token-one 与 token-one-console 是同一个前端包**（`mg-gateway/apps/web`），只靠 `allowedPaths` 区分视图（`/dashboard,/my-usage,/playground` 对 `/admin`），运行时用 `tokenApplicationForPath(location.pathname)` 决定自己以哪个应用身份发请求。两者共用同一 `upstream` 且都不限前缀，因此 API 层要拆开必须先确定两个视图各自调用的端点，而这在同一 bundle 里并不天然可分。这条不是简单收窄能解决的，需要应用团队决定拆包还是接受现状。
- 第二条（`upstream` 无法表达真实后端）与第四条（low-alt-cockpit 的登记类型）都需要先定约定或策略，再走受控变更。

### 被并发编辑阻塞

第五条与第六条都要改 `mg-platform-kernel` 的 `ApplicationGateway.java`，**本次未动**。审计期间该文件正被他人编辑：先读到的是 140 行、构造函数三参，再读已是 173 行、四参并新增 `ServiceTelemetry`；同目录 `ServiceRegistryController`、`ServiceMetrics`、`ServiceWorkspace` 的修改时间集中在同一时段。该项目不是 git 仓库，并发写入会造成不可恢复的覆盖。

对方的改动反而让第五条更好办：`service()` 路由现在记录的事件已经包含 `serviceId`、`operationId`、`method`、`path`、`actor`、`requestId`、`status`、`outcome`、`durationMs`，经 `telemetry.record()` 落库。操作日志因此是把这套现成事件扩展到 `/api/apps/**`，而不是新建一套采集。

内核的两处改动应在确认无人编辑后进行：出站请求头白名单加入网关判定的真实客户端地址与请求标识（并且只在来自受信代理时才采信 `X-Forwarded-For`），以及把调用记录扩展到应用路由。

## 建议的处理顺序

1. 核实线上 `desktop_applications` 是否包含 `low-alt-cockpit`（可能已影响线上）。
2. 内核出站请求头白名单加入请求标识与真实客户端 IP，并剥离客户端自带的转发头。
3. 收窄 token-one、token-one-console、files、expert-database 的 `allowedApiPaths`。属于受控数据库变更，需要逐个确认应用实际使用的前缀。
4. 决定 `upstream` 指向内核的应用如何在注册表中表达，安全中心按该约定登记。
5. 清理 `config.ts` 中已失效的 Node registry，或在其中标注不再是运行来源。
