# 账户安全规划证据

来源：当前工作树源码，不使用旧扫描作为当前实现证明。目录 C:/Projects/mg-expert-database；存在未提交修复，sourceDrift=present。日期 2026-09-07。

- 登录会话签发：apps/api/src/auth.ts，SHA256 B1E4C7BBAE23C5D261AF686A65F8B48B8337D1388FCC140135488A5CA7B5BE12。
- HTTP 登录入口：apps/api/src/auth.controller.ts，SHA256 E211F3AD8DFEB5C72CDD4AACF641D7CB2A65888343C354D13690A35A56681A30。
- 企业身份入口：apps/api/src/wecom-auth.ts，SHA256 D748C380A3C4BB4A1D07DAC9952C61BAF5584681412DD8B0A8D5C195B65932A4。
- 数据模型：apps/api/prisma/schema.prisma；当前没有邮箱、WebAuthn、TOTP 或多因素挑战模型。

用户约束：规划邮箱绑定、安全密钥、Google Authenticator 六位码；多种方式可选择；用户自行开启或关闭多因素验证，默认关闭；不采购付费服务；继续使用主流安全协议。

参考：RFC 6238；W3C WebAuthn；NIST SP 800-63B-4（邮箱不作为符合该标准的带外认证）。方案不是已实现或已完成安全认证的声明。
