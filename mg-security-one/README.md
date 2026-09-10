# 安全中心

平台级安全中心应用：集中查看登录历史与操作日志，并把散落在代码里的安全策略变成可配置项。

当前处于规划阶段，尚无代码。分期计划、现状盘点与待决事项见 [docs/security-center-plan.md](docs/security-center-plan.md)。

按「谁执行谁拥有数据，内核只做对应用的出口」对现有 12 个平台应用的审计见 [docs/existing-application-audit.md](docs/existing-application-audit.md)。

第一期范围为应用骨架加「登录历史」一页，需要先在统一身份中心补登录尝试记录——目前登录失败只递增 `User.failedLoginCount`，没有任何可查询记录。
