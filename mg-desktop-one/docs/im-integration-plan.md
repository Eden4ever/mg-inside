# 开源 IM 接入规划

日期：2026-09-10

状态：选型与实施规划，尚未部署、尚未修改生产配置。

## 1. 结论

首选 **Zulip Server**，以自托管方式作为 MG Inside 的一个独立应用接入桌面。Zulip Server 使用 Apache 2.0，提供频道/主题线程、私聊、群组、文件、搜索、实时更新、REST API 和 OIDC 认证；官方提供 Docker 镜像。它更适合内部工作协作和可检索的业务讨论，而不是只做短消息转发。

建议的第一版边界是：

- Zulip 独立部署在单独的 IM 主机或专用虚拟机，使用独立 PostgreSQL、Redis/RabbitMQ、上传目录和备份策略。
- 通过统一身份中心的 OIDC 登录，关闭 Zulip 本地密码登录、开放注册和未审批的访客入口。
- 在 `mg-desktop-one` 注册一个 `im-zulip` 应用，先以独立应用窗口接入；只有在 CSP、WebSocket、上传下载和退出行为通过验收后，才允许 iframe 嵌入。
- Zulip 的用户、频道成员和消息权限仍由 Zulip 负责；MG 身份中心只负责登录主体、应用授权和停用状态，不把“能看到桌面图标”当作 IM 权限。

这不是把 Zulip 的数据库或登录表并入 MG 数据库，也不是把消息接口粗暴转发到桌面网关。

## 2. 为什么选 Zulip

| 方案 | 适合点 | 主要问题 | 本项目结论 |
| --- | --- | --- | --- |
| Zulip | Apache 2.0；OIDC；主题线程和检索强；官方 Docker；REST/事件接口成熟 | 标准 OIDC 会创建 Zulip 本地用户/会话；资源比轻量 IM 多 | **首选，先做认证与嵌入 PoC** |
| Matrix + Element | 联邦、端到端加密和生态强 | 实际是 Synapse、客户端、推送和密钥管理的一组系统；Element Web 为 AGPL；嵌入和密钥恢复复杂 | 以后有跨组织/端到端需求再评估 |
| Rocket.Chat | 传统 IM 体验和集成较丰富 | 仓库许可证元数据不是单一清晰的 OSI 标识，社区/企业功能边界需逐版核对 | 不作为第一选择 |
| OpenIM | Apache 2.0；更像可嵌入的 IM 基础设施 | 需要自行补产品前端、管理、运营和较多业务集成 | 若要做深度定制，再单独立项 |

许可证和功能以实际锁定版本的仓库与发布包为准，生产发布前必须保存版本、镜像摘要和许可证清单。

## 3. 认证边界：先解决一个关键冲突

现有桌面规划要求内部应用尽量使用身份中心签发的同一访问令牌；Zulip 的标准 OIDC 接入则通常是“OIDC 登录成功后，在 Zulip 建立自己的应用会话”。因此不能把普通 OIDC SSO 描述成“Zulip 已经直接使用 MG 的同一业务令牌”。

分两档验收：

### A 档：外部应用 SSO（推荐首版）

Zulip 作为独立应用，使用 Authorization Code + PKCE 的 OIDC 流程登录。Zulip 本地只保存不可用于 MG 其他服务的应用会话；用户、邮箱、显示名和停用状态按稳定 `sub` 映射。MG 桌面只保存自己的 HttpOnly Cookie，不向 iframe 或 `postMessage` 传递访问令牌。

这个模式可以较快上线，但必须在架构文档中明确它是“外部应用会话”，不纳入“所有内部业务共用同一枚访问令牌”的强约束。

### B 档：严格统一令牌（暂不承诺）

如果业务要求 Zulip 请求也必须携带 MG 当前访问令牌，则先开发 `mg-im-bridge` 验证服务：验证中心令牌、应用 audience、撤销状态和 CSRF/Origin，再通过 Zulip 支持的认证扩展或受控服务端接口建立用户上下文。不得在浏览器端放 API Key、服务密钥或通过窗口消息传递令牌。

只有 PoC 证明注销、停用、授权撤销、长连接和移动端登录都能得到清晰语义后，才决定是否投入 B 档。不能为了“看起来统一”而在网关中静默兑换另一枚用户令牌。

## 4. 在桌面中的接入形态

### 应用注册

生产注册走现有应用注册库和服务管理流程，不直接修改 `tests/fixtures/legacy-config.ts`。建议新增：

```text
appId: im-zulip
name: 团队沟通
entryUrl: https://im.meta-gravity.com
defaultPath: /
kind: internal
instancePolicy: singleton
capabilities: [focus, title-change, notification-count]
```

如果 Zulip 前端和 API 由同一域名提供，先只登记入口元数据；消息 API 不自动纳入桌面通用代理。确需跨服务调用时，单独登记 `zulip-im.api` 契约、方法、权限和环境绑定。

### 窗口与浏览器安全

1. 第一阶段用“桌面窗口打开独立 HTTPS 地址”验证完整登录和实时消息。
2. 通过 `frame-ancestors https://desktop.meta-gravity.com`、桌面 `frame-src`、精确 CORS 和 WebSocket `wss` 验证后，再尝试 iframe。
3. iframe 模式必须支持 `ready`、`focus`、`title-change`、`visibility-change` 和 `auth-required`；聊天窗口没有未保存表单时仍要正确上报 busy/close 状态。
4. `postMessage` 只传协议版本、窗口 ID、路由和未读数，不传令牌、密码、消息全文或可执行内容。
5. 桌面退出先撤销 MG 会话，再让 Zulip 会话失效；需要验证浏览器刷新、多个窗口、移动端和网络断开后的行为。

## 5. 部署设计

### 资源与主机

Zulip 官方文档给出的最低建议是约 2 GB 可用内存，100 人规模建议 4 GB、2 CPU，并需要 PostgreSQL、Redis/RabbitMQ 等依赖。当前桌面生产主机记录的可用内存约 1.4 GiB，不能直接把 Zulip 和现有桌面服务堆在同一台主机上作为生产方案。

建议：

- 新建专用 VM 或独立云主机，先按 2 vCPU / 8 GB RAM / SSD 规划，留出升级和缓存余量。
- 使用官方 Docker 镜像，锁定具体版本和 digest；不要使用 `latest`。
- 由 Nginx 提供 `im.meta-gravity.com`，证书沿用现有受控续期流程；WebSocket、上传上限和长连接超时单独验收。
- PostgreSQL、队列、上传目录和配置密钥独立卷；不复用身份中心库、桌面服务目录库或 Files 的业务表。
- 备份至少包含数据库、上传对象、Zulip 配置/密钥、OIDC 客户端配置和版本摘要；先在隔离环境完成恢复演练。

### 数据与治理

- 消息正文、附件、用户关系和搜索索引属于 IM 业务数据，设定保留期、导出/删除流程和管理员访问审计。
- 默认关闭公开注册和访客；频道按组织、项目和系统分组，敏感频道采用最小成员原则。
- 禁止将消息全文写入 MG 桌面访问日志；网关只记录 requestId、应用、用户主体摘要、状态和耗时。
- 明确通知邮件、移动推送、外链预览和文件下载是否允许访问公网；不需要的能力默认关闭以降低 SSRF 和数据外泄风险。

## 6. 分阶段计划

| 阶段 | 工作量估计 | 交付物 | 通过条件 |
| --- | ---: | --- | --- |
| P0 选型 PoC | 2-3 人日 | 隔离 Zulip、OIDC 客户端、测试用户、iframe/独立窗口样例 | 登录、退出、停用、WebSocket、上传、移动端和备份恢复均有记录；明确采用 A 档还是继续验证 B 档 |
| P1 基础设施 | 3-5 人日 | 专用主机、Docker Compose、域名、TLS、独立数据库/卷、健康检查和备份 | 可重启、可恢复、镜像 digest 固定；无真实生产用户数据 |
| P2 桌面接入 | 3-5 人日 | `im-zulip` 应用注册、入口、窗口协议、CSP、未读数方案 | 桌面登录后进入 IM；未授权用户看不到或打不开；退出后旧会话不可继续使用 |
| P3 组织治理 | 4-6 人日 | 组织/频道模板、用户停用同步、管理员角色、消息保留和审计 | 两个角色、两个组织范围、附件和导出删除流程验收通过 |
| P4 小范围试点 | 3-5 人日 | 10-20 人试点、运行手册、故障/回滚预案 | 连续运行 7 天，无 P0/P1 安全问题；再决定是否扩大范围 |

首版约 15-24 人日；若选择严格统一令牌 B 档，再增加认证适配和长连接专项，不把它隐藏在普通接入工作量里。

## 7. 必须先验收的场景

1. 新用户首次登录、重复登录、登录失败、账号停用、应用授权撤销和统一退出。
2. 桌面独立窗口、iframe、浏览器直访三种模式的 Cookie、Origin、CSP 和 WebSocket 行为。
3. 私聊、频道、主题线程、附件上传/下载、搜索、消息编辑/删除和审计日志。
4. 两个浏览器窗口同时在线，最小化/恢复不丢实时消息；网络断开后重连不重复发送。
5. Zulip 数据库、附件和配置恢复到新主机；恢复后用户映射、OIDC 和消息读取正常。
6. 生产资源、CPU/内存、消息延迟、队列积压、数据库增长和磁盘告警有可操作阈值。

## 8. 暂不做的范围

首版不做跨应用全文搜索、把聊天消息复制到桌面通知数据库、企业微信/钉钉双向同步、端到端加密改造、自研移动端、历史消息迁移和严格统一令牌 B 档的生产承诺。以上任何一项都应另立需求并补数据、权限和回滚设计。

## 9. 下一步

下一步只做 P0：在隔离主机或本地测试环境启动锁定版本的 Zulip，注册一个临时 OIDC 客户端，使用非生产测试账号验证登录/退出、桌面窗口、WebSocket、附件、用户停用和备份恢复。P0 通过前不改生产 Nginx、身份中心生产客户端、应用注册库或真实用户权限。

参考：

- [Zulip Server](https://github.com/zulip/zulip)
- [Zulip Docker image](https://github.com/zulip/docker-zulip)
- [Zulip authentication methods](https://zulip.readthedocs.io/en/latest/production/authentication-methods.html)
- [Zulip production requirements](https://zulip.readthedocs.io/en/latest/production/requirements.html)
- [MG 桌面规划](desktop-plan.md)
- [服务环境发布与部署绑定](service-environments.md)
