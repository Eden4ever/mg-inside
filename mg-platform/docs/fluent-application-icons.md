# Windows 11 Fluent 应用图标

当前采用透明背景、叠层材质和柔和立体光影的 Windows 11 Fluent 风格。复用此前通过内置 `image_gen` 生成的八张最终原图，本轮没有重新生成、重采样或改动图像像素。原图和旧版 `*-3d.png` 均保留。

资源位于 `packages/frontend/assets/app-icons/*-fluent.png`，来源路径、SHA-256 和可见边界见同目录文档 `fluent-icons-assets.json`。

## 主题与接入规则

| 应用 | 主体 |
| --- | --- |
| 文件 | 金黄色文件夹与蓝色文件 |
| 个人中心 | 蓝色叠层人物 |
| 应用管理 | 四块彩色应用方块 |
| 指标知识库 | 蓝色打开的书本 |
| 统一身份认证 | 青蓝色盾牌与勾号 |
| Token One | 青蓝色折叠闪电 |
| Office One | 蓝色文档、绿色表格、橙色演示文稿 |
| 资源管理 | 银蓝色服务器叠层 |

这组设计约束为：单个应用图标、Windows 11 Fluent 风格、真实透明背景、主体居中、简洁可辨识、无文字或水印。对应已有图像生成结果直接复用；不将这段约束冒充历史逐字提示词。

应用只在公共 `application-catalog.json` 的 `icon` 字段配置。`image` 优先，图片加载失败回退到 Lucide 基础图标，再失败显示统一空白占位；未知应用直接使用空白占位。实际资源只打包当前清单引用的文件，历史素材不进入构建。

Token One、Token One 控制台、Token One 文档使用同一张 `token-one-fluent.png`；门户无子标识，控制台配置 `badge: "console"`，文档配置 `badge: "docs"`。子标识由公共组件固定叠加在右下角，宽高均为主图容器的 42%，应用不能自行改变位置和样式。

`imageViewport` 以原图 alpha 大于 128 的主体边界计算，公共组件通过 CSS 等比例缩放并居中，主体最长边与默认图标容器一致。保持原始宽高比，不把书本、盾牌等不同轮廓拉伸成方形。

## 验证

- `mg-platform` 的 16 项配置与公共功能测试通过。
- `mg-desktop-one` 的前后端类型检查、Vite 生产构建通过。
- `mg-desktop-one/scripts/verify-application-icons.mjs` 在 Chrome 中验证 52、48、32 像素尺寸的可见边界与居中，验证 Token 三应用共享图像、子标识大小及位置，以及图片、基础图标、占位图依次加载失败时的回退。
- 浏览器截图和测量保存在 `mg-desktop-one/.runtime/fluent-application-icons/`。

资源管理为预留图标；图标注册不代表资源管理应用已经实现或授予用户权限。

## Dock 特殊入口补充

所有应用入口使用新生成的四色 Fluent 方格图，回收站使用新生成的空、满两态图片。三张原始图均保留于 `C:/Users/Eden/.codex/generated_images/01a0817e-359b-7301-aa1c-f6dbc93a8eea/`，项目资产与摘要见同目录清单。透明像素未修改，仍通过公共 CSS 归一化可见大小。

Files `/desktop` 已有授权响应附带当前用户的 `trashCount`，桌面复用原有刷新节奏选择回收站状态。断网保留上次显示，关闭和移动窗口不等待请求；不同用户的回收站数据通过既有用户归属过滤。真实 HTTP 测试覆盖回收非空、其他账号仍为空，以及永久删除后变空。
