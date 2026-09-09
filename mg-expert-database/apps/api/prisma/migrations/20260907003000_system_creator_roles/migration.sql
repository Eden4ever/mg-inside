ALTER TABLE "IndicatorSystem" ADD COLUMN "creatorUserId" TEXT;
ALTER TABLE "IndicatorSystem" ADD CONSTRAINT "IndicatorSystem_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IndicatorSystemAccess" ADD COLUMN "systemRole" TEXT;
ALTER TABLE "IndicatorSystemAccess" ADD CONSTRAINT "IndicatorSystemAccess_systemRole_check" CHECK ("systemRole" IN ('creator','manager','editor','viewer'));
-- 仅根据可信创建审计回填；无历史创建者证据的体系继续由系统管理员维护。
UPDATE "IndicatorSystem" s SET "creatorUserId" = a."actorUserId"
FROM (SELECT DISTINCT ON ("targetId") "targetId", "actorUserId" FROM "AuditLog" WHERE action='system.created' AND "actorUserId" IS NOT NULL ORDER BY "targetId", at ASC) a
WHERE s.id=a."targetId";
INSERT INTO "IndicatorSystemAccess" ("id","systemId","userId","systemRole","canView","canResearch","canManageCatalog","canReview","canPublish","createdAt","updatedAt")
SELECT md5(id || ':creator'), id, "creatorUserId", 'creator', true, true, true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "IndicatorSystem" WHERE "creatorUserId" IS NOT NULL
ON CONFLICT ("systemId","userId") DO UPDATE SET "systemRole"='creator',"canView"=true,"canResearch"=true,"canManageCatalog"=true;
