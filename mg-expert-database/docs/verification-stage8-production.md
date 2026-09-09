# 2026-09-08 生产发布验证

- 版本：`stage8-20260908-094100`。
- 内容：个人中心分区与响应式间距；工作区顶部编辑指标体系；编辑弹窗删除体系、名称确认、服务端权限校验及关联语义库保护。
- 全量测试：契约 4、API 80、前端 116，共 200 项通过。首次因本地 Docker 未启动失败，启动原数据库容器后全量重跑通过。
- 生产路径构建通过；包 SHA-256：`6f1cf3d73a029320dd18ddaf18aa1d2c9d69f53d2ca53e420e830e6e32addbd7`。
- 与上一版相比，后端源码差异仅 api.controller.ts、catalog.service.ts；数据库结构与认证核心代码未变。
- 发布脚本退出码 0，18 个迁移均已应用，无新增待执行迁移。
- current：`/opt/mg-expert-database/releases/stage8-20260908-094100`，服务 active。
- 备份：`/opt/mg-expert-database/backups/stage8-20260908-094100`，数据库备份和认证密钥备份均检查存在且非空。
- 旧前端：`/var/www/mg-expert-database/.knowledge-base-inside.stage8-20260908-094100.previous`。
- 公网 systems、profile、新 JS `index-B2YM1nOG.js`、新 CSS `index-yDrOfgX9.css`、health 均 200；页面入口引用新版 JS。
- 匿名 auth/me、account-security、systems 均返回 401。
- 没有在生产执行体系删除或修改业务数据；删除级联和权限行为在本地独立测试 schema 验证。此次未重新进行真实设备认证交互验收。
