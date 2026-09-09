ALTER TABLE "ResearchRevision" ADD COLUMN "actorUserId" TEXT;

CREATE TABLE "ResearchSummaryRevision" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "sourceRevisionIds" JSONB NOT NULL DEFAULT '[]',
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchSummaryRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchSummaryRevision_recordId_revisionNo_key" ON "ResearchSummaryRevision"("recordId", "revisionNo");
CREATE INDEX "ResearchSummaryRevision_recordId_createdAt_idx" ON "ResearchSummaryRevision"("recordId", "createdAt");

ALTER TABLE "ResearchRevision" ADD CONSTRAINT "ResearchRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchSummaryRevision" ADD CONSTRAINT "ResearchSummaryRevision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ResearchRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSummaryRevision" ADD CONSTRAINT "ResearchSummaryRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
