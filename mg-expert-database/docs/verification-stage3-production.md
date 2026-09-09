# 阶段 3A 生产发布验收

验收日期：2026-08-24

## 发布范围

阶段 3A 增加个人中心和本地账号密码管理：所有登录用户可查看姓名、账号、部门、平台角色、认证来源和登录状态；本地账号可验证当前密码后修改密码，保留当前会话并撤销其他会话；企业微信专属账号不提供本地改密入口。

## 本地门禁

- 提交：`4b4639b feat: add personal profile and password management`
- API 集成测试：21/21 通过。
- Web 测试：47/47 通过。
- API/Web 类型检查通过。
- API/Web 生产构建通过。
- 发布包：`stage3-20260824-111147.tar.gz`
- 本地及远端 SHA256：`07644523377403d4d6967e8285deaa091ed2604a0fedbdf4e0df4e5d11ce98ed`

生产 Web 构建显式使用 `/knowledge-base-inside/` 资源基路径和 `/knowledge-base-inside/api` API 基路径；服务器未执行 TypeScript 或 Vite 构建。

## 生产变更

- 当前 release：`/opt/mg-expert-database/releases/stage3-20260824-111147`。
- 上一 release：`/opt/mg-expert-database/releases/stage21-20260824-102000`。
- systemd 服务：`mg-expert-database-api active`。
- 本机 API 健康检查返回 `status: ok`。
- Prisma 识别 10 个迁移，数据库 Schema 已是最新状态。
- 生产 API 源码包含 `/api/auth/change-password` 路由。

## 备份与回滚点

备份目录：`/opt/mg-expert-database/backups/stage3-20260824-111147`

- PostgreSQL `database.dump` 已生成，大小为 63,254 字节。
- 旧 systemd 单元、旧 Web 文件和旧 release 指针均已备份。
- 发布脚本包含 API、systemd 和 Web 的失败回滚逻辑。

## 公网验收

以下地址从独立公网请求返回预期状态：

- `/knowledge-base-inside/`：200
- `/knowledge-base-inside/login`：200
- `/knowledge-base-inside/systems`：200
- `/knowledge-base-inside/profile`：200
- `/knowledge-base-inside/api/health`：200
- `/knowledge-base-inside/api/auth/wecom/status`：200
- 未登录 `/knowledge-base-inside/api/systems`：401
- 未登录 `POST /knowledge-base-inside/api/auth/change-password`：401

线上 JavaScript 资源为 `index-B_CU_G14.js`，包含 `/profile`、`/auth/change-password`、其他会话失效提示和“平台角色”文案。

## 未覆盖项

本轮未使用真实本地账号执行生产改密，避免主动改变生产用户凭据；改密成功、旧密码失效、当前会话保留、其他会话撤销、审计日志和企业微信账号拒绝改密由 API 集成测试覆盖。生产端已完成路由、访问控制、服务、数据库迁移和静态资源验收。
