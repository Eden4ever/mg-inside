# 个人中心

个人中心是平台级独立前端应用，应用 ID 为 `personal-center`。它提供统一身份的个人资料、账号安全、桌面设置和通知中心，不承载业务系统的角色、额度或数据授权管理。

## 本地启动

在同级目录检出 `mg-platform`，安装并运行：

```powershell
npm install
npm run dev
```

开发地址为 `http://127.0.0.1:14331`，端口被占用时启动失败，不会静默切换。`npm run build` 执行 Vue/TypeScript 检查并生成 `dist`。将 `.env.example` 复制为 `.env.local` 可修改桌面和统一认证地址。

## 平台接入

应用公共结构由根目录 `application.json` 统一声明：应用 ID/名称、默认路径、品牌、顶部标题、页面组件键、页面标题和图标、导航模式及默认收起状态。`src/application.ts` 调用平台加载器校验数据，`src/registry.ts` 仅保留明确的组件懒加载和图标白名单。`App.vue`、`router.ts`、`desktop.ts` 从同一份已校验配置读取，新增页面无需在三处重复维护标题或 ID。新增业务组件时仍需在注册表中显式 import，配置不能加载任意模块。

当前为 `layout: "standard"` 和 `navigation.mode: "flat"`。平台另支持 `grouped` 分区导航、`tree` 固定两级导航，均由公共 `ApplicationNavigation` 渲染；底部展开按钮仍使用 `NavigationFooter`。阅读类应用选择 `layout: "reading"`，使用自己的文档目录而不是通用侧栏，个人中心不使用阅读模板。

JSON 使用 `schemaVersion: 1`，编辑器可根据 `$schema` 获得字段提示；启动时也会拒绝未知字段、无效页面引用和未注册组件/图标，并给出中文路径错误。部署域名仍由环境变量提供，JSON 不包含认证凭据、后端授权规则或任意 CSS。当前未加入 YAML 依赖。

- 直接引用同级 `mg-platform/packages/frontend` 的源码包 `@mg-inside/frontend`。应用不复制平台组件；独立构建时将平台代码打入自己的静态产物，运行时不依赖桌面提供 CSS 或 JavaScript。
- `ApplicationShell`、`PageFrame`、`PageHeading`、`ContentPanel`、`NavigationFooter` 统一框架与内容结构。渐变以知识库为基准，导航默认收起，展开按钮在底部。
- `createDesktopApplication` 提供窗口桥接、路由、未保存内容和忙碌请求关闭保护。嵌入桌面时隐藏应用页头，直接在浏览器打开时保留完整页头。
- `createPlatformSession` 获取统一会话 CSRF 元数据。所有 API 请求使用 HttpOnly 会话 Cookie；浏览器不会接收或保存网页登录访问令牌。没有独立密码登录页，未登录由桌面登录入口转到统一认证，完成后返回原页面。
- 后续正式发布可由平台发布版本化的私有包，各应用锁定版本升级，替换本地源码别名；组件和认证接口的兼容性由平台维护。

桌面注册 `personal-center`，前端入口配置为本应用地址，允许页面 `/profile`、`/security`、`/preferences`、`/notifications`。桌面设置入口打开 `/preferences`，桌面铃铛打开 `/notifications`。BFF 的 `/api/apps/personal-center` 代理至统一认证 `/api`，使用 `identity` audience，仅允许以下个人接口：

| 方法 | 路径 |
| --- | --- |
| GET | `/auth/me`、`/account-security` |
| POST | `/auth/change-password`、`/account-security/authorize`、`/account-security/authorize/email` |
| POST | `/account-security/totp/start`、`/account-security/totp/confirm`、`/account-security/totp/remove` |
| POST | `/account-security/email/start`、`/account-security/email/confirm`、`/account-security/email/remove`、`/account-security/mfa` |

桌面偏好使用桌面自身的 `GET/PUT /api/preferences`。保存前重新读取已有偏好，只覆盖主题、壁纸和窗口恢复，保留固定应用等其他字段。桌面需在再次激活或收到偏好变化通知后刷新状态，才能使已打开桌面即时更新。

通知中心使用桌面自身的 `/api/notifications`，所有写操作复用平台会话 CSRF：GET 返回 `{items:[{id,text,appId,appName,createdAt,read}]}`；PATCH `{id,read:true}` 标记单条已读，省略 `id` 标记全部已读；DELETE `{}` 清空全部通知，界面操作前要求确认。页面提供加载、空状态、请求错误和手动刷新，不生成示例通知或读取本地假数据。

通知页面每 15 秒在文档可见且嵌入区域与视口相交时刷新；获得焦点、从隐藏恢复时也刷新。离开页面取消未完成的读取并释放定时器、可见性观察和事件监听，避免最小化或离开页面后持续轮询。

## 安全能力与边界

个人资料读取真实统一身份信息。后端没有自助编辑接口，因此页面只读，未设置无效保存按钮。

账号安全复用统一认证原有的密码、认证器、邮箱、多因素验证、恢复码业务流程，仍由中心校验密码、验证码及一次性安全授权凭证。业务流程中的短期绑定凭证只保存在当前组件内存，不是另一套网页登录令牌。

安全密钥和通行密钥与 WebAuthn RP ID、原站点 origin 绑定。此应用只展示已有密钥状态，管理入口通过 `VITE_IDENTITY_ORIGIN/account` 在独立浏览器打开原统一认证页面；选择安全密钥作为操作验证方式时，也明确引导到原站点完成。不会在个人中心的新 origin 调用 WebAuthn，也不会放宽中心校验。未来部署到统一认证同 origin 的 `/personal` 后，可按原 RP 配置整合该流程。

未新增登录设备页，因为中心尚未提供对应查询/撤销设备接口。用户输入的密码、绑定密钥和恢复码不会进入日志或持久化存储。本项目未执行生产部署。
