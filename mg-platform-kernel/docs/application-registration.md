# 应用注册唯一来源

Java 运行服务只从 `SERVICE_DATABASE_URL` 指向的 `desktop_applications` 读取平台应用。展示名称、说明、入口、上游、路径白名单、窗口尺寸、类型、图标资源键及授权 audience 均以数据库为准。未配置数据库、未建表、读取失权或连接中断时明确失败，不使用内置目录或展示 JSON 恢复入口。

`DESKTOP_CONFIG_FILE` 在内核中只提供桌面名称；公共前端的 JSON 与图片仍用于图标资源和各独立应用自身品牌配置，不再参与运行目录注册。`*_WEB_URL`、`FILES_API_URL` 等旧的应用入口环境变量不再覆盖数据库。`DESKTOP_ORIGIN`、`IDENTITY_ISSUER` 和身份客户端配置仍然有效。

## 显式迁移

数据库管理账号执行以下命令。数据库连接仅经私密环境配置传入，运行账号读取目录，并仅按授权更新展示元数据、启停状态和审计记录；入口、上游、路径、授权和运行策略不开放给应用管理页面。

```powershell
# 已有注册数据时仅升级结构，保留配置、启停、排序和审计。
java -jar app.jar desktop-applications schema
# 新增登记或首次迁移必须显式提供完整清单。
java -jar app.jar desktop-applications migrate C:\private\application-registration.json
```

清单格式为 `schemaVersion: 1` 和 `applications` 数组，每项示例：

```json
{
  "schemaVersion": 1,
  "applications": [{
    "id": "example-app",
    "name": "示例应用",
    "description": "示例业务入口",
    "entryUrl": "https://example.org/app",
    "upstream": "https://example.org/api",
    "defaultPath": "/overview",
    "allowedPaths": ["/overview"],
    "allowedApiPaths": ["/overview"],
    "icon": "resource-manager",
    "kind": "internal",
    "authorizationAppId": "example-audience",
    "requiredRole": null,
    "minWidth": 820,
    "minHeight": 560,
    "defaultMaximized": false
  }]
}
```

导入前校验所有项目、字段类型、重复标识和 URL/路径边界。`allowedApiPaths: null` 表示不限 API 前缀，`[]` 表示不开放代理；应按应用实际能力配置。`kind: default` 会向已登录用户展示入口，只应由管理员明确设置，业务 API 仍校验身份服务授权。

导入在事务与数据库锁中写入注册项及创建审计。同 ID 同配置幂等跳过，不同配置拒绝整批导入；不会恢复已停用项或重排已有项。新增项默认启用，按输入顺序赋予排序值。导入工具不是配置覆盖工具，现有配置修改仍由受控数据库管理流程负责。

## 运行语义

每次读取从数据库获取当前值。新增、改名、调整上游、授权 audience 或排序无需重新打包或重启 Java；桌面下次加载会话时获取新目录。停用应用后代理入口和允许来源立即失效，停用项仍保留服务历史校验与平台主机外链保护。全部停用时返回空平台目录；真正的空表拒绝启动，要求先执行迁移。

图标值可以引用公共前端已打包的资源键。未知键显示占位图；旧 `knowledge/token/identity/personal` 标记保持按应用 ID 显示既有图标的兼容行为。新增图片资源仍需要前端构建。

身份授权、个人外链和服务版本/契约分别保留原有存储边界。旧 Node 目录已移入 `mg-desktop-one/tests/fixtures/legacy-config.ts`，只允许 `NODE_ENV=test` 加载。桌面常规 `npm run build` 仅构建桌面前端；旧后端须执行 `npm run build:compatibility`，发布包不再收集旧 Node 管理工具。历史测试、迁移输入和审计证据保留。

## 注册策略迁移

升级到本次内核之前，先使用新 JAR 执行 `desktop-applications schema`。它包含 `V5__desktop_application_policy.sql` 和 `V7__desktop_application_metadata.sql`，为旧记录一次性转换 `runtime_policy` 并补充 `developer` 字段，保留名称、启停、排序及已有策略。使用旧数据库结构直接启动新内核会失败，不会回退旧规则。此次未替换已有运行实例。

新登记可提供可选字段 `runtimePolicy`：

```json
{
  "apiMode": "registered",
  "versionOwnerAppId": "example-app",
  "rolePath": "/auth/me",
  "rolePointer": "/user/role",
  "allowedApiMethods": ["GET", "POST", "PUT", "PATCH", "DELETE"]
}
```

- `apiMode`：新增记录省略时为 `registered`，未登记或未启用 API 返回 404。旧记录经结构迁移保留 `compatibility`，仅尚未被任何服务版本登记的路径可以兼容转发；这不是治理验收完成状态。
- `versionOwnerAppId`：省略时为自身 ID。共享前端产物由管理员声明版本归属，不再对 Token 三个入口做运行时特判。
- `rolePath`、`rolePointer`：当设置 `requiredRole` 时，用受控上游的相对路径读取角色，以 JSON Pointer 定位。默认 `/auth/me` 与 `/role`；旧 identity、Token 控制台行为只在迁移中转换。
- `allowedApiMethods`：默认 GET、HEAD、POST、PUT、PATCH、DELETE、OPTIONS；空数组关闭应用代理方法。旧文档入口的只读限制已转入此字段，网关不再检查其应用 ID。浏览器 OPTIONS 预检仍由平台 CORS 层处理。

`runtimePolicy` 不出现在桌面公开应用列表。现有记录修改仍走受控数据库变更，须保留修订和审计；`migrate` 继续拒绝覆盖同 ID 不同配置。

## 服务路由唯一来源

公共客户端只生成 `/api/apps/{appId}/...`，不再导入编译时服务目录来决定是否走服务中心。旧 `/api/services/apps/...` 和命名调用接口保留。Java 根据当前服务注册库解析三种入口，已登记请求共用授权、CSRF、版本、生命周期、部署绑定和调用观测。

路径只要曾被服务版本登记，停用、草稿、方法不匹配或操作移除都不能使它退回直连。应用入口会规范化尾斜杠并拒绝编码路径、重复斜杠，防止换一种路径写法绕行。真正未登记的兼容请求返回 `X-Api-Governance: unregistered-compatibility`。

已解析请求进入 `service_activity`，含真实 `serviceId/version/operationId`。未解析和兼容请求进入 `service_audit`，`action=api-route`，保存应用、方法、不含查询串的路径、调用人、网关请求标识、转发状态及结果，不伪造服务 ID，不保存 Cookie、令牌或正文。网关生成的 `X-Request-Id` 会下传给上游，客户端传入值不会覆盖它。

服务中心“统计分析 / API 治理”向管理员展示最近治理事件；与原管理变更共用最近 500 条显示窗口。数据库保留持久化事件，异步队列满或数据库写入失败仍可能丢记录，`droppedSinceStart` 暴露缺口，本轮没有把它宣称为可靠计费或完整安全审计。

OpenAPI `servers` 根路径从契约自身读取，只允许安全的相对路径，子级不能切换服务器。此字段只描述提供方 API，实际出口仍由注册的上游和受控部署绑定决定；不再硬编码 Office 的 `/api/office`。

## 验证

2026-09-09 本轮：Java 26 项测试（真实 PostgreSQL、无跳过）、桌面原 69 项和新增 2 项运行边界测试、公共前端 16 项通过。桌面、服务管理构建及身份前端类型检查通过。完整隔离 JAR 证据为 `mg-desktop-one/.runtime/application-registration-MywLej/result.json`；补充角色路径、JSON Pointer 与共享版本归属的 HTTP 验证为 `application-registration-JFVkd3/result.json`，复用上述已测试 JAR。`MywLej/gateway-evidence.json` 保存真实隔离库事件，`MywLej/governance-ui` 保存 1440px、390px 截图及视图验证结果。前端验证使用隔离网关事件的接口替身，未作为生产联调证据。

桌面项目执行 `npm run test:applications`，自动创建仅监听 loopback 的临时 PostgreSQL 实例，并在独立构建目录完成 Java 测试、JAR 迁移与真实 HTTP 验证。需要 Windows PostgreSQL 16 工具（可用 `TEST_POSTGRES_BIN` 指定路径）和内核便携 Java/Maven。测试结束关闭自己启动的进程，证据保留在 `.runtime/application-registration-*/result.json`。

测试身份和业务接口为本地替身，不能当作真实身份中心联调或生产发布证据。

`node scripts/verify-java-platform.mjs` 仍保留原 Node/Java 对照断言；单独执行时转入上述隔离实例流程。Java 先显式导入测试应用和 Node 服务快照，再执行原会话、用户文件、下载、SSE 和 Cookie 兼容验证。测试专用目录只放在 `src/test/resources`，不进入 JAR。

2026-09-09 本地验证：Java 19 项测试全部通过（含 PostgreSQL，无跳过）；桌面 69 项测试在 `--maxWorkers=2` 下全部通过，公共前端 16 项测试通过，类型检查和生产构建通过。注册及 HTTP 证据：`mg-desktop-one/.runtime/application-registration-ZN33lX/result.json`；增加完整旧对照后的证据：`application-registration-HZxNf2/result.json` 与 `java-platform-verify-uza964/result.json`。图标在 1024px/390px 视口完成实际图片加载与截图验证，见 `.runtime/registered-icons-nUp9OV`。本轮未切换本地现有服务或生产服务。
