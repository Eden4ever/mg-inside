ALTER TABLE "Role" ADD COLUMN "key" TEXT;
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
DROP INDEX "Role_name_key";

-- 内置角色按唯一 key 识别，同名普通角色不获得管理权限。
INSERT INTO "Role" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'platform-admin', '平台管理员', '管理平台用户、角色、应用授权和认证配置；应用访问仍需显式授权。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- 仅迁移时导入既有启用管理员，运行期不再读取旧 User.role 判权或恢复成员关系。
INSERT INTO "UserRole" ("userId", "roleId", "createdAt")
SELECT u."id", r."id", CURRENT_TIMESTAMP FROM "User" u CROSS JOIN "Role" r
WHERE u."role" = 'system_admin' AND u."status" = 'active' AND r."key" = 'platform-admin'
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- 默认文件应用只受登录、账号状态及应用启用校验，不参与分配。
INSERT INTO "Application" ("clientId", "name", "enabled") VALUES ('files', '文件', true) ON CONFLICT ("clientId") DO NOTHING;
