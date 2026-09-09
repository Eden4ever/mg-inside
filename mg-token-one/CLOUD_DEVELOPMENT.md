# Codex 云端开发

## 接入

将本项目连接到 GitHub 私有仓库，然后在 Codex 云端创建对应仓库的环境。运行环境选择 Node.js 22 或更高版本。

安装脚本填写：

```bash
bash cloud/setup.sh && bash cloud/check.sh
```

任务中执行构建与独立测试：

```bash
bash cloud/check.sh
```

## 项目目录

- `mg-gateway/apps/web`：Vue 3、Element Plus 前端。
- `mg-gateway/apps/gateway`：NestJS 后端。
- `scripts/codex-gpt6-setup.*`：当前前端构建依赖的公共脚本源文件。

两个登录入口 `/login` 和 `/admin` 共用 `mg-gateway/apps/web/src/views/Login.vue`。登录页已参照 `iam-admin-ui-prototype` 原型改为简洁白色风格（MG 设计令牌、顶部标签表单、内联错误提示），认证与管理员权限校验逻辑保持不变。

字体与该原型一致：自托管阿里巴巴普惠体三个字重（400/500/600）与钉钉进步体，家族名 `mg-font-alinormal` / `mg-font-ding`，分别由 `--mg-font-family` 与 `--mg-font-family-brand` 消费。产物在 `mg-gateway/apps/web/public/fonts/`，由 `index.html` 直接 `<link>` 引入：正文字体按 `unicode-range` 分包（浏览器只下载页面实际用到的分包，字形覆盖与原字体一致），品牌字体子集化到 ASCII。生成方式与约束见 `mg-gateway/apps/web/FONTS.md`。

## 数据与发布

首批仅迁移应用源码、依赖锁文件和云端开发入口。根目录历史运维脚本、生产备份、环境变量文件和本地凭据不进入仓库。不要通过强制添加绕过忽略规则。

基础构建和独立测试不需要生产配置。数据库集成测试及完整登录调试需要另行配置隔离的测试数据库和测试认证服务。

生产服务仍位于现有腾讯云服务器。当前生产发布工具保留在本地，云端环境不配置生产 SSH 凭据。

## 当前进度

源码已上传到 GitHub 私有仓库 https://github.com/Eden4ever/mg-token-one 。本地前端类型检查、前后端构建和 224 项后端独立测试通过。Codex 云端环境已创建并验证：Node.js 22，前端类型检查、前后端构建及 224 项独立测试全部通过。环境地址：https://chatgpt.com/codex/cloud/settings/environment/6a9c29446ef881918c971ddace8ac5b6 。维护脚本为 bash cloud/setup.sh，缓存开启，任务阶段网络访问关闭。
