# 公共应用图标资源

应用图标统一由 `mg-platform/packages/frontend/config/application-catalog.json` 声明，由 `mg-platform/packages/frontend/assets/app-icons` 提供本地资源。当前采用统一立体应用图片，Lucide 基础图标与空白占位负责回退。

桌面和应用目录共同使用公共 `ApplicationIcon`；应用自身 Vite 构建打包资源，不依赖桌面 `/app-icons` 路径。旧 PNG 保留但不作为默认图标源。
