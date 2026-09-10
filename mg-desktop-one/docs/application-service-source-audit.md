# 应用与服务唯一来源审计

日期：2026-09-09。覆盖 12 个现有应用入口、桌面内核、共享客户端、发布脚本，以及安全中心规划目录。依据为当前源码、提供方登记包、隔离 PostgreSQL/JAR HTTP 和前端验证；未修改生产注册库或替换已有本地服务。源码目录有应用图标不等于运行数据库已登记。

## 本轮已完成

| 项目 | 结果与证据 |
| --- | --- |
| 旧 Node 应用目录 | 从 `apps/server/src/config.ts` 移到 `tests/fixtures/legacy-config.ts`；非测试环境拒绝加载。常规构建不再生成旧后端，发布不再复制遗留 Node 服务管理工具 |
| 前端服务目录分流 | 公共客户端移除 `catalog.json` 依赖，入口统一由 Java 的当前服务注册库决定 |
| 已登记接口通过旧地址绕行 | `/api/apps` 与服务地址共用解析及转发链路。历史已登记路径即使停用、草稿或方法不匹配，也不回退直连；包括尾斜杠和编码路径验证 |
| 无登记接口治理 | 新应用默认严格登记模式。旧应用一次性迁移为显式兼容模式，兼容转发和路由拒绝记入 `service_audit`，管理员可在 API 治理页查看 |
| 版本归属、角色接口与只读限制 | 转入 `desktop_applications.runtime_policy`。Java 不再按 Token/identity 的 ID 选择行为，SQL 迁移保留旧语义和审计 |
| Office 契约根路径 | 由契约声明受限相对路径；实际主机仍由受控部署绑定确定 |
| 请求关联 | 网关生成请求标识并传给业务上游，屏蔽客户端覆盖；请求正文、Cookie、查询参数不写治理事件 |
| 身份应用展示名称 | 身份管理客户端不再用打包 JSON 覆盖接口返回的名称；独立应用品牌和图标资源仍可静态打包 |

核心代码：[ApplicationGateway.java](C:/Projects/mg-inside/mg-platform-kernel/src/main/java/com/metagravity/desktop/ApplicationGateway.java)、[ApplicationPolicy.java](C:/Projects/mg-inside/mg-platform-kernel/src/main/java/com/metagravity/desktop/ApplicationPolicy.java)、[迁移说明](C:/Projects/mg-inside/mg-platform-kernel/docs/application-registration.md)。迁移脚本中的旧 ID 映射用于一次性转换，属于迁移数据，不是运行时兜底。

## 全部应用核对

下表登记数是当前源码中的发布初始清单，不代表运行库启用状态。新内核对已有服务的旧请求地址也执行治理；未部署新内核的实例保持原行为。

| 应用入口 | 实际接口与归属 | 当前登记 | 尚需处理 |
| --- | --- | --- | --- |
| service-manager | `/api/service-registry/**`，Java 服务控制面 | 不走自身的业务代理 | 已有发布/启停/生命周期变更审计；控制面失败和读取访问不属于现有服务调用记录，仍需平台访问审计 |
| resource-manager | `/overview`、`/resources/{id}/refresh`、`/resources/{id}/metadata`，资源服务 | `resource-manager.api` 3 项，与原生 HTTP 分支相符 | `/health` 纳入探针目录；SSH 采集、定时任务依赖及执行审计由资源服务拥有 |
| files | `/auth/me`、`/desktop`、`/entries/**`、`/folders`、`/uploads`，文件服务 | `files.api` 14 项，与原生 HTTP 分支相符 | 桌面读取、删除原先直走旧地址，本轮已由网关接管。收窄白名单必须保留这五类路径，不能只留 `/entries` |
| office-one | `/status`、`/documents/**`、`/sessions/**`，文件服务的 `/api/office` | `office-one.api` 6 项，与原生 HTTP 分支相符 | 文档下载/保存回调和 ONLYOFFICE 命令另列集成目录；保留签名及服务身份 |
| expert-database | 指标体系、版本树、研究材料、模板、访问授权、语义库、用户和设置等 | `expert-database.api` 仅 3 项只读 | 源码发现 63 项无登记的业务候选，需区分统一身份模式已停用的独立账号能力，补真实契约后收紧 |
| token-one | `/portal/**`、模型目录、额度与令牌 | `token-one.api` 2 项查询 | 门户统计、令牌管理等未登记；不能把管理操作绑定到门户 audience |
| token-one-console | `/admin/**`、控制台身份查询；与门户同一后端 | 无自身服务清单 | 管理端模型、分组、供应商、监控、日志等需以控制台授权登记；Token 提供方合计 54 项业务候选 |
| token-one-docs | `/public/models`、`/auth/me/token-one-docs` | 无 docs audience 对应清单 | 同一物理路径不代表相同调用方权限，不能直接借用 `token-one.api` 改写 audience。只读限制本轮转入数据 |
| identity | `/users/**`、`/roles/**`、`/applications/**`、账号安全、设置及新增管理模块 | `identity.api` 仅 `/auth/me` | 47 项无登记业务候选；身份管理应用原先全部使用 `desktop.apiBase`，包括已登记 `/auth/me`，本轮由网关接管匹配项 |
| personal-center | 账号资料/安全通过 `/api/apps/personal-center/**` 到身份服务；偏好/通知到桌面 | 无 personal-center audience 对应服务清单 | 登录后本人安全操作应补服务契约及语义审计，不能全部以“平台接口”为由排除。须保留本人范围，不能强制依赖管理员的 identity 应用授权 |
| app-manager | `/api/applications`，Java 维护个人外链；系统注册读取数据库 | 平台控制面 | 系统应用注册不允许从个人外链编辑接口修改；外链变更的独立平台审计仍需补充 |
| low-alt-cockpit | 当前工作区没有提供方后端源码；展示资源和测试注册存在 | 无服务清单，样例 `allowedApiPaths=[]` | 当前运行库注册/授权需另行核实；获取真实 API、SDK/认证方式和契约后才登记。不能据一个图标宣称接入完成，也不能仅因公网域名就判断为外链 |

`mg-security-one` 目前只有规划与审计文档，没有可执行后端或可登记 API，不计作已交付应用。

## 缺失 API 逐项清单

已生成 [逐条 Markdown](C:/Projects/mg-inside/mg-desktop-one/docs/api-registration-inventory.md) 和 [机器可读 JSON](C:/Projects/mg-inside/mg-desktop-one/docs/api-registration-inventory.json)，每项包含方法、路径、源码行、已有服务操作及建议处理类型。

| 源码提供方 | 路由声明 | 有登记包匹配 | 无登记业务候选 | 协议与探针 |
| --- | ---: | ---: | ---: | ---: |
| identity | 72 | 1 | 47 | 23 |
| expert-database | 80 | 3 | 63 | 14 |
| token-one | 72 | 2 | 54 | 16 |

合计 224 条声明、164 条业务候选；身份还包含 1 条静态资源路由。候选数不是“当前可调用但绕过审计”的运行统计：控制器声明可能被模式开关关闭或受独立授权限制，仍需按部署模式确认。OIDC 库动态路由和一个页面循环不能由此 AST 扫描穷举。文件、Office、资源的 23 项由原生 HTTP 分支人工核对，并由既有真实提供方 HTTP 测试覆盖。

复查命令：`node scripts/audit-api-registration.mjs`。该命令只生成审计产物，不注册服务、不修改权限。不能用空泛的 `object` 响应 Schema 自动填满目录来冒充契约覆盖。

## 协议及平台边界

| 接口类型 | 应登记和审计的位置 | 执行约束 |
| --- | --- | --- |
| 登录后业务 CRUD 和本人安全操作 | 提供应用的服务清单、契约、环境绑定；网关调用记录 + 提供方语义审计 | 保留独立 audience、业务授权、CSRF、文件流和超时语义 |
| `/api/unified/**`、`/api/directory/**`、OIDC token/authorize/session、SSO 回调和 MFA 挑战 | 身份协议/机器服务目录 + 身份中心审计 | 它们支撑桌面登录和令牌内省，不应强制依赖已登录的桌面服务代理形成循环 |
| Token `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/models` | 外部协议目录，保留 Token 自身请求/用量审计 | 使用 API Key 及流式协议，不能注入桌面 Cookie 或替换成用户会话令牌 |
| Office `/integrations/office/{id}/document`、`callback`、`CommandService.ashx` | Office 集成目录及签名调用审计 | 文档服务 JWT、下载来源校验和保存回调语义不能套成浏览器 CSRF 请求 |
| `/api/session`、`/auth/*`、偏好、通知、个人外链、服务管理控制面 | 平台接口台账与平台审计 | 不递归调用自身的业务网关；“无需业务代理”不等于“不需要审计” |
| 各服务 `/health`、ONLYOFFICE 客户端 JS、字体/图片 | 健康探针目录或静态资源 | 静态资源不伪装成业务服务调用 |
| 知识库的外部 embedding 请求 | 模型提供方/外部依赖目录，调用及用量审计 | 当前 Token Relay 未发现 `/v1/embeddings`，不能假定现有模型网关可直接承接 |

本轮新增 API 治理是现有用户会话网关的观测补齐，没有把当前服务清单格式扩展成机器身份、外部协议或探针执行引擎；上述接口全部保留在整改范围。

## 仍存在的硬编码

| 优先级 | 位置 | 问题及整改要求 |
| --- | --- | --- |
| P1 | `mg-auth-one-identity/src/application-access.ts` | 基础应用、Token audiences、内省关系仍按 ID 列表判断。应进入身份中心自身的授权策略数据；需保留 bootstrap 认证边界，不能盲目改成依赖桌面回调 |
| P1 | `mg-auth-one-identity/src/applications.controller.ts` 的 `mine()` | 两个业务入口 URL 写死在身份控制器中，可能与桌面数据库入口不一致。应消费受控注册投影或统一桌面跳转协议 |
| P1 | 现有应用的宽泛 API 白名单 | files、知识库、Token 样例仍可不限 API 前缀。本轮兼容模式只是显式过渡，需逐应用补契约与白名单再切换 registered。Token 后端有 audience Guard，不能仅凭网关白名单宽泛就断言已越权 |
| P2 | 桌面 `App.vue` | 文件固定 Dock、个人中心入口、文件页路由与退出权限仍绑定应用 ID。可提升为受控平台能力字段，不能仅凭任意应用自报字段获得退出等权限 |
| P2 | 知识库 `zhipu-embedding.ts` | endpoint、模型名与向量维度为代码常量；供应商 endpoint/模型选择应配置化，向量维度变更还需索引重建，不能直接热切换 |
| P2 | 发布脚本及提供方清单同步脚本 | 仓库到应用映射仍散落在脚本中。应集中为构建发布清单；它是构建输入，不是生产应用目录的第二来源 |
| P2 | 跨服务审计关联与持久化保证 | 本轮已下传 requestId，真实客户端地址、提供方语义事件关联、可靠投递/重试和保留期限仍需实现 |

展示图片清单、应用自有页面布局、协议解析算法、测试 fixture 和显式迁移历史可以保留。它们不能反向覆盖运行数据库的名称、入口、启停、授权或服务路由。

## 上线条件与验证

1. 用新 JAR 对目标数据库显式执行 `desktop-applications schema`，确认策略转换审计；备份与回退仍按既有发布流程。
2. 启动新内核后，已登记接口的三种地址均读取当前服务注册库。过渡应用明确显示 `compatibility`；逐项补齐提供方契约、方法、认证和环境绑定后改为 `registered`。
3. 补契约时还要处理静态路径与参数路径的重叠。当前登记规则拒绝同方法重叠，不能把后端所有控制器直接塞进一个清单。
4. 验证旧地址无法绕过停用、错误方法、环境绑定，未登记拒绝和兼容调用有治理记录，已登记调用有准确操作标识；平台及外部协议审计另外验收。

本轮结果：Java 26 项（真实 PostgreSQL、无跳过）、桌面原 69 项及新增 2 项边界测试、公共前端 16 项通过。桌面与服务管理构建通过；身份前端的组织机构模板补了一个显式类型，随后全量类型检查通过。生产打包脚本已去掉旧工具收集并使用隔离 Java 构建目录，未执行整套生产发布。

证据：[完整 JAR/数据库验收](C:/Projects/mg-inside/mg-desktop-one/.runtime/application-registration-MywLej/result.json)、[策略 HTTP 补充验收](C:/Projects/mg-inside/mg-desktop-one/.runtime/application-registration-JFVkd3/result.json)、[实际隔离库事件](C:/Projects/mg-inside/mg-desktop-one/.runtime/application-registration-MywLej/gateway-evidence.json)、[桌面/手机 UI 验证](C:/Projects/mg-inside/mg-desktop-one/.runtime/application-registration-MywLej/governance-ui/result.json)。身份与业务为隔离 HTTP 替身；这些不是生产部署或全部 API 接入完成的证明。
