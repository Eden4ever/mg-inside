# API 全量登记与分类

登记包由 `node scripts/build-api-inventory.mjs` 生成，使用 `--check` 校验源码漂移。运行时只读取服务库，不从此文件或源码扫描回退。

共 321 条入口，7 个提供方。类别与认证边界分别保存；页面/资源单独统计，避免将页面数算作业务 API 数。

| 类别 | 数量 |
| --- | ---: |
| 系统服务 | 145 |
| 应用服务 | 15 |
| 数据服务 | 80 |
| 组件服务 | 8 |
| 引擎服务 | 73 |

| 边界 | 数量 |
| --- | ---: |
| 业务接口 | 63 |
| 管理接口 | 99 |
| 本人账号 | 44 |
| 身份协议 | 61 |
| 机器集成 | 3 |
| 外部开放协议 | 4 |
| 平台控制面 | 28 |
| 健康探针 | 7 |
| 页面与静态资源 | 12 |

| 提供方 | 类别 | 领域 | 认证边界 | 方法与路径 |
| --- | --- | --- | --- | --- |
| expert-database | 数据服务 | 账号安全 | 本人账号 | GET /api/account-security |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/authorize |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/authorize/email |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/authorize/key |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/email/confirm |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/email/remove |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/email/start |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/key/confirm |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/key/remove |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/key/start |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/mfa |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/totp/confirm |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/totp/remove |
| expert-database | 数据服务 | 账号安全 | 本人账号 | POST /api/account-security/totp/start |
| expert-database | 数据服务 | 本人会话 | 本人账号 | POST /api/auth/change-password |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | POST /api/auth/login |
| expert-database | 数据服务 | 本人会话 | 本人账号 | POST /api/auth/logout |
| expert-database | 数据服务 | 本人会话 | 本人账号 | GET /api/auth/me |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | POST /api/auth/mfa |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | POST /api/auth/mfa/email |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | POST /api/auth/mfa/key |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | GET /api/auth/pending |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | POST /api/auth/setup |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | GET /api/auth/sso/callback |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | GET /api/auth/sso/start |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | GET /api/auth/sso/status |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | GET /api/auth/wecom/callback |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | POST /api/auth/wecom/start |
| expert-database | 数据服务 | 登录与 MFA | 身份协议 | GET /api/auth/wecom/status |
| expert-database | 数据服务 | 运行健康 | 健康探针 | GET /api/health |
| expert-database | 数据服务 | 指标版本 | 业务接口 | GET /api/indicator-versions/{versionId} |
| expert-database | 数据服务 | 指标版本 | 业务接口 | GET /api/indicator-versions/{versionId}/audit-logs |
| expert-database | 数据服务 | 指标版本 | 业务接口 | POST /api/indicator-versions/{versionId}/clone |
| expert-database | 数据服务 | 指标版本 | 业务接口 | POST /api/indicator-versions/{versionId}/import |
| expert-database | 数据服务 | 指标版本 | 业务接口 | POST /api/indicator-versions/{versionId}/import/preflight |
| expert-database | 数据服务 | 指标版本 | 业务接口 | GET /api/indicator-versions/{versionId}/indicators/{nodeId}/evidence |
| expert-database | 数据服务 | 指标版本 | 业务接口 | DELETE /api/indicator-versions/{versionId}/indicators/{nodeId}/evidence/{evidenceId} |
| expert-database | 数据服务 | 指标版本 | 业务接口 | PUT /api/indicator-versions/{versionId}/indicators/{nodeId}/evidence/{evidenceId} |
| expert-database | 数据服务 | 指标版本 | 业务接口 | PATCH /api/indicator-versions/{versionId}/indicators/{nodeId}/modules/{moduleKey} |
| expert-database | 数据服务 | 指标版本 | 业务接口 | POST /api/indicator-versions/{versionId}/indicators/{nodeId}/modules/{moduleKey}/evidence |
| expert-database | 数据服务 | 指标版本 | 业务接口 | GET /api/indicator-versions/{versionId}/indicators/{nodeId}/revisions |
| expert-database | 数据服务 | 指标版本 | 业务接口 | PATCH /api/indicator-versions/{versionId}/indicators/{nodeId}/summary |
| expert-database | 数据服务 | 指标版本 | 业务接口 | GET /api/indicator-versions/{versionId}/indicators/{nodeId}/workspace |
| expert-database | 数据服务 | 指标版本 | 业务接口 | POST /api/indicator-versions/{versionId}/nodes |
| expert-database | 数据服务 | 指标版本 | 业务接口 | DELETE /api/indicator-versions/{versionId}/nodes/{nodeId} |
| expert-database | 数据服务 | 指标版本 | 业务接口 | PATCH /api/indicator-versions/{versionId}/nodes/{nodeId} |
| expert-database | 数据服务 | 指标版本 | 业务接口 | POST /api/indicator-versions/{versionId}/nodes/reorder |
| expert-database | 数据服务 | 指标版本 | 业务接口 | GET /api/indicator-versions/{versionId}/tree |
| expert-database | 数据服务 | 邮件配置 | 管理接口 | GET /api/mail-settings |
| expert-database | 数据服务 | 邮件配置 | 管理接口 | PUT /api/mail-settings |
| expert-database | 数据服务 | 邮件配置 | 管理接口 | POST /api/mail-settings/test |
| expert-database | 数据服务 | 模型配置 | 管理接口 | GET /api/model-management |
| expert-database | 数据服务 | 模型配置 | 管理接口 | PUT /api/model-management |
| expert-database | 数据服务 | 模型配置 | 管理接口 | POST /api/model-management/test |
| expert-database | 数据服务 | 语义库 | 业务接口 | GET /api/semantic-libraries |
| expert-database | 数据服务 | 语义库 | 业务接口 | POST /api/semantic-libraries |
| expert-database | 数据服务 | 语义库 | 业务接口 | DELETE /api/semantic-libraries/{id} |
| expert-database | 数据服务 | 语义库 | 业务接口 | GET /api/semantic-libraries/{id} |
| expert-database | 数据服务 | 语义库 | 业务接口 | POST /api/semantic-libraries/{id}/build |
| expert-database | 数据服务 | 语义库 | 业务接口 | POST /api/semantic-libraries/{id}/search |
| expert-database | 数据服务 | 指标体系 | 业务接口 | GET /api/systems |
| expert-database | 数据服务 | 指标体系 | 业务接口 | POST /api/systems |
| expert-database | 数据服务 | 指标体系 | 业务接口 | DELETE /api/systems/{systemId} |
| expert-database | 数据服务 | 指标体系 | 业务接口 | GET /api/systems/{systemId} |
| expert-database | 数据服务 | 指标体系 | 业务接口 | PATCH /api/systems/{systemId} |
| expert-database | 数据服务 | 指标体系 | 业务接口 | GET /api/systems/{systemId}/access |
| expert-database | 数据服务 | 指标体系 | 业务接口 | DELETE /api/systems/{systemId}/access/{userId} |
| expert-database | 数据服务 | 指标体系 | 业务接口 | PUT /api/systems/{systemId}/access/{userId} |
| expert-database | 数据服务 | 指标体系 | 业务接口 | GET /api/systems/{systemId}/access/researchers |
| expert-database | 数据服务 | 指标体系 | 业务接口 | GET /api/systems/{systemId}/templates |
| expert-database | 数据服务 | 指标体系 | 业务接口 | PUT /api/systems/{systemId}/templates |
| expert-database | 数据服务 | 用户目录 | 管理接口 | GET /api/users |
| expert-database | 数据服务 | 用户目录 | 管理接口 | POST /api/users |
| expert-database | 数据服务 | 用户目录 | 管理接口 | PATCH /api/users/{userId} |
| expert-database | 数据服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/reset-password |
| expert-database | 数据服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/wecom-identities |
| expert-database | 数据服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/wecom-identities/{identityId}/unbind |
| expert-database | 数据服务 | 用户目录 | 管理接口 | GET /api/users/researchers |
| expert-database | 数据服务 | 用户目录 | 管理接口 | POST /api/users/wecom-sync |
| expert-database | 数据服务 | 用户目录 | 管理接口 | GET /api/users/wecom-sync/status |
| files | 应用服务 | 文件管理 | 本人账号 | GET /api/auth/me |
| files | 应用服务 | 文件管理 | 业务接口 | GET /api/desktop |
| files | 应用服务 | 文件管理 | 业务接口 | GET /api/entries |
| files | 应用服务 | 文件管理 | 业务接口 | DELETE /api/entries/{id} |
| files | 应用服务 | 文件管理 | 业务接口 | GET /api/entries/{id} |
| files | 应用服务 | 文件管理 | 业务接口 | PATCH /api/entries/{id} |
| files | 应用服务 | 文件管理 | 业务接口 | POST /api/entries/{id}/access |
| files | 应用服务 | 文件管理 | 业务接口 | GET /api/entries/{id}/content |
| files | 应用服务 | 文件管理 | 业务接口 | POST /api/entries/{id}/move |
| files | 应用服务 | 文件管理 | 业务接口 | DELETE /api/entries/{id}/permanent |
| files | 应用服务 | 文件管理 | 业务接口 | POST /api/entries/{id}/restore |
| files | 应用服务 | 文件管理 | 业务接口 | GET /api/folders |
| files | 应用服务 | 文件管理 | 业务接口 | POST /api/folders |
| files | 组件服务 | Office 文档 | 业务接口 | GET /api/office/documents |
| files | 组件服务 | Office 文档 | 业务接口 | POST /api/office/documents |
| files | 组件服务 | Office 文档 | 业务接口 | POST /api/office/documents/{id}/open |
| files | 组件服务 | Office 文档 | 业务接口 | GET /api/office/sessions/{id} |
| files | 组件服务 | Office 文档 | 业务接口 | POST /api/office/sessions/{id}/save |
| files | 组件服务 | Office 文档 | 业务接口 | GET /api/office/status |
| files | 应用服务 | 文件管理 | 业务接口 | POST /api/uploads |
| files | 应用服务 | 运行健康 | 健康探针 | GET /health |
| files | 组件服务 | Office 集成 | 机器集成 | POST /integrations/office/{id}/callback |
| files | 组件服务 | Office 集成 | 机器集成 | GET /integrations/office/{id}/document |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET / |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /.well-known/oauth-authorization-server |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /.well-known/oauth-authorization-server |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /.well-known/openid-configuration |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /.well-known/openid-configuration |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /access-denied |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /account |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /admin |
| identity | 系统服务 | 账号安全 | 本人账号 | GET /api/account-security |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/authorize |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/authorize/email |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/authorize/key |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/email/confirm |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/email/remove |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/email/start |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/key/confirm |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/key/remove |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/key/start |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/mfa |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/totp/confirm |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/totp/remove |
| identity | 系统服务 | 账号安全 | 本人账号 | POST /api/account-security/totp/start |
| identity | 系统服务 | 应用授权 | 管理接口 | GET /api/applications |
| identity | 系统服务 | 应用授权 | 管理接口 | PUT /api/applications/{clientId}/users/{userId} |
| identity | 系统服务 | 本人会话 | 本人账号 | GET /api/applications/mine |
| identity | 系统服务 | 应用授权 | 管理接口 | GET /api/applications/users/{userId} |
| identity | 系统服务 | 本人会话 | 本人账号 | POST /api/auth/change-password |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/login |
| identity | 系统服务 | 本人会话 | 本人账号 | POST /api/auth/logout |
| identity | 系统服务 | 本人会话 | 本人账号 | GET /api/auth/me |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/mfa |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/mfa/email |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/mfa/key |
| identity | 系统服务 | 登录与 MFA | 身份协议 | GET /api/auth/pending |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/setup |
| identity | 系统服务 | 登录与 MFA | 身份协议 | GET /api/auth/wecom/callback |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/wecom/start |
| identity | 系统服务 | 登录与 MFA | 身份协议 | GET /api/auth/wecom/status |
| identity | 系统服务 | 登录与 MFA | 身份协议 | POST /api/auth/zentao/login |
| identity | 系统服务 | 登录与 MFA | 身份协议 | GET /api/auth/zentao/status |
| identity | 系统服务 | 机器目录同步 | 身份协议 | POST /api/directory/logout |
| identity | 系统服务 | 机器目录同步 | 身份协议 | POST /api/directory/session |
| identity | 系统服务 | 机器目录同步 | 身份协议 | GET /api/directory/users |
| identity | 系统服务 | 行政区划 | 管理接口 | GET /api/divisions |
| identity | 系统服务 | 行政区划 | 管理接口 | POST /api/divisions |
| identity | 系统服务 | 行政区划 | 管理接口 | DELETE /api/divisions/{id} |
| identity | 系统服务 | 行政区划 | 管理接口 | PATCH /api/divisions/{id} |
| identity | 系统服务 | 登录审计 | 管理接口 | GET /api/login-attempts |
| identity | 系统服务 | 邮件配置 | 管理接口 | GET /api/mail-settings |
| identity | 系统服务 | 邮件配置 | 管理接口 | PUT /api/mail-settings |
| identity | 系统服务 | 邮件配置 | 管理接口 | POST /api/mail-settings/test |
| identity | 系统服务 | 组织机构 | 管理接口 | GET /api/organizations |
| identity | 系统服务 | 组织机构 | 管理接口 | POST /api/organizations |
| identity | 系统服务 | 组织机构 | 管理接口 | DELETE /api/organizations/{id} |
| identity | 系统服务 | 组织机构 | 管理接口 | PATCH /api/organizations/{id} |
| identity | 系统服务 | 组织机构 | 管理接口 | GET /api/organizations/{id}/members |
| identity | 系统服务 | 角色权限 | 管理接口 | GET /api/roles |
| identity | 系统服务 | 角色权限 | 管理接口 | POST /api/roles |
| identity | 系统服务 | 角色权限 | 管理接口 | DELETE /api/roles/{roleId} |
| identity | 系统服务 | 角色权限 | 管理接口 | PATCH /api/roles/{roleId} |
| identity | 系统服务 | 角色权限 | 管理接口 | PUT /api/roles/{roleId}/applications/{clientId} |
| identity | 系统服务 | 角色权限 | 管理接口 | PUT /api/roles/{roleId}/members/{userId} |
| identity | 系统服务 | 角色权限 | 管理接口 | PUT /api/roles/users/{userId} |
| identity | 系统服务 | 数据范围 | 管理接口 | GET /api/scopes |
| identity | 系统服务 | 数据范围 | 管理接口 | PUT /api/scopes/{id}/applications/{clientId}/users/{userId} |
| identity | 系统服务 | 数据范围 | 管理接口 | GET /api/scopes/{id}/members |
| identity | 系统服务 | 数据范围 | 管理接口 | PUT /api/scopes/{kind}/{id} |
| identity | 系统服务 | 统一身份协议 | 身份协议 | POST /api/unified/applications |
| identity | 系统服务 | 统一身份协议 | 身份协议 | GET /api/unified/authorize |
| identity | 系统服务 | 统一身份协议 | 身份协议 | POST /api/unified/exchange |
| identity | 系统服务 | 统一身份协议 | 身份协议 | POST /api/unified/introspect |
| identity | 系统服务 | 统一身份协议 | 身份协议 | POST /api/unified/renew |
| identity | 系统服务 | 统一身份协议 | 身份协议 | POST /api/unified/revoke |
| identity | 系统服务 | 用户目录 | 管理接口 | GET /api/users |
| identity | 系统服务 | 用户目录 | 管理接口 | POST /api/users |
| identity | 系统服务 | 用户目录 | 管理接口 | PATCH /api/users/{userId} |
| identity | 系统服务 | 用户目录 | 管理接口 | GET /api/users/{userId}/organizations |
| identity | 系统服务 | 用户目录 | 管理接口 | PUT /api/users/{userId}/organizations |
| identity | 系统服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/reset-password |
| identity | 系统服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/wecom-identities |
| identity | 系统服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/wecom-identities/{identityId}/unbind |
| identity | 系统服务 | 用户目录 | 管理接口 | POST /api/users/{userId}/zentao-identity |
| identity | 系统服务 | 用户目录 | 管理接口 | POST /api/users/wecom-sync |
| identity | 系统服务 | 用户目录 | 管理接口 | GET /api/users/wecom-sync/status |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /applications |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /assets/{file} |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /auth |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /auth/{uid} |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /divisions |
| identity | 系统服务 | 运行健康 | 健康探针 | GET /health |
| identity | 系统服务 | OIDC 交互 | 身份协议 | GET /interaction/{uid} |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /jwks |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /jwks |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /login |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /me |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /me |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | POST /me |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /organizations |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /request |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | POST /request |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /roles |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /scopes |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /session/end |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | POST /session/end/confirm |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | GET /session/end/success |
| identity | 系统服务 | 页面资源 | 页面与静态资源 | GET /settings |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /token |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | POST /token |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | OPTIONS /token/revocation |
| identity | 系统服务 | OIDC 标准协议 | 身份协议 | POST /token/revocation |
| onlyoffice | 引擎服务 | Office 命令 | 机器集成 | POST /coauthoring/CommandService.ashx |
| platform-kernel | 系统服务 | 应用管理 | 平台控制面 | GET /api/applications |
| platform-kernel | 系统服务 | 应用管理 | 平台控制面 | POST /api/applications |
| platform-kernel | 系统服务 | 应用管理 | 平台控制面 | DELETE /api/applications/{id} |
| platform-kernel | 系统服务 | 应用管理 | 平台控制面 | PUT /api/applications/{id} |
| platform-kernel | 系统服务 | 应用网关 | 平台控制面 | ANY /api/apps/{appId}/{path*} |
| platform-kernel | 系统服务 | 运行健康 | 健康探针 | ANY /api/health |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | DELETE /api/notifications |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | GET /api/notifications |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | PATCH /api/notifications |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | POST /api/notifications |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | GET /api/preferences |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | PUT /api/preferences |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | DELETE /api/preferences/wallpaper |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | GET /api/preferences/wallpaper |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | PUT /api/preferences/wallpaper |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | GET /api/service-registry |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | POST /api/service-registry/activation |
| platform-kernel | 系统服务 | API 台账 | 平台控制面 | GET /api/service-registry/api-inventory |
| platform-kernel | 系统服务 | API 台账 | 平台控制面 | POST /api/service-registry/api-inventory |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | GET /api/service-registry/insights |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | POST /api/service-registry/lifecycle |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | POST /api/service-registry/publications |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | GET /api/service-registry/workspace |
| platform-kernel | 系统服务 | 服务中心 | 平台控制面 | POST /api/service-registry/workspace |
| platform-kernel | 系统服务 | 应用网关 | 平台控制面 | ANY /api/services/apps/{appId}/{path*} |
| platform-kernel | 系统服务 | 应用网关 | 平台控制面 | ANY /api/services/invoke/{serviceId}/{operationId} |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | GET /api/session |
| platform-kernel | 系统服务 | 桌面登录 | 身份协议 | GET /auth/callback |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | POST /auth/logout |
| platform-kernel | 系统服务 | 本人桌面状态 | 平台控制面 | POST /auth/renew |
| platform-kernel | 系统服务 | 桌面登录 | 身份协议 | GET /auth/start |
| resource-manager | 系统服务 | 资源管理 | 业务接口 | GET /api/overview |
| resource-manager | 系统服务 | 资源管理 | 业务接口 | POST /api/resources/{id}/metadata |
| resource-manager | 系统服务 | 资源管理 | 业务接口 | POST /api/resources/{id}/refresh |
| resource-manager | 系统服务 | 运行健康 | 健康探针 | GET /health |
| token-one | 引擎服务 | 可用性告警 | 管理接口 | POST /api/admin/availability-alerts/evaluate |
| token-one | 引擎服务 | 可用性告警 | 管理接口 | GET /api/admin/availability-alerts/events |
| token-one | 引擎服务 | 可用性告警 | 管理接口 | GET /api/admin/availability-alerts/states |
| token-one | 引擎服务 | 供应商同步 | 管理接口 | GET /api/admin/cctq-account |
| token-one | 引擎服务 | 供应商同步 | 管理接口 | PUT /api/admin/cctq-account |
| token-one | 引擎服务 | 供应商同步 | 管理接口 | POST /api/admin/cctq-account/sync |
| token-one | 引擎服务 | 渠道管理 | 管理接口 | GET /api/admin/channels |
| token-one | 引擎服务 | 渠道管理 | 管理接口 | POST /api/admin/channels |
| token-one | 引擎服务 | 渠道管理 | 管理接口 | DELETE /api/admin/channels/{id} |
| token-one | 引擎服务 | 渠道管理 | 管理接口 | PUT /api/admin/channels/{id} |
| token-one | 引擎服务 | 渠道管理 | 管理接口 | POST /api/admin/channels/{id}/recover |
| token-one | 引擎服务 | 渠道管理 | 管理接口 | POST /api/admin/channels/{id}/test |
| token-one | 引擎服务 | 分组路由 | 管理接口 | GET /api/admin/groups |
| token-one | 引擎服务 | 分组路由 | 管理接口 | POST /api/admin/groups |
| token-one | 引擎服务 | 分组路由 | 管理接口 | DELETE /api/admin/groups/{id} |
| token-one | 引擎服务 | 分组路由 | 管理接口 | PUT /api/admin/groups/{id} |
| token-one | 引擎服务 | 分组路由 | 管理接口 | GET /api/admin/groups/model-catalog |
| token-one | 引擎服务 | 调用日志 | 管理接口 | GET /api/admin/logs |
| token-one | 引擎服务 | 模型目录 | 管理接口 | GET /api/admin/models |
| token-one | 引擎服务 | 模型目录 | 管理接口 | POST /api/admin/models |
| token-one | 引擎服务 | 模型目录 | 管理接口 | DELETE /api/admin/models/{id} |
| token-one | 引擎服务 | 模型目录 | 管理接口 | PUT /api/admin/models/{id} |
| token-one | 引擎服务 | 路由元数据 | 管理接口 | GET /api/admin/routing-metadata |
| token-one | 引擎服务 | 用量统计 | 管理接口 | GET /api/admin/stats/availability |
| token-one | 引擎服务 | 用量统计 | 管理接口 | GET /api/admin/stats/by-department |
| token-one | 引擎服务 | 用量统计 | 管理接口 | GET /api/admin/stats/by-model |
| token-one | 引擎服务 | 用量统计 | 管理接口 | GET /api/admin/stats/by-user |
| token-one | 引擎服务 | 用量统计 | 管理接口 | GET /api/admin/stats/overview |
| token-one | 引擎服务 | 用量统计 | 管理接口 | GET /api/admin/stats/trend |
| token-one | 引擎服务 | 供应商账号 | 管理接口 | GET /api/admin/supplier-accounts |
| token-one | 引擎服务 | 供应商账号 | 管理接口 | POST /api/admin/supplier-accounts |
| token-one | 引擎服务 | 供应商账号 | 管理接口 | GET /api/admin/supplier-accounts/{id} |
| token-one | 引擎服务 | 供应商账号 | 管理接口 | PUT /api/admin/supplier-accounts/{id} |
| token-one | 引擎服务 | 供应商账号 | 管理接口 | PUT /api/admin/supplier-accounts/{id}/credential |
| token-one | 引擎服务 | 供应商账号 | 管理接口 | POST /api/admin/supplier-accounts/{id}/sync |
| token-one | 引擎服务 | 令牌管理 | 管理接口 | GET /api/admin/tokens |
| token-one | 引擎服务 | 令牌管理 | 管理接口 | POST /api/admin/tokens |
| token-one | 引擎服务 | 令牌管理 | 管理接口 | DELETE /api/admin/tokens/{id} |
| token-one | 引擎服务 | 用户目录 | 管理接口 | GET /api/admin/users |
| token-one | 引擎服务 | 用户目录 | 管理接口 | POST /api/admin/users |
| token-one | 引擎服务 | 用户目录 | 管理接口 | DELETE /api/admin/users/{id} |
| token-one | 引擎服务 | 用户目录 | 管理接口 | PUT /api/admin/users/{id} |
| token-one | 引擎服务 | 用户目录 | 管理接口 | GET /api/admin/users/{id}/quota-adjustments |
| token-one | 引擎服务 | 登录与 MFA | 身份协议 | POST /api/auth/login |
| token-one | 引擎服务 | 本人会话 | 本人账号 | POST /api/auth/logout |
| token-one | 引擎服务 | 本人会话 | 本人账号 | POST /api/auth/logout/token-one |
| token-one | 引擎服务 | 本人会话 | 本人账号 | POST /api/auth/logout/token-one-console |
| token-one | 引擎服务 | 本人会话 | 本人账号 | POST /api/auth/logout/token-one-docs |
| token-one | 引擎服务 | 本人会话 | 本人账号 | GET /api/auth/me |
| token-one | 引擎服务 | 本人会话 | 本人账号 | GET /api/auth/me/token-one |
| token-one | 引擎服务 | 本人会话 | 本人账号 | GET /api/auth/me/token-one-console |
| token-one | 引擎服务 | 本人会话 | 本人账号 | GET /api/auth/me/token-one-docs |
| token-one | 引擎服务 | 登录与 MFA | 身份协议 | GET /api/auth/sso/callback |
| token-one | 引擎服务 | 登录与 MFA | 身份协议 | GET /api/auth/sso/start |
| token-one | 引擎服务 | 登录与 MFA | 身份协议 | GET /api/auth/sso/status |
| token-one | 引擎服务 | 登录与 MFA | 身份协议 | GET /api/auth/wecom/callback |
| token-one | 引擎服务 | 登录与 MFA | 身份协议 | GET /api/auth/wecom/login |
| token-one | 引擎服务 | 运行健康 | 健康探针 | GET /api/health/live |
| token-one | 引擎服务 | 运行健康 | 健康探针 | GET /api/health/ready |
| token-one | 引擎服务 | 模型目录 | 业务接口 | GET /api/portal/models |
| token-one | 引擎服务 | 用量统计 | 业务接口 | GET /api/portal/stats/my |
| token-one | 引擎服务 | 令牌管理 | 业务接口 | GET /api/portal/tokens |
| token-one | 引擎服务 | 令牌管理 | 业务接口 | POST /api/portal/tokens |
| token-one | 引擎服务 | 令牌管理 | 业务接口 | DELETE /api/portal/tokens/{id} |
| token-one | 引擎服务 | 模型目录 | 业务接口 | GET /api/public/models |
| token-one | 引擎服务 | 企业微信 | 管理接口 | GET /api/wecom/config |
| token-one | 引擎服务 | 企业微信 | 管理接口 | PUT /api/wecom/config |
| token-one | 引擎服务 | 企业微信 | 管理接口 | POST /api/wecom/sync |
| token-one | 引擎服务 | 模型推理协议 | 外部开放协议 | POST /v1/chat/completions |
| token-one | 引擎服务 | 模型推理协议 | 外部开放协议 | POST /v1/messages |
| token-one | 引擎服务 | 模型推理协议 | 外部开放协议 | GET /v1/models |
| token-one | 引擎服务 | 模型推理协议 | 外部开放协议 | POST /v1/responses |

## 范围与状态

- security-one：规划项目，没有实现后端或 API，不伪造登记条目。
- all：台账覆盖当前源码显式路由及 OIDC 已启用路由栈；框架隐式 HEAD/CORS、静态资源文件枚举不逐条计数。台账不是完整 OpenAPI，缺契约的业务接口尚不能切换为仅允许已登记操作的代理策略。

登记是元数据持久化；服务版本、契约、启用状态在读取时关联服务库。禁止把台账条目直接当作网关白名单或自动发布依据。现有版本保持不变。

## 入库

先执行 `service-storage api-inventory-schema`，再执行 `service-storage api-inventory-import <登记包>`；连接和环境只从私密环境变量读取。
全量台账跨环境共享；所选环境只影响关联服务版本的启用状态。导入使用事务锁、内容摘要与历史修订保存；HTTP 导入另需 expectedRevision、服务管理权限、管理员角色与 CSRF。
