# 本地数据库加固验证

2026-09-07。

- 原容器端口映射为所有主机地址的 5437；已重新创建本项目 postgres 容器，仅绑定 `127.0.0.1:5437`。
- 保留原卷 `mg-expert-database_mg_expert_postgres`，挂载位置不变；未删除数据卷。
- 操作前数据库备份为 `artifacts/mg-before-loopback-20260907.dump`，原本地环境配置备份为 `.runtime/env-before-db-rotation-20260907.backup`；均被 Git 忽略。
- 已生成独立随机数据库密码、执行角色密码轮换，并通过 apply_patch 同步 `.env` 的数据库 URL 和 Compose 密码变量。本文和测试输出不含新密码。
- 新密码连接成功，public 数据库仍有 19 用户；旧默认密码连接被 P1000 拒绝。
- 仅 IPv4 监听后，`localhost` 引发连接池建立等待；本地连接配置和示例统一为 `127.0.0.1` 后，42 项接口集成测试通过。
- 集成测试移除硬编码默认密码，只读取本地配置中的 DATABASE_URL，不加载其他服务密钥；强制本机 5437、`mg_expert` 数据库和独立测试 schema，拒绝误用生产数据库。

本次修改不涉及已发布生产环境；本地 4100 检查时没有运行中的 API 服务。
