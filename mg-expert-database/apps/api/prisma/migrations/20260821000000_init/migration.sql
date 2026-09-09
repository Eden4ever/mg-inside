-- Prisma migration generated from the M0-M3 domain contract.
CREATE TABLE "IndicatorSystem" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "region" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndicatorSystem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndicatorSystem_code_key" ON "IndicatorSystem"("code");
CREATE TABLE "IndicatorVersion" (
  "id" TEXT NOT NULL, "systemId" TEXT NOT NULL, "year" INTEGER NOT NULL, "versionCode" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndicatorVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndicatorVersion_systemId_year_versionCode_key" ON "IndicatorVersion"("systemId", "year", "versionCode");
CREATE TABLE "IndicatorNode" (
  "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "parentId" TEXT, "parentKey" TEXT NOT NULL DEFAULT '__root__', "level" INTEGER NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndicatorNode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndicatorNode_versionId_parentKey_code_key" ON "IndicatorNode"("versionId", "parentKey", "code");
CREATE INDEX "IndicatorNode_versionId_parentId_sortOrder_idx" ON "IndicatorNode"("versionId", "parentId", "sortOrder");
CREATE TABLE "ResearchRecord" (
  "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "indicatorNodeId" TEXT NOT NULL, "summary" TEXT, "revisionNo" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResearchRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchRecord_versionId_indicatorNodeId_key" ON "ResearchRecord"("versionId", "indicatorNodeId");
CREATE UNIQUE INDEX "ResearchRecord_indicatorNodeId_key" ON "ResearchRecord"("indicatorNodeId");
CREATE TABLE "ResearchModule" (
  "id" TEXT NOT NULL, "recordId" TEXT NOT NULL, "moduleKey" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'not_started', "values" JSONB NOT NULL DEFAULT '{}', "naReasons" JSONB NOT NULL DEFAULT '{}', "revisionNo" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResearchModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchModule_recordId_moduleKey_key" ON "ResearchModule"("recordId", "moduleKey");
CREATE TABLE "Evidence" (
  "id" TEXT NOT NULL, "recordId" TEXT NOT NULL, "moduleKey" TEXT NOT NULL, "fieldKeys" JSONB NOT NULL DEFAULT '[]', "type" TEXT NOT NULL, "title" TEXT NOT NULL, "sourceUrl" TEXT, "excerpt" TEXT, "verificationStatus" TEXT NOT NULL DEFAULT 'pending_verification', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Evidence_recordId_moduleKey_idx" ON "Evidence"("recordId", "moduleKey");
CREATE TABLE "ResearchRevision" (
  "id" TEXT NOT NULL, "moduleId" TEXT NOT NULL, "revisionNo" INTEGER NOT NULL, "snapshot" JSONB NOT NULL, "actorName" TEXT NOT NULL, "action" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchRevision_moduleId_revisionNo_key" ON "ResearchRevision"("moduleId", "revisionNo");
CREATE INDEX "ResearchRevision_moduleId_createdAt_idx" ON "ResearchRevision"("moduleId", "createdAt");
CREATE TABLE "AISuggestion" (
  "id" TEXT NOT NULL, "recordId" TEXT NOT NULL, "moduleKey" TEXT NOT NULL, "fieldKey" TEXT, "content" TEXT NOT NULL, "rationale" TEXT NOT NULL, "confidence" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AISuggestion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL, "versionId" TEXT, "actorName" TEXT NOT NULL, "actorRole" TEXT NOT NULL, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, "result" TEXT NOT NULL DEFAULT 'success', "detail" JSONB, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_versionId_at_idx" ON "AuditLog"("versionId", "at");
ALTER TABLE "IndicatorVersion" ADD CONSTRAINT "IndicatorVersion_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "IndicatorSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndicatorNode" ADD CONSTRAINT "IndicatorNode_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IndicatorVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndicatorNode" ADD CONSTRAINT "IndicatorNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IndicatorNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResearchRecord" ADD CONSTRAINT "ResearchRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IndicatorVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchRecord" ADD CONSTRAINT "ResearchRecord_indicatorNodeId_fkey" FOREIGN KEY ("indicatorNodeId") REFERENCES "IndicatorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchModule" ADD CONSTRAINT "ResearchModule_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ResearchRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ResearchRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "ResearchModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AISuggestion" ADD CONSTRAINT "AISuggestion_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ResearchRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IndicatorVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
