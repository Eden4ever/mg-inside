# 服务契约

本批 `1.1.0` 清单与 OpenAPI 已在正式服务管理登记、启用。`manifest.json` 是操作索引，`openapi.json` 是完整参数/请求/响应契约，`registration.json` 是两者的登记包。此版本补齐接口描述，现有 API 路由与数据权限不变。

更新契约时需同步三个文件及公共服务目录，增加版本号后通过服务管理登记，审阅差异再启用。不可覆盖同一版本。维护脚本位于桌面项目 `scripts/write-provider-contracts.py`、`scripts/sync-provider-contracts.mjs`；后者只同步源码，不更改生产启用状态。

验收在桌面 `apps/server/src/service-contracts.test.ts` 中使用真实提供方 HTTP 服务进行，文件权限始终按当前账户校验；正式只读调用与持久化契约摘要均已核验。
