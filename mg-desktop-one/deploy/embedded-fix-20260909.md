# 桌面嵌入空白修复

2026-09-09，用户报告 Token 三应用在桌面打不开，优先处理。上一批公共壳返回按钮新增的 scoped 样式 `:global(.desktop-embedded) .desktop-return { display:none }` 被 Vue 编译成 `.desktop-embedded{display:none}`，隐藏了 iframe 的整个 html。浏览器独立页面没有该类，因此上一批独立网页验收通过不能证明桌面嵌入正常。此问题由本轮公共壳改动引入，影响所有重新构建的应用。

修复删除该冗余样式，使用已有 `v-if="!embedded"` 控制返回入口。另将导航遮罩偏移改为 `:global(.desktop-embedded .mg-navigation-backdrop)`，避免同样语法将 top 错设到根节点。

先修复 Token 门户/控制台/文档，再逐个修复全部其他共享壳应用。均经过类型检查、生产构建、完整产物摘要校验与版本元数据回读。Token 后端网关、业务数据库和 Nginx 配置未改，网关仍为 `mg-gateway:20260908T124729Z`，启动时间仍为 `2026-09-08T13:05:55.162580004Z`。

| 应用 | 修复版本 |
| --- | --- |
| Token 三入口 | 20260909T021113Z |
| 服务管理 | 20260909T021224Z |
| 资源管理 | 20260909T021242Z |
| 文件 | 20260909T021300Z |
| Office One | 20260909T021322Z |
| 个人中心 | 20260909T021340Z |
| 指标知识库 | 20260909T021348Z |
| 统一身份管理 | 20260909T021400Z |
| 应用管理 | 20260909T021419Z |

Token 修复包 SHA256：`f406d1d8cab6921e8ed162b0d08777d23a1c24f029d7e924dee1c2fbbbd9ceb5`；知识库修复包 SHA256：`9d690099e3c53fc6ef94ac6cc797954bde15b3d48bf15c16cd37e58ae37bb8c3`。其余七批摘要与上一版本见 `artifacts/header-app-releases.jsonl`，每批保留独立 release。桌面静态 current 最终为 `/opt/mg-desktop/releases/20260909T021419Z`，桌面运行镜像仍为 `mg-desktop-service:20260909T015833Z`。

新增 `apps/server/src/embedded-shell.test.ts`，直接编译真实 SFC，再解析最终 CSS，拒绝嵌入 html 的 display/visibility/height/width/top/content-visibility 规则。`scripts/check-embedded-build.mjs` 已接入逐应用、服务治理、Token、知识库及完整发布流程，检查发布产物中的全部 CSS。Token 打包复用服务器已存在的哈希资源，仍按完整清单核验文件，缩短紧急发布时间。

验收：修复前正式 iframe 的 html/body 宽高为零，页面 DOM 已加载但不可见。修复后从正式桌面实际启动 Token 门户、控制台、文档三个独立窗口，分别显示概览、统计数据、首次调用文档；三个 iframe 都是 `desktop-embedded`、`display:block`、尺寸 1456×934，且都没有“回到桌面”重复入口。服务管理也经关闭旧空白窗口后从桌面重新启动，服务目录标题可见，根节点尺寸正常。桌面类型检查及相关 3 项测试通过，全部应用构建产物检查通过，容器健康检查正常。

已加载旧 CSS 的空白窗口需要关闭重开；不强制刷新用户正在编辑的文档或表单。其余共享壳应用的本批证据为真实发布及最终 CSS 校验，不能替代各自全部业务流程回归。

服务契约兼容推导工作因本次故障处理暂停，没有新增兼容性实现或发布；目标保持原范围，修复不代表原规划完成。
