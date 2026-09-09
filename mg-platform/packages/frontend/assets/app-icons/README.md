# 公共应用图标

应用名称和图标配置的唯一来源是 `../../config/application-catalog.json`。内置应用使用统一的 macOS 风格立体图片；基础图形来自 Lucide 官方固定版本 `lucide-static@1.43.0`。导航继续使用单色线型图形，应用图标的彩色底板不用于导航。

## 声明与优先级

```json
"files": {
  "name": "文件",
  "description": "个人文件、桌面、收藏与回收站",
  "icon": { "name": "folder", "palette": "blue", "image": "files-3d.png" }
}
```

- `name` 是 Lucide 图标名称，构建时从固定版本官方包读取。
- `palette` 只能选择平台固定色板：blue、sky、violet、indigo、lavender、teal、slate-blue、ocean、slate、neutral。不能注入 CSS、渐变参数或 SVG。
- `image` 可选，只能是本目录已存在的本地 PNG、WebP 或 SVG 文件资源键，不接受 URL 或路径。目前由开发者在公共目录配置，尚无上传自定义图标界面；外链应用默认使用统一空白占位。由消费应用自己的 Vite 构建打包，不在运行时请求外部图标 CDN。
- 展示顺序是自定义图片 → 已配置的 Lucide 基础图标 → 统一空白占位。未知应用不根据名称猜测图标。占位图片本身失败后仍显示无文字的 CSS 空白底板，避免断图标记和重复请求。
- 基础图标统一使用 64px 画布、15px 圆角、同色微渐变、细内沿和 1.8px 线宽。内置立体图片保持统一留白和柔和上左光源。
- `shellIcons` 定义启动器、回收站、占位以及资源管理预备图标，仅提供视觉资产，不注册或授权应用。

`manifest.json` 和基础 SVG 均为派生文件，不手工编辑。修改公共目录后执行：

```powershell
node scripts/build-application-icons.mjs <lucide-static-1.43.0.tgz 路径>
```

`ApplicationIcon.vue` 在桌面、Dock、应用目录中复用。既有 PNG 保留作历史资源，只有声明的图片覆盖会生效。Lucide 许可证完整保留于 `LICENSE-lucide.txt`，官方来源为 https://github.com/lucide-icons/lucide 。生成图片的提示词、来源和资产清单见 `generation-prompts.json`。
