# 文件应用

平台默认个人文件空间，应用 ID 固定为 `files`。业务应用身份、文件所有者与目录引用全部使用唯一 ID；显示名称不参与权限判断。不签发新用户令牌，通过统一认证权威客户端验证平台的同一枚 T。

## 首版功能

支持文件夹、面包屑、上传队列和失败重试、下载、重命名、移动、名称搜索、排序、Finder 图标网格/紧凑文件列表、收藏、最近、回收站恢复和永久删除。每用户首次访问生成独立根目录及受保护的“桌面”目录；桌面目录自身不能改名、移动或删除，内容可以正常管理。回收站中的文件继续计入空间占用。

图片仅识别 PNG/JPEG/GIF/WebP 签名；文本限 1 MiB 并以文本节点显示；PDF 通过 PDF.js 渲染为 canvas，不执行文档脚本或创建链接/表单层。HTML、SVG、XML 等只允许附件下载。首版不支持共享、Office 编辑、压缩包解压、任意磁盘目录挂载或业务附件自动迁移。

## 开源复用选择

评估了 [VueFinder 4.7.5，MIT](https://github.com/n1crack/vuefinder)：其 [Driver](https://vuefinder.ozdemir.be/api-reference/drivers-interface.html) 可以适配任意后端；[扩展槽](https://vuefinder.ozdemir.be/api-reference/slots.html) 能替换工具栏，但内置面包屑路径主体不提供替换槽，文件命令仍连接内部 modal。当前平台需要 ID 路由、受保护桌面目录、回收批次、跨 iframe 注册弹窗和附件内容安全预览，直接采用需关闭并替换主要命令、预览与导航。本版选择模块级复用，避免同时维护两套对话框状态与文件路径模型：

- `@uppy/core 6.0.1`、`@uppy/xhr-upload 6.0.0`：MIT，复用真实队列、并发控制、进度、错误状态和显式重试。
- `pdfjs-dist 6.3.289`：Apache-2.0，按需加载 PDF 引擎和 worker。
- Vue、Element Plus：MIT，复用平台既有布局、表单、消息框；Finder 列表使用紧凑语义 HTML 表格。
- `@mg-inside/frontend`：共享 JSON 配置、品牌页头、页面框架、配置化导航与底部展开按钮（文件应用按 Finder 特例宽屏展开，窄屏折叠）、统一认证会话和注册弹窗。

保留各依赖包许可证随依赖分发，不复制 VueFinder 的业务代码。未来若采用 VueFinder，需先完成 ID 与其路径适配、注册弹窗命令替换及受限预览回归，不直接替换安全后端。

## 本地启动

要求 Node.js 24（当前验证 24.20.0）。

```powershell
npm ci
node --experimental-transform-types --env-file=C:/Projects/mg-inside/mg-desktop-one/.runtime/local/files.env server/main.ts
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 14351 --strictPort
```

前端 `http://127.0.0.1:14351/`；后端只监听 `127.0.0.1:14350`。开发环境通过桌面 `http://127.0.0.1:4301/api/apps/files` 代理，直接浏览器也通过桌面的统一认证和会话访问 API。服务端不额外设置登录 Cookie。

环境变量（凭据不可提交仓库、不可加入前端配置）：

| 变量 | 用途 |
| --- | --- |
| `IDENTITY_ISSUER` | 统一认证原站点；生产必须 HTTPS |
| `IDENTITY_CLIENT_ID` / `IDENTITY_CLIENT_SECRET` | files 独立服务身份，向统一中心 introspect `app_id=files` |
| `FILES_PORT` | 默认 14350 |
| `FILES_HOST` | 默认 127.0.0.1；容器可明确 0.0.0.0，并仅映射宿主 loopback |
| `FILES_STORAGE_DIR` | 默认相对工作目录 `.runtime/files`；生产使用持久化绝对路径 |
| `FILES_MAX_FILE_BYTES` | 默认 52428800（50 MiB） |
| `FILES_USER_QUOTA_BYTES` | 默认 1073741824（1 GiB） |
| `VITE_DESKTOP_ORIGIN` | 前端桌面来源；生产 `https://desktop.meta-gravity.com` |
| `VITE_APP_BASE` | 生产 `/apps/files/`；开发 `/` |

`server/unified-client.ts` 是 `mg-auth-one-identity/clients/unified-client.ts` 的权威副本；认证契约更新时同步该文件并执行回归。后端不根据用户角色名称授权文件，而仅使用 introspect 返回的 `sub` 校验 owner。

## 路由和 API 合同

普通路由：`/my-files`、`/my-files/:folderId`、`/my-files/desktop`、`/recent`、`/favorites`、`/trash`。从桌面打开文件用 `/my-files?open=<fileId>`，应用重新鉴权读取元数据后打开预览；打开目录用 `/my-files/<folderId>`。

宿主操作入口：`/my-files/desktop?intent=new-folder` 打开新建窗口；`?intent=upload` 显示用户点击的文件选择按钮；`/my-files?intent=rename|move&open=<fileId>` 按 ID 打开编辑窗口，不先预览。右键菜单支持空白/普通条目/受保护条目/回收站，菜单在视口内定位，支持 Escape、外部点击关闭和 Shift+F10。

注册弹窗：`/dialogs/name`、`/dialogs/move`、`/dialogs/preview`，注册 ID 为 `file-name`、`file-move`、`file-preview`。浏览器使用公共 ElDialog 宿主，桌面使用独立 iframe 窗口；参数通过 SDK 消息传递，URL 不带草稿、令牌或文件内容。名称与移动编辑器上报 dirty/busy 并阻止误关；上传期间阻止关闭和切换目录。

后端前缀 `/api`，桌面代理前缀 `/api/apps/files`：

| 方法和路径 | 功能 |
| --- | --- |
| `GET /auth/me` | 基本用户资料 |
| `GET /desktop` | `{folderId,items}`，桌面目录直接子条目 |
| `GET /entries` | 查询参数 `view=files|recent|favorites|trash,parentId,search,sort=name|size|updatedAt|accessedAt,direction,page,pageSize`；返回 items/total/breadcrumbs/rootId/desktopFolderId/parentId/quota |
| `GET /folders` | 当前用户活动目录及可读层级标签，移动选择器 |
| `POST /folders` | `{parentId,name}` |
| `POST /uploads?parentId=…&name=…` | 原始文件 body，要求 Content-Length；不使用 multipart；同名自动保留两份 |
| `GET /entries/:id` | 元数据，隐藏 ownerId/storageKey |
| `PATCH /entries/:id` | `{name?,favorite?,version?}` |
| `POST /entries/:id/move` | `{parentId,version?}`，拒绝自身和子目录 |
| `POST /entries/:id/access` | 记录最近访问 |
| `DELETE /entries/:id` | `{version?}`，整棵活动子树移入回收站 |
| `POST /entries/:id/restore` | 恢复回收批次，原父目录不存在则回根目录，同名保留两份 |
| `DELETE /entries/:id/permanent` | 永久删除回收批次，释放配额 |
| `GET /entries/:id/content` | 附件下载，`application/octet-stream`、RFC 5987 文件名、nosniff、no-store |

写接口均使用与 introspect 用户同一 `csrfToken` 的 `X-CSRF-Token`，缺失或不匹配 403。桌面代理负责 Origin 校验且不转发 Origin。后端受限 loopback，不对公网直接暴露。所有读取、下载、变更均再次以 owner+ID 定位资源，跨用户请求返回 404。

## 存储与部署

元数据以 JSON 原子写临时文件并 rename，进程内串行事务避免丢更新；业务 version 防旧版本覆盖。文件内容存储于 `objects/<服务器 UUID>`，不拼接用户 filename。流式上传预留用户配额，并发请求不能同时透支；失败回收临时对象和配额预留。永删先持久化元数据再清理对象。崩溃可能留下不可引用孤立对象，不会向其他用户暴露；运维后续可在停服且备份后扫描清理。

此版本是**单进程本地持久化**架构，不能让多个 files 进程同时写同一个目录；扩容前迁移事务数据库和对象存储。备份需同时保留 metadata.json 和 objects；持久化目录只允许文件服务账号读写。

生产由统一发布流程部署，本应用不单独发布：

```powershell
$env:VITE_DESKTOP_ORIGIN='https://desktop.meta-gravity.com'
$env:VITE_APP_BASE='/apps/files/'
npm run build
```

将 dist 内容部署在桌面同源 `/apps/files/`，配置 SPA fallback 到 `/apps/files/index.html`，保留 PDF worker 静态文件 MIME。后端用 Node 24 `--experimental-transform-types --env-file=… server/main.ts` 或等效服务管理配置运行，明确工作目录与持久化路径。反向代理将 `/api/apps/files/` 交给桌面会话代理，再转到 files 后端 `/api/`。代理上传大小应至少覆盖单文件上限，超时应满足真实上传速度；不要缓存下载或 API，不丢失 attachment/nosniff 响应头。生产同源 iframe 注册弹窗仍通过 SDK，不新增用户 token。

## 验证

```powershell
npm test
npm run build
node tests/verify-live.mjs
node tests/verify-extras.mjs
```

`server.test.ts` 使用真实 HTTP 和权威 UnifiedIdentityClient、隔离的模拟认证服务验证两个用户、CSRF、越权、protected 目录、循环移动、文件名、安全下载、收藏最近、回收恢复、版本冲突、配额并发和重载。测试目录创建于系统临时目录，结束精确删除。

`verify-live.mjs` 仅用于授权本地联调，读取现有本地测试账号而不打印凭据，在正式 API 创建唯一测试目录、上传文本、验证浏览器/桌面独立弹窗，最后只删除自身创建的测试 ID。截图位于 `.runtime/qa/`。


最终本地回归：10 项后端测试通过；真实统一登录、文本/图片/PDF 预览、Finder 两视图、390px、注册弹窗关闭保护、右键/键盘菜单、受保护目录、上传失败重试和宿主编辑入口通过。桌面目录刷新实测 13.18 秒，双击打开独立预览成功；两份真实 UI 脚本 pageerror 均为空。

