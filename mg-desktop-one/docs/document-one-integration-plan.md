# Document One 接入与改造规划

日期：2026-09-09  
状态：规划，尚未实施。依据两个项目和同级平台服务的当前源码、配置及说明文件；未启动服务或核验生产环境，README 中的历史验证结果不视为本次验收。

实施更新：已开始统一令牌、单点登录和桌面适配开发。源码、验证结果、环境阻塞及待完成项见 `C:\Projects\mg-document-one\docs\desktop-integration.md`。当前尚未完成运行注册与真实协作验收，未发布生产。下文仍为目标方案，不代表全部实现。

## 1. 目标与结论

将 `mg-document-one` 作为独立应用接入 MG 统一桌面，入口为 `/apps/document-one/`，用户从桌面统一登录后进入 Document One 自己的工作台、文档库和知识空间。Document One 继续负责文档内容、实时协作、版本、评论、分享、附件、搜索和文档级权限；桌面负责应用目录、窗口、导航、会话生命周期和统一代理。

推荐采用“同源桌面路径 + 平台 API 代理 + Document One 统一认证适配层”。不把现有 Document One 的本地签名令牌继续作为内部登录方案，也不把访问令牌放进 URL、localStorage、iframe 参数或桌面消息。

## 2. 当前基线与主要差距

| 领域 | Document One 当前实现 | 接入所需改造 |
| --- | --- | --- |
| 前端 | Vue 3/Vite，入口默认 5190，路由使用根路径 | 支持 `/apps/document-one/` 基路径、桌面嵌入态、公共页头/账号区隐藏 |
| API | Fastify，默认 4190，`Authorization: Bearer` 校验项目 `AUTH_SECRET` 签发的两段式令牌，并查询本地 `auth_sessions` | 接受统一身份中心令牌，映射到业务用户；补平台 CSRF 校验 |
| 协作 | Hocuspocus，默认 4191，客户端通过 `VITE_COLLAB_URL` 连接 | 桌面路径下提供同源 WebSocket 入口，代理保留 Upgrade、Origin 和断线重连语义 |
| 数据 | PostgreSQL 保存业务数据，Redis 广播/缓存，MinIO 保存对象，ClamAV 扫描附件 | 保留业务存储；先做用户/租户 ID 映射，实施前核对完整迁移清单 |
| 产品 | 工作台、编辑器、协作、权限、评论、版本、回收站、模板、导入导出、管理后台已较完整 | 重点补桌面生命周期、统一会话、应用注册和深链 |

## 3. 认证改造决策

### 3.1 目标契约

统一身份中心是唯一令牌签发、续期、撤销和应用授权来源。Document One API 的业务授权仍由自身数据库判断，不能把 `authorizationAppId` 或前端菜单当作文档 ACL。

复用 `mg-auth-one-identity/clients/unified-client.ts` 的权威 `UnifiedIdentityClient`，遵循当前平台客户端同步机制；在 Document One 增加轻薄的 Fastify 适配层，不另建通用认证包：

- 通过中心内省确认令牌、中心会话和 `document-one` 应用授权，失败时拒绝访问；
- 从中心返回的稳定主体取得用户和会话信息；业务租户和业务管理员角色由映射及 Document One 数据库决定，不假定中心直接提供同义字段；
- 将中心主体映射到 Document One 的 `users.id`，首次映射必须显式启用，禁止按邮箱静默换绑；
- 退出和撤销时使 API、协作连接在 5 秒目标内失效。

内部部署切换为统一认证模式后，关闭旧本地登录、refresh、OIDC 和企业微信登录旁路，不签发业务登录令牌，不创建可独立认证的本地会话。原独立部署是否继续服务外部用户，应通过独立运行配置和入口明确划分；不能在统一内部入口认证失败后自动降级到旧登录。

建立 `(issuer, subject) -> document_user_id` 与组织到业务租户的显式映射，保留原用户 UUID、文档所有者、ACL、评论作者、版本作者和审计引用。新成员按应用授权和受控开户策略创建，默认不授予管理员；部门/用户组的既有 ID、ACL 和企业微信同步来源先保留，后续单独处理目录来源切换。

### 3.2 浏览器与桌面传递

HTTP 路径为：浏览器 HttpOnly Cookie -> Java 网关中心会话校验、应用授权和 CSRF -> 上游 `Authorization: Bearer T` -> Document API 再次内省 T 并计算业务权限。T 是同一枚中心访问令牌。公共 `createPlatformSession` 只取会话元数据和 CSRF，前端不读取 T；上传 XHR、直接 fetch 和下载必须一起适配，不能只改通用请求封装。

WebSocket 是 M0 必须验证的独立工作项。当前 Java 网关基于 Spring Cloud Gateway，但未发现已落地的 Document 协作 Upgrade 路由与验收。推荐新增受控同源 `/ws/apps/document-one/` 路由：握手校验 Cookie、精确 Origin、应用启停和授权，再由服务端向 Collab 注入同一枚 T。浏览器原生 WebSocket 无法任意设置 Authorization，不要求前端设置该头，也不另发文档登录票据。

Collab 从受信上游请求头建立连接身份，Hocuspocus 的文档认证消息只提供文档上下文；必须验证所用版本能读取连接请求头，否则先完成服务端接入适配再进入 M1。内部授权同时检查中心会话和文档 ACL，替换 `refreshLiveAuthorization` 对本地 `auth_sessions` 的硬依赖。中心撤销、应用停用、业务降权均要对存量连接生效；令牌到期受控重连，由当前 Cookie 会话提供更新后的 T。依赖异常时禁止继续写入，保留可恢复草稿并提示。

## 4. 桌面与应用注册

在平台 `desktop_applications` 登记一项 `document-one`，下表是建议值，完整清单按内核 schema 生成和验证：

| 字段 | 建议 |
| --- | --- |
| id / authorizationAppId | `document-one`，身份中心显式授权 |
| kind / name | `internal` / 在线文档 |
| entryUrl | 桌面同源 `/apps/document-one/` |
| upstream | Document API 的受控地址，API 根路径按契约配置；不是 Web/Vite 地址 |
| defaultPath | `/workspace`；与最终注册的入口基路径语义联调 |
| allowedPaths | 精确覆盖工作台、文档、文档库、知识空间、搜索、回收站、模板、审批和管理页面；不要把 `/` 当任意子路径通配符 |
| allowedApiPaths | 根据实际 API 根路径整理业务前缀，不开放 `/metrics`、运维探针和旧登录旁路 |
| runtimePolicy.apiMode | `registered`；先登记并启用实际使用的 HTTP 操作与部署绑定 |
| 窗口 | 默认最大化；最小尺寸按公共窗口裁切规则适配窄屏 |

应用注册、身份授权、HTTP 服务契约和 WebSocket 路由是四个不同交付项。应用出现于目录不代表 API 已开放；只添加前端图标也不会注册应用。按领域整理 OpenAPI，保留现有 `/api/v1` 业务协议，在统一 `/api/apps/document-one/**` 出口完成受控路径映射，不新增业务 ID 特判。

应用图标加入 `mg-platform` 资源目录，桌面、Dock 和独立应用页统一引用资源键。第一期保留一个应用入口，管理菜单由业务角色控制；只有出现独立分配管理入口的需求时才增加 `document-one-admin` audience。

## 5. Document One 代码改造包

1. **部署配置**：新增 API 与应用基路径配置，保留已有 `VITE_COLLAB_URL`；Vite base 从配置读取，桌面构建为 `/apps/document-one/`，路由使用 `createWebHistory(import.meta.env.BASE_URL)`。静态资源用应用基路径，API/上传/下载用统一 API 出口，公开分享链接用明确的公开入口；不能给所有 URL 机械添加同一个前缀。
2. **公共壳接入**：引入 `@mg-inside/frontend` 的公共壳、页头和 `createDesktopApplication`；工作台/管理页用标准布局，编辑器保留专用目录、工具栏和正文画布，不把文档树塞进通用两级菜单。嵌入态隐藏重复页头、预留 42px 控制区；保留当前编辑器主题并检查公共 CSS 影响。配置 Vue dedupe 和 TypeScript paths，不复制平台源码，不强制重写现有组件库。
3. **API 适配**：将 `apps/web/src/services/api.ts` 的本地令牌/刷新逻辑改为平台 Cookie 请求、统一会话失效与 CSRF；服务端身份适配集中在认证钩子，业务 ACL 查询继续使用内部用户 ID。附件、导出、公开分享等自行鉴权的路由逐一盘点。
4. **协作与保存状态**：复用已有相对 `VITE_COLLAB_URL` 支持和 `collaboration.persisted` 回执。dirty 根据尚未获服务端持久化确认的编辑计算，不能把 Yjs 已同步或已写 IndexedDB 当作云端已保存。上传/导入等不可中断步骤上报 busy；异步导出任务创建成功后可后台继续，不将所有后台任务一律阻止关闭。
5. **离线缓存**：现有 IndexedDB 键为 `mg-document:${documentId}:v1`，需增加租户和用户维度。退出、切换账号、撤权时停止 provider 并隔离/清理对应缓存；旧缓存只能在确认原主体后迁入新命名空间，不让另一账号自动读取。未上传草稿先告知保存状态，禁止重新鉴权前上传旧用户修改。
6. **页面与深链**：支持完整文档 URL、锚点、浏览器刷新和桌面标题同步；宿主发起 navigate 也经过业务离开守卫。现有桌面默认按应用复用窗口，第一期沿用，双文档独立窗口另计窗口模型改造。独立浏览器入口也经统一会话服务完成登录，保留当前页面。

### 5.1 本阶段系统边界

本阶段只接入 Document One，不做 Files、Office、Token、知识库或其他系统之间的数据流转，不新增跨系统引用、导入、导出、通知聚合或搜索聚合。Document One 的附件、文档库、导入导出和权限继续使用自身实现；桌面不读取 Document One 数据库，也不改变其对象存储归属。跨系统打开和数据交换另立需求、接口和验收，不作为本次接入的隐含前置条件。

### 5.2 分享与外部协作者

公开分享不能直接套用要求桌面登录的 `/api/apps/**` 代理。保留受限公开入口和公开 API，按原分享令牌、密码、有效期和文档策略鉴权；组织分享则走统一身份与业务组织校验。公开页面不得获得内部应用目录或中心访问令牌。外部邀请保持独立能力边界，在未完成其身份/会话设计前不切换该入口；既有链接的域名和跳转兼容需列入发布清单，不默认关闭既有生产功能。

## 6. 数据与部署边界

Document One 的 PostgreSQL、Redis、MinIO、ClamAV 和 Worker 保持独立服务和备份链路。源码继续维护在 `C:\Projects\mg-document-one`，构建显式引用 `C:\Projects\mg-inside\mg-platform` 并固定版本；本轮不复制出第二套实现。目录迁入 `mg-inside` 若有需要，可作为单独的构建路径整理工作。

用户映射先做只读盘点和 dry-run，输出匹配、冲突、未绑定和外部成员清单；备份数据库、Yjs 状态、附件和导出对象后，在隔离环境验证绑定前后的权限一致。优先增量迁移，不重新生成业务用户 UUID。部署切换与数据库迁移分开；回滚保留切换期间的新文档及编辑，不能直接恢复旧库丢弃新写入。

生产拓扑建议为 `document-web`、`document-api`、`document-collab-1/2`、`document-worker`，对外提供 `/apps/document-one/`、`/api/apps/document-one/**` 和受控协作入口。接入桌面不等于迁服务器：先确认现有部署可达性、资源和数据规模，再决定同机或受控跨主机连接。保留上传大小、超时、下载响应头和 WS 心跳；API/协作/Worker 的健康与指标走运维访问控制。

## 7. 依赖顺序与里程碑

| 阶段 | 产出 | 完成门槛 |
| --- | --- | --- |
| M0 | 本地基线、认证/WS 验证、身份映射 dry-run、接口台账 | 隔离用户可通过同一中心令牌打开并持久化一个测试文档；确认 Hocuspocus 握手适配方案 |
| M1 | 身份/ACL/CSRF 改造、应用注册、HTTP 契约、基路径和公共壳 | 统一登录后进入工作台，无本地登录旁路；刷新、深链和未授权访问正确 |
| M2 | 协作完整适配、离线缓存隔离、窗口关闭保护 | 双用户协作与落库；撤权、应用停用、退出、令牌过期和账号切换均通过 |
| M3 | 文档各业务页、公开访问边界和导入导出回归 | 原有功能在新路径下闭环；分享、外部访问和运维接口权限不回退 |
| M4 | 灰度部署、备份/恢复、双副本重启、监控和回滚 | 本地与预发证据分别记录；灰度用户真实业务验证通过后再扩大范围 |

初步估算：接入约 25-40 人日。假设一名前端、一名后端，测试/运维配合，已有环境可用且不整体迁移历史存储；并行后约 4-6 周。此为规划估算，M0 完成后依据接口数量、身份冲突和 WS 验证结果重估，不作为发布承诺。本次不估算跨系统流转工作。

### 7.1 改动归属

| 项目 | 主要交付 |
| --- | --- |
| mg-document-one | Web 入口/路由/请求/编辑器状态、API 认证钩子、Collab 动态授权、身份映射迁移、业务回归 |
| mg-auth-one-identity | 应用 audience 和受控授权、沿用权威客户端；有明确契约缺口再调整服务端 |
| mg-platform | 应用图标、公共组件消费适配；只提取实际可复用的运行时能力 |
| mg-platform-kernel | 注册与服务契约支持、受控 WS 路由、会话/授权/Origin 校验及回归 |
| mg-desktop-one | 接入注册材料、桌面闭环验证、部署入口和发布记录；不承载文档业务后端 |
| mg-files-one / mg-office-one | 本阶段不改动、不接入；未来另立跨系统流转项目 |

## 8. 验收清单

- 按各仓库脚本执行类型检查、构建和相关测试；Document One 全量回归及 Java 内核注册/代理测试通过；
- 浏览器验证统一登录、退出、账号切换、401 续期、CSRF、应用授权和无权限深链；
- 两个标签页验证标题编辑、多人光标、离线恢复、动态降权和撤权；
- 验证 Markdown/DOCX/PDF、附件扫描、下载响应头、版本恢复、评论提及和回收站清理；
- 验证窗口关闭保护、最小化保持协作、刷新、独立浏览器和窄屏；不把跨应用打开列为本阶段门槛；
- 验证 A 账号离线编辑后切换 B 不可见 A 草稿；撤权后已打开连接停止写入；身份中心或权限校验故障不得静默放行；
- 检查浏览器存储、网络 URL、桌面消息和日志均不含可读取的访问令牌，公开分享不泄露内部目录；
- 记录 API/Collab/Worker/DB/Redis/MinIO/ClamAV readiness、Prometheus 指标、审计事件和回滚点。

## 9. 明确不纳入本轮

本轮不重写 Document One 编辑器，不合并两个项目的数据库，不把 MinIO 对象迁入其他文件系统，不做 Files/Office 或其他系统的数据流转，不新增 Base/电子表格/幻灯片/白板，也不把 AI、DLP 或原生客户端作为接入前置条件。上述能力另立版本规划。

## 10. 核对依据

- 当前项目：`README.md`、`docs/platform-conventions.md`、`docs/application-access-and-external-apps.md`、`apps/web/src/App.vue`。
- 平台：`mg-platform/README.md`、`packages/frontend/auth/session.ts`、`desktop-sdk`；内核 `docs/application-registration.md`、`ApplicationGateway.java`。
- Document One：`apps/web/src/router.ts`、`services/api.ts`、`services/attachments.ts`、`components/DocumentEditor.vue`、`apps/api/src/auth.ts`、`apps/api/src/server.ts`、`apps/collab/src/server.ts`。
- 相邻业务：`mg-files-one/README.md`、`mg-office-one/README.md`。其发布状态描述未在本轮作线上复核。
- 历史导出与协作验收仅用于定位回归入口；本次必须重跑实际环境门禁，不能沿用历史结论。
