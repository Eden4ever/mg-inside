INSERT INTO "Application" ("clientId", "name", "enabled") VALUES ('service-manager', '服务管理', true)
ON CONFLICT ("clientId") DO NOTHING;
INSERT INTO "RoleApplication" ("roleId", "clientId", "enabled", "updatedAt")
SELECT id, 'service-manager', true, CURRENT_TIMESTAMP FROM "Role" WHERE key='platform-admin'
ON CONFLICT ("roleId", "clientId") DO NOTHING;
