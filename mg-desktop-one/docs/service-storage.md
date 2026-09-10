# 服务管理独立存储

2026-09-09，正式批次 `20260908T195300Z`。服务目录已从桌面单进程 JSON 迁至独立 PostgreSQL 数据库 `mg_services`，运行账号 `registry_app`。数据库位于新机 `43.139.78.226` 的专用容器 `mg-service-registry-db-1`，只映射 `127.0.0.1:15440`；与身份、文件和其他业务存储分开。

## 模型和并发

`service_publications` 保存不可变清单、契约、摘要和登记身份；运行账号仅能读取、插入，不能更新或删除版本。`service_bindings` 按环境保存启用版本与修订号，引用已有版本。`service_audit` 与 `service_activity` 按环境追加，界面分别展示最近 500/300 条，数据库保留更多历史。

所有版本及状态写入在同一数据库连接的事务中重新读取已提交状态，并通过事务锁协调多个实例。旧页面修订号仍会被拒绝；事务失败不改变内存路由。读取用单个查询获得一致快照，接口文档按已验证的内容摘要复用校验结果，读取时仍核对实际内容摘要。

实现依据：[node-postgres 事务说明](https://node-postgres.com/features/transactions)、[PostgreSQL 显式锁说明](https://www.postgresql.org/docs/17/explicit-locking.html)。

## 环境和故障行为

运行配置来自独立私密 `services.env`：`SERVICE_DATABASE_URL` 与必填的 `SERVICE_ENVIRONMENT`。当前正式环境是 `production`；测试已证明同库 `testing` 的启用版本、修订与活动记录独立。浏览器不能通过调用参数切换运行环境，服务地址继续来自受控应用配置，不能用契约里的 URL 改写。

这只是环境数据基础。跨环境发布界面、`endpointRef` 与部署实例关联、目标环境的授权及版本发布校验仍待下一批；不能把环境列和页面标签当成完整环境治理。

已确认并校验的目录保存到 `postgres-snapshot-{环境}.json`。运行时目录读取最多复用一秒缓存；数据库失败时，业务调用使用最后确认快照，并返回 `X-Service-Catalog: cached`。每次调用仍执行当前会话、应用授权、角色及 CSRF 校验。无有效快照时不会自行初始化或猜测路由；有快照时支持断库重启。

服务管理查询和写入仍要求数据库可用，失败返回 503。断库期间跳过调用记录落盘，避免失败队列阻塞业务；这段调用记录可能缺失，不能据此推断真实调用次数或上游健康。数据库恢复后重新读取最新目录。快照写盘失败不会把已提交的数据库写入错误报告为失败；日志会提示快照未持久化。

目录存储支持多实例并发，不代表桌面所有组件已经支持多副本；个人外链、通知等原有存储还需各自验证。

## 构建与验证

```powershell
npm test
npm run build
npm run test:storage
./scripts/build-service-manager-release.ps1
```

`test:storage` 使用项目 `.runtime` 下由 Windows 原生 PostgreSQL 16 运行的隔离实例（`127.0.0.1:15439`）创建唯一 `services_verify_*` 数据库与受限账号，并运行构建后的桌面 HTTP 进程。它不依赖 Docker，也不连接生产库；读取私密配置而不输出凭据。测试覆盖 JSON 全量导入、重复/冲突导入、两个实例并发登记与切换、环境隔离、禁止修改旧版本、实际断开数据库连接、管理 503、文件出口快照调用、匿名/方法拒绝、恢复及导出回原 JSON 引擎。临时进程、数据库和账号在结束时清理。

服务端由 `scripts/build-server.mjs` 打包，包括 PostgreSQL JavaScript 驱动；同时输出 `service-storage-admin.mjs`。生产不临时安装依赖。管理工具从私密环境文件读取连接，提供 `install`、`import 文件`、`verify 文件`、`export 新文件`。导入只允许空环境或同来源摘要的幂等重试；导出拒绝覆盖已有文件。

## 正式迁移、备份与回退

首次准备使用 `deploy/prepare-service-database.py`，以服务器已存在的 PostgreSQL 17 镜像摘要创建独立容器，512 MiB 内存上限；生成分开的管理和运行账号配置。首次切换使用 `deploy/release-service-storage.py`：完成构建和建表后短暂停止桌面，复制最终 JSON，导入并逐项摘要核验，运行新镜像并等待健康检查后切换 current。

本次原始快照、前一镜像和验证记录位于 `/opt/mg-desktop/backups/service-storage-20260908T195300Z`。迁移保留 13 个版本、6 个启用状态和全部原有记录。正式六服务只读调用均成功，新调用已写入数据库。

`services.dump` 为迁移后自定义格式备份，SHA-256：`d6c61b3a9465fe6e57251db14547f9db47fcf4bcac5baaa9951ae6e63088810b`。`verify-service-database-backup.py` 已实际恢复到唯一临时数据库，验证历史版本和记录仍在，然后删除临时数据库；未覆盖生产库。后续通用 `release-service-governance.py` 在发布前额外备份真实数据库为 `services.sql.gz`，旧 JSON 不再被当作当前数据源。

回退首迁移可在目标仍为此批次时运行 `rollback-service-storage.py 20260908T195300Z`。它先停止新实例、从最新数据库导出，再原子替换旧 JSON 并启动前一镜像；保留数据库和所有备份。如果数据库无法导出，则拒绝用旧快照覆盖，继续新程序等待数据库恢复。数据导出回原引擎已在独立测试库验证；本批未在生产执行程序回退。

首迁移核验命令：`python -X utf8 scripts/verify-service-storage-deployment.py`、`python -X utf8 scripts/verify-contract-deployment.py`。前者针对 195300 批次迁移基线，后续有意变化的修订号不再适用；后者在数据库模式直接核验 PostgreSQL 中的契约及启用状态。

## 后续环境绑定升级

20260908T203920Z 增加部署实例绑定五列与受限账号相应列级 UPDATE 权限，未改写历史契约。当前六服务的绑定修订分别增加一次；完全相同的页面重复发布不再增加修订。运行目录 `/opt/mg-desktop/config` 由 root 控制，以只读方式挂载；后续完整发布也要保留该挂载。配置更新和启用共用数据库锁，并在锁内重读配置以拒绝过期部署选择。

新增管理命令 `environment`、`bind/verify-bindings <配置>`、`validate-deployments <配置>`、`publish-deployments <新配置> <当前配置> <原始摘要>`；运行角色不能执行建表或受控文件发布。正式核验改用 `verify-service-bindings-deployment.py <发布号>` 对照本批首次绑定基线。流程、回退边界及未完成的持续健康观测见 [service-environments.md](service-environments.md)。

生命周期批次新增全局 `service_version_lifecycles` 表，保存与不可变清单分离的版本状态。事务锁内读取所有环境的绑定，防止发布与退役竞争；导入旧快照也不能重新绑定已有弃用/退役状态。生命周期审计由所有环境共享读取。已写入生命周期后不能直接回退到忽略这些字段的旧程序；详细规则见 [service-lifecycle.md](service-lifecycle.md)。
