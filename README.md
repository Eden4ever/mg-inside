# MG Inside

MG 统一桌面、公共应用壳及全部配套应用的私有源码仓库。首次提交于 2026-09-09，导入当前开发工作区的源码快照，保留同级项目引用关系。原身份、Token、知识库仓库的本地目录与 Git 历史仍保留；本仓库从一次完整源码提交开始。

## 项目

| 目录 | 职责 |
| --- | --- |
| mg-platform | 公共壳、导航、页面规范、会话客户端、桌面协议和服务契约 |
| mg-desktop-one | 桌面、窗口、应用目录、统一服务出口与治理后台 |
| mg-service-one | 服务登记、环境发布、契约差异和生命周期界面 |
| mg-resource-one | 资源池、服务器与部署状态 |
| mg-files-one | 账户文件、目录、回收站及 Office 后端 |
| mg-office-one | 在线文档、表格和演示文稿 |
| mg-personal-one | 个人资料、安全与桌面偏好 |
| mg-app-manager-one | 应用目录、当前应用版本与个人外链应用 |
| mg-auth-one-identity | 统一身份、授权与会话 |
| mg-expert-database | 指标知识库 |
| mg-token-one | Token 门户、控制台、文档和模型网关 |

## 开发与验证

保留上述目录名及相对位置。应用使用 Vite alias 和 TypeScript 相对路径引用 `mg-platform`，部分服务测试还直接导入其他应用源码。不要只检出某个应用后单独更改目录层级。

使用 Node.js 22.19 或更新版本，各应用按自己的 package.json 与锁文件安装；知识库使用 pnpm 工作区，其他应用主要使用 npm。`mg-token-one/mg-gateway/apps/gateway` 与 `apps/web` 是独立安装入口，统一身份的 `web` 也需要单独安装。运行配置从各项目示例文件建立，实际环境文件、身份凭据、业务数据库、构建包与运行数据不在仓库中。

桌面相关验证在 `mg-desktop-one` 中执行：

```sh
npm ci
npm test
npm run typecheck
npm run test:contract-http
```

测试前还需安装被导入的文件、资源等项目依赖，详见各项目 README。独立数据库、真实身份和 Office 引擎回归需要另行配置测试服务；上述命令不代表所有业务集成测试。

## 当前交付状态

桌面与相关服务部署记录见 `mg-desktop-one/deploy/`。本次包含公共壳返回桌面、应用版本展示、Office 中文字体安装支持及 Token 桌面嵌入空白修复。最新服务治理版本为 `20260909T023424Z`：基本请求/响应兼容推导、差异字段定位和发布保护已上线，60 项桌面测试、类型检查、服务管理构建及隔离 HTTP 发布测试通过。

复杂 Schema 兼容推导、健康过期、依赖关系、机器身份、细粒度授权及剩余公共能力仍在推进。完整范围和证据见 `mg-desktop-one/docs/service-goal-audit.md`，不会以本次提交代表所有规划完成。

首次快照不包含旧 Token 根目录一次性诊断脚本、人工账号种子、历史发布副本及机器配置。`SOURCE_SNAPSHOT.json` 保存纳入的项目与源文件摘要，Git 提交记录是此仓库内容的权威版本。

Token 本地 MySQL 启动需要通过环境变量提供 `DB_PASSWORD`，例如在 `mg-token-one/mg-gateway` 使用 `docker compose --env-file apps/gateway/.env up -d mysql`。开发 Compose 不再写死密码；发布包检查从本机配置与环境读取待排除的机密，相关 22 项 Python 回归通过。
