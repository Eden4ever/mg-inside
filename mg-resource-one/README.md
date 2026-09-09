# 资源管理

2026-09-09 已接入真实统一认证和桌面并部署至 `43.139.78.226`。两台服务器实时采集、生产 SSO 与桌面页面已验证；迁移后的部署关系已更新。云 API 和到期提醒仍待后续接入。

应用 ID 为 `resource-manager`，使用平台 JSON 标准壳，独立浏览器和桌面嵌入共用页面。系统应用必须获得用户或平台角色授权，不能登记为默认应用。

## 第一版能力

- 资源池、服务器、应用部署、采集记录四个页面，名称和线型导航图标由 `application.json` 配置。
- 首批两台服务器采用固定 UUID。`server/resources.json` 存放目标与部署关系，不接受浏览器提交主机地址、凭据路径或命令。
- SSH 实时采集 CPU 核数、系统、负载、可用内存、根盘空间、容器状态／镜像、指标知识库 systemd 状态与发布路径。
- 每 60 秒采集；手动采集同一资源去重；失败保留成功快照，超过 5 分钟标记过期。SSH 与云 API 连接状态分开。
- 可编辑负责人、标签、备注和已定义资源池归属；记录操作者与结果。单服务进程持有 JSON 存储，原子更新并保留最近 1000 条审计记录。
- 不提供任意 shell、重启、删除云资源或自动部署。腾讯云 API 凭据尚未接入，产品类型、地域、实例 ID、到期时间明确待补齐；不能凭 IP 推断产品。

## 本地开发

要求 Node.js 22.7+（已用 24.20.0 验证），系统 SSH 客户端。

```powershell
npm install
npm run dev
node --env-file=.runtime/resource.env --experimental-transform-types server/main.ts
npm run build
npm test
```

前端默认 `14371`，后端默认 `14370`。通过桌面代理访问后端，不给浏览器下发统一用户令牌或采集私钥。

桌面注册项：`entryUrl=http://127.0.0.1:14371`、`upstream=http://127.0.0.1:14370/api`、`allowedApiPaths=['/overview','/resources']`、`defaultPath='/pools'`、`allowedPaths=['/pools','/servers','/deployments','/audit']`。生产前端为 `/apps/resource-manager/`，分类为系统应用。

统一认证需配置独立 `resource-manager` 服务客户端和同 ID 的 Application。每个 API 请求都调用统一认证 introspect 并检查 `resource-manager` 受众，修改请求还检查统一会话 CSRF。授权由平台角色或用户管理；应用名称不参与鉴权。不能使用前端隐藏按钮替代后端授权。

## 受限采集凭据

`scripts/install-collectors.mjs` 是一次性管理员安装脚本，使用现有 SSH Agent 安装公钥，不读取或导出原 root 私钥。仅在已授权的两个固定目标上新建 `mg-resource` 账户，安装根用户拥有的 `/usr/local/sbin/mg-resource-collect`，并配置 sudo 仅可执行这个不接受参数的白名单命令。

专用 Ed25519 私钥保存在 `.runtime/credentials/{platform,knowledge}`，Windows ACL 限制当前用户，Linux 文件模式为 600。`known_hosts` 从已信任的 SSH 主机记录提取，不关闭主机指纹验证。公钥使用 `restrict,command=...`，任意请求均强制运行固定采集，禁止端口转发、代理转发和 PTY。采集脚本不读取业务数据库、容器环境变量、认证配置或业务内容。

轮换时先生成新的专用密钥，按服务器公钥替换，再验证固定采集和转发限制，最后撤销旧密钥。删除对应公钥即可撤销采集权限。不得将凭据目录加入 release 源码包、前端静态包或日志。

## 生产部署

1. 先登记统一认证服务客户端及应用授权，独立 secret 由身份服务签发，写入 `/opt/mg-resource/shared/resource.env`（root:root、600）。内容见 `.env.example`。
2. 构建前端：`VITE_APP_BASE=/apps/resource-manager/`、`VITE_DESKTOP_ORIGIN=https://desktop.meta-gravity.com`，将 `dist/` 交桌面静态发布流水线。不要整体覆盖现有其他应用的静态目录。
3. 将 `server/` 上传到 `/opt/mg-resource/releases/<version>/server/`。后端仅依赖 Node 内置模块，无需打包 node_modules。
4. 通过现有 SSH 的加密传输，单独上传专用私钥和已固定指纹的 known_hosts 至 `/opt/mg-resource/shared/credentials/`。不通过源码归档中转私钥。
5. 运行 `bash scripts/install-service.sh /opt/mg-resource/releases/<version>`；脚本只更新新建的 `mg-resource-one.service`，以独立非 root 账户运行、256 MB 上限、只读系统目录和独立可写数据目录，不改动业务服务。失败恢复原资源服务版本。
6. 桌面代理 upstream 若运行在容器中，不能指向该容器自己的 localhost。将资源服务接入经过限制的容器网络或由现有内网代理转发到宿主回环端口，保持外网不直接暴露 14370。由统一发布任务按现有网络拓扑接入。
7. 验收真实 SSO 有权／无权访问、生产页面、手动刷新、快照时间、两台采集、失败保留数据，再将桌面目录入口开放给已授权用户。

`/health` 仅证明进程可用，不证明 SSH 或统一认证已联通。必须验证授权后的 `/api/overview` 与新采集时间。

## 已完成验证与待完成事项

- 已在两台真实服务器安装专用采集器并验证：任意 shell 请求只返回固定 JSON；端口转发被服务器拒绝。
- 已实际读取平台容器与指标知识库 `mg-expert-database-api` 运行状态。首次发现规划中的 `mgexpert` 是运行账户，不是 systemd 单元名，已按真实服务名更正。
- 3 组后端测试覆盖：无认证／无权限拒绝、受众检查、CSRF、没有任意命令接口、持久化、采集去重、错误不泄漏诊断信息、失败保留快照、无效指标拒绝。
- 前端构建通过；Chrome 宽屏／窄屏、资源详情和资料编辑取消通过，运行时异常与水平溢出均为 0。UI 测试使用真实 SSH 快照并拦截传输，不将其称为真实生产 SSO 验证。
- 2026-09-09 已完成真实身份客户端、桌面注册、生产网络／静态发布与登录验收；新主机生产资源池显示两台 SSH 连接正常，并验证手动采集。腾讯云只读账户未配置，因此云 API 同步与到期提醒尚未实现。自动部署与开发者中心不在首版实现范围。

架构规划见 `../mg-platform/docs/resource-management-plan.md`。开源复用候选为腾讯云官方 Node.js SDK；规模扩大后评估蓝鲸 CMDB 或 JumpServer，首版不为两台机器额外引入完整 CMDB／堡垒机。
