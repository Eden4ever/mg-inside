# 账户恢复路径验证

日期：2026-09-07。结果：fixed（仅指本报告的恢复路径缺口，不代表整个认证改造或生产发布完成）。

## 问题与边界

恢复码能完成登录，但账户管理复核原先只接受原认证器、邮箱或安全密钥，设备全部丢失时无法维护设置。修复保留当前密码检查、有效会话及安全版本校验、账户行锁、累计失败限流、一次性且会话绑定的管理凭证。

`account-security.ts` 的公共复核入口增加恢复码原子消费；与登录共享同一恢复码记录，不能跨入口重放。关闭 MFA 删除剩余恢复码。最后一枚用于登录的情况，允许服务端记录的恢复登录在 5 分钟内复核密码；普通会话、未来时间和过期验证均不满足条件。页面状态只决定是否显示选项，服务端再次验证，不信任客户端声明。

## 修改文件

- `apps/api/src/account-security.ts`、`account-security.controller.ts`
- `apps/web/src/components/AccountSecurity.vue`、`apps/web/src/api/client.ts`
- `apps/api/test/api.integration.spec.ts`、`apps/web/src/tests/AccountSecurity.test.ts`

## 验证

1. `pnpm --filter @mg-expert/api typecheck`：通过。
2. `pnpm --filter @mg-expert/web typecheck`：通过。
3. `pnpm --filter @mg-expert/api exec vitest run test/api.integration.spec.ts`：40 项通过。新增验证覆盖错误密码不消耗码、并发只成功一次、拒绝登录已用码、无剩余码时近期恢复登录可关闭 MFA，以及普通会话和过期恢复验证拒绝。既有 TOTP、邮箱、权限及记录流程继续通过。
4. `pnpm --filter @mg-expert/web exec vitest run src/tests/AccountSecurity.test.ts`：3 项通过，覆盖完整恢复码传参及原绑定流程。
5. `pnpm audit --registry=https://registry.npmjs.org`：未发现已知漏洞。这不是全部应用安全性的证明。

按安全修复技能完成一次独立调查及一次候选复核。复核指出最后一枚码的场景，随后补充服务端短期恢复会话校验及拒绝用例，未再启动第二轮独立审查。

## 剩余验证

尚未验证真实硬件注册、完整解绑重绑端到端界面或生产部署。发布脚本补充密钥备份，但尚未在生产执行。整个目标仍未完成。
