# 阶段 2.1 生产发布验收

验收日期：2026-08-24

## 发布范围

阶段 2.1 修正平台角色与指标体系权限的展示语义：权限管理只展示平台角色和五项体系权限，不再显示“本体系职责”；内部 `reader` 在用户界面显示为“普通用户”。体系授权不修改 `User.role`。

## 本地门禁

- 提交：`25c31ec fix: clarify platform roles in system access`
- API 集成测试：19/19 通过。
- Web 测试：40/40 通过。
- API/Web 类型检查通过。
- API/Web 生产构建通过。
- 发布包：`stage21-20260824-102000.tar.gz`
- 本地及远端 SHA256：`ba8d4651638c0b039c49c498e14afdb9bd3a463dc9b6afdb91d7f0effde2cef4`

生产构建在本地干净工作树完成；服务器未执行 TypeScript 或 Web 构建。

## 生产变更

- 当前 release：`/opt/mg-expert-database/releases/stage21-20260824-102000`。
- systemd 服务：`mg-expert-database-api active`。
- 本机 API 健康检查返回 `{"status":"ok","service":"mg-expert-api"}`。
- Prisma 识别 10 个迁移，数据库 Schema 已是最新状态。
- API 源码已包含 `platformRoleLabel`。

## 备份与回滚点

备份目录：`/opt/mg-expert-database/backups/stage21-20260824-102000`

- PostgreSQL `database.dump` 已生成且非空。
- 旧 systemd 单元已备份。
- 旧 Web 文件和旧 release 指针由远端发布脚本保存。
- 发布脚本包含 API、systemd 和 Web 的失败回滚逻辑。

## 公网验收

以下地址从独立公网请求返回预期状态：

- `/knowledge-base-inside/`：200
- `/knowledge-base-inside/login`：200
- `/knowledge-base-inside/systems`：200
- `/knowledge-base-inside/api/health`：200
- `/knowledge-base-inside/api/auth/wecom/status`：200
- 未登录 `/knowledge-base-inside/api/systems`：401

线上 JavaScript 资源为 `index-Dl6oXC61.js`，包含“平台角色”文案，未包含“默认职责”或“只读用户”旧文案。

## 未覆盖项

浏览器控制运行时在初始化阶段异常退出，未取得本轮生产页面截图；因此本记录不宣称已完成真实浏览器交互验收。API、静态资源、公网路由和服务端验收均已完成。
