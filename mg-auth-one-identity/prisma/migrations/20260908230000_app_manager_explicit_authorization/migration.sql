-- 应用管理是可分配授权的系统应用；不为现有用户或角色自动授予权限。
-- 保留已有登记状态，兼容旧版本尚未登记该应用的数据库。
INSERT INTO "Application" ("clientId", "name", "enabled")
VALUES ('app-manager', '应用管理', true)
ON CONFLICT ("clientId") DO NOTHING;
