CREATE TABLE "ResearchAssignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "indicatorNodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchAssignment_versionId_indicatorNodeId_userId_key" ON "ResearchAssignment"("versionId", "indicatorNodeId", "userId");
CREATE INDEX "ResearchAssignment_userId_versionId_idx" ON "ResearchAssignment"("userId", "versionId");
CREATE INDEX "ResearchAssignment_versionId_indicatorNodeId_idx" ON "ResearchAssignment"("versionId", "indicatorNodeId");

ALTER TABLE "ResearchAssignment" ADD CONSTRAINT "ResearchAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IndicatorVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchAssignment" ADD CONSTRAINT "ResearchAssignment_indicatorNodeId_fkey" FOREIGN KEY ("indicatorNodeId") REFERENCES "IndicatorNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchAssignment" ADD CONSTRAINT "ResearchAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchAssignment" ADD CONSTRAINT "ResearchAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
