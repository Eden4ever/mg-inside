# 应用管理

独立应用 ID 为 `app-manager`，默认页面 `/applications`，本地开发端口 `14341`。应用目录列出当前用户获授权的系统应用、内部应用及自己的外链应用。系统和内部应用只读；后端不返回未授权项目，前端遇到过期或异常的 `available=false` 项目时仍禁用打开并提示“无访问权限”。仅 `kind=external` 且 `editable=true` 的项目提供编辑和移除操作。

## 启动和构建

在同级目录检出 `mg-platform`，运行：

```powershell
npm install
npm run dev
```

访问 `http://127.0.0.1:14341/applications`。`npm run build` 执行类型检查并生成独立的 `dist` 静态产物。按部署环境将 `.env.example` 复制为 `.env.local`；生产环境将 `VITE_DESKTOP_ORIGIN` 改为正式桌面来源，不启用 `VITE_ALLOW_LOCAL_HTTP`。

本应用只依赖 Vue、Vue Router、ElementPlus、图标库及构建工具，没有复制个人中心的密码、MFA 或其他安全业务页面。

## 公共配置与框架

根目录 `application.json` 使用平台 JSON Schema，声明应用 ID、名称、首页、页面、导航、品牌和浏览器页签标题。`src/registry.ts` 显式注册页面组件、图标和 `enterpriseLogo` 静态资源；配置不能拼接任意模块路径。

页面采用 `ApplicationShell`、`ConfiguredApplicationHeader`、`ApplicationNavigation`、`NavigationFooter`、`PageFrame`、`PageHeading` 和 `ContentPanel`。默认收起侧栏，底部展开；独立浏览器显示品牌和页头，桌面嵌入模式隐藏页头并通过公共 SDK 与桌面同步标题、路由和未保存状态。

应用名称与说明以平台 `applicationPresentation('app-manager')` 的统一目录为准，JSON 保留页面、导航和资源配置。外链编辑器注册于 `src/dialogs.ts`：ID `external-application`，路由 `/applications/editor`，默认 560×640。`ExternalApplicationEditor.vue` 接收参数和公共控制器；浏览器中由 `ApplicationDialogHost` 渲染 ElDialog，桌面中由同一 Host 渲染独立子窗口内容。编辑只传 `applicationId`，组件通过真实目录重新检查项目是否存在且可编辑；名称不用于权限判断。参数不进入 URL，完成后父页面刷新目录并发送 `applicationsChanged()`。

## 接口约定

请求全部访问 `VITE_DESKTOP_ORIGIN`，使用 HttpOnly 会话 Cookie；写操作通过 `createPlatformSession` 获取 CSRF 元数据。没有自己的登录页、用户令牌或权限存储，未登录转统一认证后返回原页面。

| 方法与路径 | 请求或返回 |
| --- | --- |
| GET `/api/applications` | `{items:[{id,name,description,kind,editable,available,entryUrl,defaultPath,icon,minWidth,minHeight}],desktop:{name}}` |
| POST `/api/applications` | 请求 `{name,url,description,icon}`，返回创建后的项目 |
| PUT `/api/applications/:id` | 同上，返回更新后的项目 |
| DELETE `/api/applications/:id` | 无请求体，返回 `{ok:true}` |

图标枚举为 `knowledge`、`token`、`identity`、`personal`。修改完成调用 `desktop.applicationsChanged()` 通知桌面刷新。桌面中打开应用调用 `desktop.openApplication(id)`；浏览器独立访问时打开桌面 `/open?app=id`，由桌面继续处理认证与应用访问权限。

界面支持名称/说明搜索、分类、添加/编辑对话框、移除确认、空状态和错误重试。刷新不会清空编辑草稿；网络写请求未完成时不能关闭，未保存的内容离开前确认。后端必须继续按用户隔离外链记录并验证每次新增、修改、移除；前端只读状态不构成权限边界。

## 外链边界

只接收完整 HTTPS 网页地址；开发环境前端允许 `localhost`、`127.0.0.1`、`[::1]` 的 HTTP 地址，但后端还会拒绝平台应用主机及其子域，避免同主机 Cookie 共享和重复注册。拒绝 URL 中的用户名/密码、非网页协议和控制字符，后端独立执行相同或更严格的校验。应用名称最多 80 字符，说明最多 200 字符。

添加外链不会改变外部站点的认证方式。登录缓存、第三方 Cookie、存储分区以及 iframe 嵌入能力由浏览器政策和网站设置决定，不能保证复用所有登录状态。网站拒绝嵌入时应在浏览器打开；此应用不绕过 CSP、X-Frame-Options 或其他站点限制。

本项目未部署生产。自动化 CRUD 验证使用测试接口，避免修改真实外链或业务权限。

## 界面验证

先启动开发服务，再执行 `npm run test:ui`。测试使用 Playwright，拦截会话和应用目录接口，覆盖内置应用只读、权限状态、搜索与分类、地址校验、写入失败保留草稿、新增编辑删除、未保存确认以及 390px 窄屏。默认使用 Playwright 浏览器，也可在 PowerShell 中设置 `$env:BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'` 使用已有 Chrome。截图保存在系统临时目录，测试不改真实数据。

`tests/verify-live.mjs` 是仅用于已授权本地环境的真实联调脚本，读取隔离测试账号（可通过 `ACCOUNT_FILE` 指定），验证独立统一登录、CSRF、桌面注册与外链隔离。它会创建一条带时间戳的外链，并在完成或失败后按返回 ID 精确清理；不要对生产环境运行。

