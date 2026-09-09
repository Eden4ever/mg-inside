-- 新系统应用按既有平台管理员角色开放，不改变用户成员关系或业务角色。
INSERT INTO "Application" ("clientId", "name", "enabled")
VALUES ('resource-manager', '资源管理', true)
ON CONFLICT ("clientId") DO NOTHING;

INSERT INTO "RoleApplication" ("roleId", "clientId", "enabled", "updatedAt")
SELECT r.id, a."clientId", true, CURRENT_TIMESTAMP
FROM "Role" r CROSS JOIN "Application" a
WHERE r.key = 'platform-admin' AND a."clientId" IN ('resource-manager', 'office-one')
ON CONFLICT ("roleId", "clientId") DO NOTHING;
