-- 保留内置 User.role；自定义角色仅作为应用授权分组。
CREATE TABLE "Role" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE TABLE "UserRole" (
  "userId" TEXT NOT NULL, "roleId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId"),
  CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE TABLE "RoleApplication" (
  "roleId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoleApplication_pkey" PRIMARY KEY ("roleId", "clientId"),
  CONSTRAINT "RoleApplication_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoleApplication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Application"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RoleApplication_clientId_idx" ON "RoleApplication"("clientId");
INSERT INTO "Application" ("clientId", "name", "enabled") VALUES
  ('identity', '统一身份', true), ('personal-center', '个人中心', true), ('app-manager', '应用管理', true),
  ('token-one-console', 'Token One 控制台', true), ('token-one-docs', 'Token One 文档', true)
ON CONFLICT ("clientId") DO NOTHING;
-- 将原先管理员管理中心的隐式访问转换为可审计的显式直授权，不修改任何业务角色。
INSERT INTO "ApplicationUser" ("clientId", "userId", "localUserId", "enabled", "updatedAt")
SELECT 'identity', "id", NULL, true, CURRENT_TIMESTAMP FROM "User" WHERE "role" = 'system_admin' AND "status" = 'active'
ON CONFLICT ("clientId", "userId") DO NOTHING;
