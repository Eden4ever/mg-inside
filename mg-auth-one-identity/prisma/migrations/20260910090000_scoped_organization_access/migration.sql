CREATE TABLE "UserOrganization" (
  "userId" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserOrganization_pkey" PRIMARY KEY ("userId", "organizationId"),
  CONSTRAINT "UserOrganization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UserOrganization_organizationId_idx" ON "UserOrganization"("organizationId");
CREATE UNIQUE INDEX "UserOrganization_one_primary" ON "UserOrganization"("userId") WHERE "isPrimary" = true;
CREATE TABLE "ManagementScope" (
  "id" TEXT NOT NULL, "divisionId" TEXT, "organizationId" TEXT,
  CONSTRAINT "ManagementScope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagementScope_one_target" CHECK (("divisionId" IS NULL) <> ("organizationId" IS NULL)),
  CONSTRAINT "ManagementScope_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ManagementScope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagementScope_divisionId_key" ON "ManagementScope"("divisionId");
CREATE UNIQUE INDEX "ManagementScope_organizationId_key" ON "ManagementScope"("organizationId");
CREATE TABLE "ScopeAdministrator" (
  "scopeId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  CONSTRAINT "ScopeAdministrator_pkey" PRIMARY KEY ("scopeId", "userId"),
  CONSTRAINT "ScopeAdministrator_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ManagementScope"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScopeAdministrator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScopeAdministrator_userId_idx" ON "ScopeAdministrator"("userId");
CREATE TABLE "ScopeApplication" (
  "scopeId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  CONSTRAINT "ScopeApplication_pkey" PRIMARY KEY ("scopeId", "clientId"),
  CONSTRAINT "ScopeApplication_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ManagementScope"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScopeApplication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Application"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ScopeApplication_clientId_idx" ON "ScopeApplication"("clientId");
CREATE TABLE "ScopeGrant" (
  "scopeId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScopeGrant_pkey" PRIMARY KEY ("scopeId", "clientId", "userId"),
  CONSTRAINT "ScopeGrant_scopeId_clientId_fkey" FOREIGN KEY ("scopeId", "clientId") REFERENCES "ScopeApplication"("scopeId", "clientId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScopeGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScopeGrant_userId_clientId_idx" ON "ScopeGrant"("userId", "clientId");
INSERT INTO "Role" ("id", "key", "name", "description", "updatedAt") VALUES
  ('builtin-division-admin', 'division-admin', '行政区划管理员', '仅管理指定行政区划范围内配置的应用授权。', CURRENT_TIMESTAMP),
  ('builtin-organization-admin', 'organization-admin', '组织机构管理员', '仅管理指定组织机构范围内配置的应用授权。', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
