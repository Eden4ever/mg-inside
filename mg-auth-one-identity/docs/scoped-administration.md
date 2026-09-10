# 行政区划、组织机构与范围应用权限

用户可以关联多个组织机构，并指定一个主机构；原部门文字字段保留。行政区划支持上下级关系，组织机构属于区划。托管和挂牌关系不会扩大管理员权限。

## 配置顺序

1. 平台管理员建立区划、组织机构，并在员工身份中关联用户及主机构。
2. 给管理人员分配内置“行政区划管理员”或“组织机构管理员”角色，同时显式授予“统一身份认证”应用访问权。
3. 从区划或机构的“应用权限”进入范围配置，指定管理员和可配置应用。
4. 范围管理员进入“范围应用权限”，为范围内成员开关清单内应用。

区划范围覆盖该区划及下级区划的机构成员；机构范围仅覆盖指定机构。两个内置角色不能改名、删除或通过角色应用授权获得全局管理权限。范围管理员不能修改范围配置或访问全局用户、角色管理接口。

撤销管理员角色或范围指派后立即失去对应管理能力。移除范围应用会删除该范围授予的许可；成员离开机构后清理失效许可。用户直接授权、普通角色授权和其他有效范围授权保持独立，撤销一个来源不会覆盖其他来源。

统一令牌的 `authorizationSources` 保留既有 user/role 类型；范围来源位于新增 `scopeAuthorizationSources`。应用有效状态由全部有效来源计算。桌面入口通过通用 `runtimePolicy.rolePointer=/user/managementRole` 与 `requiredRole=identity-manager` 检查，未将范围管理员提升为 `system_admin`。

## 本机运行

桌面为 http://127.0.0.1:4301，内核为 4300，认证服务为 14200。身份数据保留在原隔离 schema，服务目录使用本机 `mg_service_workspace_local` 数据库。

`node scripts/local-scopes-runtime.mjs configure` 生成桌面私密运行配置；桌面项目的 `npm run dev:server` 会读取该配置和已验证的独立 Java 构建。可用 `DESKTOP_JAR` 指定其他已构建的包。运行中的 JAR 不应原地覆盖。

`node scripts/activate-local-identity-services.mjs --activate` 通过管理员登录、CSRF 和修订号校验启用认证中心管理/本人服务，以及个人中心原有本人服务。它保留既有登记版本并记录服务目录审计；不启用协议、探针或静态资源目录项。服务清单目前没有完整 OpenAPI 契约，不能据此声称契约文档已补齐。

## 验收

- `node --test test/organization.integration.test.mjs`：独立 PostgreSQL schema、组织/区划 API、权限、范围撤权、桌面与移动端页面。
- `node --test test/scoped-desktop.integration.test.mjs`：本机 4300 桌面真实登录，两种范围管理员授权与撤权；测试资料在 finally 中清理。
- `node scripts/activate-local-identity-services.mjs`：10 个认证中心读接口及桌面应用会话入口检查。
- `node scripts/verify-local-identity.mjs`：实际嵌入页搜索、返回概览、关闭窗口，无未保存误报。
- `node scripts/verify-web-bases.mjs`：根路径和桌面子路径构建及关闭保护验证。

搜索、筛选不再触发全局表单脏状态；真实编辑弹窗和范围配置、邮件配置中的未保存内容仍受关闭保护。

本轮只切换本机实例，未发布生产。文件、知识库和 Token 的原有本机上游异常不属于本轮认证中心验收，不代表整个桌面所有业务应用均已恢复。
