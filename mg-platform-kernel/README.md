# MG 平台内核

独立 Java 后端项目，替代 `mg-desktop-one` 的 Node 平台后端。桌面前端保留在 `mg-desktop-one`，公共前端保留在 `mg-platform`，其他应用后端语言不受限制。

## 当前状态

正在迁移，尚未切换现有服务。已实现身份协议客户端、登录流程 Cookie 兼容、应用目录、个人外链、偏好、通知、Spring Cloud Gateway 应用代理，以及服务目录、OpenAPI 结构校验、版本启停、生命周期、审计、调用记录和统一服务出口。

服务目录支持本地 JSON 联调和 PostgreSQL 多实例运行。数据库模式提供全局事务锁、乐观修订、跨环境管理、受控部署绑定、部署漂移阻断和只读快照降级。精确的契约向前／向后兼容比较、真实业务服务与浏览器验收和正式入口切换仍需完成。

采用 Java 25、Spring Boot 4.1.1、Spring Cloud 2025.1.3。依赖由 Spring BOM 管理，不要求 K8s。

## 构建

应用注册已改为数据库唯一来源，首次启动前必须显式迁移。清单格式、升级方式及验证入口见 [应用注册唯一来源](docs/application-registration.md)。

安装 Java 25 后，在本项目目录运行 `./mvnw.cmd verify`（Linux 使用 `./mvnw verify`）。Maven Wrapper 固定 Maven 3.9.16。Windows 便携工具链可使用：

```powershell
./scripts/setup-java.ps1
./scripts/java-maven.ps1 verify
```

运行配置延续旧后端的环境变量；本地默认 `HOST=127.0.0.1`、`PORT=4300`。迁移测试必须使用独立 `DESKTOP_RUNTIME_DIR` 和端口，禁止新旧服务同时写入同一目录。

`DESKTOP_CONFIG_FILE` 默认读取同级 `mg-platform/packages/frontend/config/application-catalog.json`；`DESKTOP_WEB_DIR` 默认读取同级 `mg-desktop-one/dist/web`。生产发布需要显式挂载配置与静态文件，不依赖开发目录布局。

## 一次性数据迁移

仅当目标仍使用 JSON 目录时，停止旧 Node 平台写入后，将旧运行目录中的 `services/registry.json` 复制为迁移输入。已经使用 PostgreSQL 服务目录的环境无需再次导入，Java 直接复用现有表与数据。数据库连接和目标环境只通过私密环境变量提供：

```powershell
$env:SERVICE_DATABASE_URL = 'jdbc:postgresql://database.example/mg_services'
$env:SERVICE_ENVIRONMENT = 'production'
$env:DESKTOP_CONFIG_FILE = 'C:\mg\config\application-catalog.json'
java -jar .\target\mg-platform-kernel-0.1.0-SNAPSHOT.jar service-storage migrate C:\backup\registry.json
```

`migrate` 一次完成幂等建表、历史数据导入和数据库读回摘要校验。同一输入可安全重试，目标环境已有不同迁移摘要时会拒绝覆盖。切换后如需保全新增数据，可执行：

```powershell
java -jar .\target\mg-platform-kernel-0.1.0-SNAPSHOT.jar service-storage export C:\backup\registry-after-cutover.json
```

运行 Java 服务时继续设置 `SERVICE_DATABASE_URL`、`SERVICE_ENVIRONMENT`；设置 `SERVICE_DEPLOYMENTS_FILE` 后，服务出口只接受该受控文件中的部署地址和摘要。K8s 不是运行前提。

## 兼容验证

在桌面项目执行 `node scripts/verify-java-platform.mjs` 或 `npm run test:applications`，启动隔离 PostgreSQL、真实 Node 与 Java 后端，使用身份／业务 HTTP 替身进行接口与数据对照。Java 先显式导入注册项与服务快照，保留原会话、用户状态、应用代理、下载和流式验证；额外覆盖动态应用注册、停用与失权恢复。这些测试不代表真实身份、全部业务应用和生产交互已经完成验收。

迁移清单和最新验证证据见 [迁移进度](docs/migration-progress.md)。
