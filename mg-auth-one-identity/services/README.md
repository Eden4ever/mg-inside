# 身份资料服务

`identity.api 1.1.0` 为已有 `GET /api/auth/me` 提供 OpenAPI 3.1.1 契约。`registration.json` 包含不可变清单和契约，交由服务管理校验、登记和启用；历史 1.0.0 不覆盖。

提供方读取当前会话本人资料，无目标用户参数；有效中心会话可读取基础身份资料。当前身份管理统一出口仍保留 `identity` 应用授权与平台管理员角色要求。`identityAuthorized` 只表示应用有效授权，管理权限还需当前角色。响应角色实时派生，不信任历史角色列或客户端传入角色。

CSRF 字段属于当前会话防护数据，不提供真实示例，不写入日志或公共缓存。契约关闭未声明响应字段，排除密码、会话令牌、会话 ID、MFA 凭据和其他账户资料。生产入口沿用 `Cache-Control: no-store`。

验证命令（项目根目录）：

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.json
node --test test/service-contract.integration.test.mjs
```

综合测试要求桌面本地身份测试 PostgreSQL（127.0.0.1:15439 / identity_test）。仅从本地私密环境文件读取连接配置，创建唯一 `identity_contract_*` Schema，结束删除该 Schema。实际运行 Nest 控制器、会话 Guard、密码登录和数据库，覆盖双账户、Cookie/Bearer、无效 Bearer 不回退 Cookie、角色与授权撤销、过期/撤销/安全版本/停用，以及响应字段边界。测试不启动 OIDC 提供方、企业微信或禅道登录，也不据此宣称这些链路完成回归。

前端已使用公共壳、公共字体和页面标题，本契约批次不改变身份业务代码或管理导航。
