# MG 平台基础包

桌面和业务应用共同依赖的平台基础设施。视觉规格以指标知识库为基准，业务应用维护页面内容和业务权限。基础包只保留一份源码，应用分别构建、独立部署。

## 当前公共能力

| 能力 | 入口 | 当前使用方 |
| --- | --- | --- |
| 应用框架、内容区圆角与阴影 | `ApplicationShell`、`shell.css` | 知识库、统一身份 |
| 浏览器品牌、当前模块与账号区域 | `ApplicationHeader` | 知识库、统一身份、个人中心 |
| 默认收起、底部切换导航 | `NavigationFooter`、`NavigationToggle`、`layout.css` | 三个应用 |
| 固定页面标题与独立滚动内容 | `PageFrame` | Token One 概览、用量、用户管理 |
| 标题、说明、操作区 | `PageHeading` | Token One 概览、用量 |
| 标准内容面板、筛选与底部操作插槽 | `ContentPanel` | Token One 概览 |
| 会话 CSRF 并发获取与失效处理 | `createPlatformSession` | Token One 请求适配器 |
| 桌面嵌入识别、标题、路由、关闭保护、忙碌、通知、跨应用打开 | `createDesktopApplication` | 三个应用 |
| 消息与安全路径契约 | `desktop-contracts` | 桌面前后端、应用 SDK |

公共层不依赖业务路由、Pinia store 或 Element Plus 运行时。按钮、表格、弹窗等仍由应用现有的 Element Plus 提供，通过插槽组合，避免再包一套没有行为价值的组件。

## 引入方式

当前包名保持 `@mg-inside/frontend`，三个应用通过 Vite alias 和 TypeScript paths 直接引用 `mg-platform/packages/frontend`，并使用 `resolve.dedupe: ['vue']`。TypeScript 的 `vue` 指向消费应用自己的 Vue 类型，避免跨目录解析出多份 Vue。CI 构建须同时检出业务仓库与 `mg-platform`，并固定平台提交版本；不能仅复制某几个组件。

```ts
import { ApplicationShell, ApplicationHeader, PageFrame, PageHeading, ContentPanel } from '@mg-inside/frontend';
import '@mg-inside/frontend/shell.css';
import '@mg-inside/frontend/layout.css';
import '@mg-inside/frontend/embedded.css';
```

```vue
<ApplicationShell :collapsed="collapsed">
  <template #chrome>
    <ApplicationHeader brand-name="应用名称" :logo="logo" :title="currentTitle" @home="openHome">
      <template #actions><!-- 可选角色或辅助操作 --></template>
      <template #account><!-- 应用现有账号菜单及安全退出逻辑 --></template>
    </ApplicationHeader>
  </template>
  <template #navigation><!-- 业务提供已授权菜单，底部使用 NavigationFooter --></template>
  <PageFrame>
    <template #header>
      <PageHeading title="业务列表">
        <template #actions><!-- 业务操作 --></template>
      </PageHeading>
    </template>
    <ContentPanel><!-- 表格、表单或业务内容 --></ContentPanel>
  </PageFrame>
</ApplicationShell>
```

新应用只需要提供：应用 ID、桌面允许来源、路由与菜单、业务用户映射、业务页面、离开/保存回调。不能把令牌放到 URL、localStorage 或桌面消息中。前端会话组件仅获取用户元数据和 CSRF；中心仍是令牌签发和撤销的唯一权威，后端继续强制校验应用授权与业务权限。

### 浏览器顶部导航

`ApplicationHeader` 统一品牌、当前模块、右侧操作及账号区域的结构。`brandName` 必填；`logo`、`logoAlt`、`title`、`description` 可选。默认品牌区为按钮，触发 `home` 事件，由业务应用决定首页路由。需要 RouterLink 或自有品牌图形时使用 `brand` 插槽替换整个品牌区。`actions` 与 `account` 插槽保留消费应用的权限控制、用户菜单、退出确认和请求逻辑；公共组件不读取业务会话，也不自行执行退出。

组件保留 `app-header`、`brand-lockup`、`header-breadcrumb`、`header-right` 样式约定，使用平台渐变及应用主题。桌面嵌入时由统一 `embedded.css` 隐藏整条顶部栏，独立浏览器访问时正常显示；应用不再分别复制顶部栏 DOM。

## 平台边界与后续分层

### 纯 JSON 应用声明

个人中心 `mg-personal-one/application.json` 是首个配置接入样板。平台提供 `config/application.schema.json` 和 `loadApplicationConfig(input, registryKeys)`；JSON Schema 用于编辑器提示，运行时校验在应用启动时强制执行，错误使用中文并指出字段路径。`schemaVersion` 固定为 `1`。未知字段、错误类型、重复页面 ID/路径、重复导航引用、不存在的页面和未注册组件/图标均拒绝。

配置只描述公共外壳、布局和页面索引：应用 ID/名称、品牌、标题显示、默认页、页面标题/图标、导航形式及默认收起状态。部署来源仍使用环境变量；业务组件由显式 TypeScript 注册表映射，不能使用 JSON 字符串拼接 import 路径，也不能在配置中写函数、令牌、密钥或业务授权规则。前端菜单不是后端权限边界。当前先支持 JSON，不引入 YAML 解析或完整页面 DSL。

布局固定为两类：`standard` 使用 `ApplicationShell`、`ApplicationHeader`、`ApplicationNavigation`、`NavigationFooter` 与业务内容；`reading` 复用公共外壳和页头，由文档业务提供阅读区和专用目录，不提供通用 `navigation`。阅读布局不是第四种导航模式。本次不新增通用阅读模板组件；Token 文档页面是现有阅读样板。

标准布局的导航只允许以下三种，例子中的 `profile`、`security` 均引用 `pages[].id`，页面标题和图标在 `pages` 中维护一次：

```json
{ "mode": "flat", "defaultCollapsed": true, "pageIds": ["profile", "security"] }
```

```json
{ "mode": "grouped", "defaultCollapsed": true, "groups": [{ "id": "account", "label": "我的账号", "pageIds": ["profile", "security"] }] }
```

```json
{ "mode": "tree", "defaultCollapsed": true, "parents": [{ "id": "account", "label": "我的账号", "icon": "user", "children": ["profile", "security"] }] }
```

`ApplicationNavigation` 已实现三种实际渲染：单层菜单、带标签分区、固定两级折叠菜单。树的 `children` 只能是页面 ID，不接受嵌套对象。收起侧栏时点击父菜单触发 `expand`，由应用展开侧栏；页面选择触发 `navigate(path)`，由业务路由处理。组件不实现自己的底部展开按钮，统一使用外层 `NavigationFooter`；颜色、间距和选中态沿用知识库的公共样式。个人中心当前实际采用 `flat`。

1. **视觉与框架**：当前 `frontend` 包继续抽取已在多个页面重复出现的结构，包括列表工具栏、表格容器、表单分组、空状态、错误重试、上传反馈。先迁移两个真实使用方再确定通用 API；业务筛选字段、表格列和提交逻辑通过参数/插槽传入。
2. **认证与服务端适配**：后续独立 `auth-client` 包提供中心内省、续期、退出契约，以及 Nest/Fastify/Express 的轻薄适配器。现阶段服务端 SDK 权威源码仍在统一认证项目，未在本次 UI 抽象中迁移。统一鉴权不替代业务角色、额度、分组、指标体系权限，也不以隐藏菜单作为安全边界。
3. **应用运行环境**：从当前桌面 SDK 稳定拆分成 `application-runtime`，承载浏览器/桌面模式、路由桥接、会话失效、任务取消与未保存保护。桌面窗口管理器与 Dock 仍归桌面自身。
4. **业务页面**：知识库树、指标编辑器、模型用量规则、认证管理规则保留在各业务项目。只有出现真实跨应用复用需求才单独提取领域包。

## 版本与发布规划

- 当前为本地源码接入，尚未发布 npm 包。目录独立不表示已配置远程仓库或 CI。
- API 稳定后在内部 npm registry 发布带版本的源码包（Vue 消费方需要 Vite Vue 插件）；再按非 Vue 消费需求提供编译后的 runtime/contracts 包。根入口与 `auth`、`desktop`、`contracts`、CSS 子入口已列入 exports。
- Vue 为 peer dependency；平台不携带另一份 Vue，也不捆绑业务组件库或全局业务 store。
- 生产应用固定经过验证的版本；破坏性变更发布主版本并附迁移说明。应用先在本地/预发升级验证，再分别发布，不让平台改动自动改变所有线上应用。
- 构建时将平台依赖打入应用产物，浏览器不从桌面服务器动态下载平台样式，因此独立浏览器访问不依赖桌面静态资源在线。
- 主题由应用拥有；浅色默认沿用知识库渐变，深色应用覆盖自身语义色。桌面标题栏透明，应用完整画布延伸到其下方。嵌入画布预留 42px 控制区，内容阴影在同一文档中绘制。

## 本地验证

### 注册弹窗

`createApplicationDialogs` 与 `ApplicationDialogHost` 将同一业务编辑组件适配为浏览器 `ElDialog` 或桌面独立子窗口。消费应用需通过 `app.use(ElementPlus)` 或 `app.component('ElDialog', ElDialog)` 注册对话框组件，并引入组件样式；平台使用 `resolveComponent`，不新增 Element Plus 硬依赖。根组件挂载一个 Host；桌面 `platformDialog` 模式只保留 Host，不重复渲染主导航壳。该模式在公共 Host 内预留 42px 标题栏区域。

```ts
const dialogs = createApplicationDialogs({
  desktop,
  dialogs: [{ id: 'external-application', title: '外链应用', path: '/applications/editor', width: 560, height: 640, component: ExternalApplicationEditor }],
});
const result = await dialogs.open('external-application', { applicationId });
if (result.outcome === 'completed') await reload();
// 路由/窗口关闭接入 dialogs.canClose()；beforeunload 按 active 的 dirty/busy 保护。
```

组件接收 `params` 和 `controller` 两个 props。`controller.setState({dirty,busy})` 上报实际编辑状态，`onBeforeClose(handler)` 注册业务关闭确认并返回注销函数，`setTitle(title)` 调整当前弹窗标题，`complete(value?)` 完成并返回结果，`cancel()` 完成确认后取消。空白编辑器不因已打开而被判定为有未保存修改；请求未完成时 `canClose()` 返回 false。宿主强制关闭属于桌面自身控制，不由业务组件隐藏。

底层 SDK 提供 `registerDialogs`、`openDialog`、`waitForDialogContext`、`completeDialog`、`cancelDialog`。注册表会在 hello 握手时重发，结果按请求 UUID 回到父窗口。上下文可先于组件挂载到达；等待上下文超过 15 秒显示错误。参数和结果只接受深度不超过 8 层、UTF-8 编码不超过 16KiB 的 JSON 数据；注册最多 32 项，标题与路径也有长度限制。

注册项 ID、应用 ID、父窗口 ID 和请求 ID 用于关联，名称仅展示。注册不会授予路由或后端权限：桌面继续检查 `appAllowsPath`、同一应用和来源窗口；业务组件仍按唯一数据 ID 读取并验证可编辑状态。不得把业务数据、令牌或密钥放进 URL。`platformDialog` 只标识已注册的组件，参数通过校验后的消息传递；传入可编辑 ID 也不构成写权限。

应用管理的 `src/dialogs.ts` 与 `src/components/ExternalApplicationEditor.vue` 是首个完整样板。浏览器与桌面共用表单、保存失败草稿和关闭保护；完成后由父页面刷新目录并通知桌面。

公共弹层关闭按钮通过 `@mg-inside/frontend/overlays.css` 引入，放在 Element Plus 和应用弹层样式之后。该文件统一 Dialog、MessageBox、Drawer 的右上 46×42 控制区、红色悬停和键盘焦点，文字颜色读取应用语义色，适配深浅主题。只控制视觉，不增加关闭入口或修改事件；`show-close=false`、请求中禁用及原有离开确认继续由业务决定。知识库大型弹窗的滚动区和表格布局仍由其本地样式负责。原生 `window.confirm` 无法用网页 CSS 改外观，后续可通过统一确认接口逐步迁移；当前未替换这些行为。

`npm test` 验证会话客户端的并发与失效行为。桌面目录中的 `scripts/verify-platform-ui.mjs` 使用真实本地三应用验证默认收起、底部按钮、透明标题、最大化、独立浏览器入口、刷新与窄屏布局。

## 公共应用图标资源

应用图标在 `packages/frontend/config/application-catalog.json` 统一声明 Lucide `name`、固定 `palette` 和可选本地图片资源键 `image`。内置应用采用统一的 macOS 风格立体图片，加载失败回退到 Lucide 基础图标，未知应用显示空白占位。`packages/frontend/assets/app-icons/manifest.json` 由生成器派生，不手工编辑；桌面、Dock 和应用目录统一使用 `ApplicationIcon`。详细配置与生成说明见该资源目录的 README。

```ts
import { applicationIcons } from '@mg-inside/frontend/assets';
const personalIcon = applicationIcons['personal-center'];
// personalIcon.src 可供页头、应用图标或 favicon 使用。
// personalIcon.inset 为每侧留白百分比；rounded 对应 20% CSS 圆角。
```

资源模块使用 Vite 的本地静态资源导入，各消费应用分别将图片打入自己的构建产物，独立访问时不依赖桌面服务。`assets` 目录已列入包的发布文件和子导出；它是浏览器构建入口，不供 Node 服务端直接执行。图片原始生成提示词保存在资源目录的 README 中。
