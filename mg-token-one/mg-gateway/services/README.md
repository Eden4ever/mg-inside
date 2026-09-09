# 模型目录服务契约

`token-one.api 1.2.0` 已于 2026-09-09 正式登记启用。1.1.0 已发布且不可覆盖，因此本次以新版本增加 OpenAPI。`manifest.json` 为操作索引，`openapi.json` 为参数/响应契约，`registration.json` 为完整登记包。

- `/portal/models`：当前用户可见的启用模型。管理员可见全部，普通用户按当前分组与模型分组交集过滤；没有用户分组时使用 default。读取当前本地角色与分组，不能靠客户端提交角色扩大范围。
- `/public/models`：提供方允许匿名读取的启用模型能力目录。公开字段不包含分组、备注、视觉说明、价格、渠道绑定或上游模型信息。通过桌面统一出口仍需平台会话及对应应用授权；文档入口的独立权限保持现有边界。

目录能力来自模型配置，不保证路由实时健康、账户额度或推理令牌权限。本批不公开收费推理、渠道管理、运维或回调接口。错误同时描述网关 `{error:{message,status_code}}` 和桌面出口 `{message}` 两种响应。

验证：`apps/gateway/test/service-contract.spec.ts` 使用实际 Nest HTTP 控制器、统一身份 Guard、身份投影和分组服务，覆盖两个目录、两普通账户、管理员降权、分组变更、撤销、身份服务不可用及公开字段排除；测试中的身份内省和仓储使用受控替身，不代表完整 MySQL 回归。`application-audience.spec.ts` 验证三个入口独立授权及伪造 audience 无效。桌面 `scripts/verify-token-public-contract.mjs` 验证生产公开目录实际 JSON，发布时 14 个模型均符合契约。

发布：桌面核心 `20260908T191600Z`，Token 静态前端 `20260908T191620Z`。正式两个统一出口调用成功，持久化摘要与源码一致；门户、控制台、文档页面及公共标题已核验。Token 保持现有服务器 `1.12.253.86` 和网关镜像 `mg-gateway:20260908T124729Z`。

生成与同步：桌面 `scripts/write-token-contract.py`、`scripts/sync-provider-contracts.mjs`。前端使用 `scripts/build-token-release.ps1`，后续静态更新使用 `deploy/release-token-static.py`，不要重新执行首次 Nginx 改造脚本。
