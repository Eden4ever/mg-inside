CREATE TABLE "IndicatorSystemAccess" (
  "id" TEXT NOT NULL,
  "systemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT true,
  "canResearch" BOOLEAN NOT NULL DEFAULT false,
  "canManageCatalog" BOOLEAN NOT NULL DEFAULT false,
  "canReview" BOOLEAN NOT NULL DEFAULT false,
  "canPublish" BOOLEAN NOT NULL DEFAULT false,
  "grantedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IndicatorSystemAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndicatorSystemAccess_systemId_userId_key" ON "IndicatorSystemAccess"("systemId", "userId");
CREATE INDEX "IndicatorSystemAccess_userId_canView_idx" ON "IndicatorSystemAccess"("userId", "canView");
CREATE INDEX "IndicatorSystemAccess_systemId_idx" ON "IndicatorSystemAccess"("systemId");

ALTER TABLE "IndicatorSystemAccess"
  ADD CONSTRAINT "IndicatorSystemAccess_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "IndicatorSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "IndicatorSystemAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "IndicatorSystemAccess_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "IndicatorSystemAccess" (
  "id", "systemId", "userId", "canView", "canResearch", "canManageCatalog", "canReview", "canPublish", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  system.id,
  app_user.id,
  true,
  app_user.role IN ('researcher', 'ai_service'),
  app_user.role = 'catalog_manager',
  app_user.role = 'reviewer',
  app_user.role = 'publisher',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "IndicatorSystem" system
CROSS JOIN "User" app_user
WHERE app_user.status = 'active'
  AND app_user.role <> 'system_admin';
