CREATE TABLE "SemanticLibrary" (
 "id" TEXT PRIMARY KEY, "versionId" TEXT NOT NULL UNIQUE REFERENCES "IndicatorVersion"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "activeBuildId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "SemanticBuild" (
 "id" TEXT PRIMARY KEY, "libraryId" TEXT NOT NULL REFERENCES "SemanticLibrary"("id") ON DELETE CASCADE,
 "actorUserId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "fingerprint" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "total" INTEGER NOT NULL, "completed" INTEGER NOT NULL DEFAULT 0, "reused" INTEGER NOT NULL DEFAULT 0,
 "tokens" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "SemanticBuild_status_createdAt_idx" ON "SemanticBuild"("status", "createdAt");
CREATE TABLE "SemanticChunk" (
 "id" TEXT PRIMARY KEY, "buildId" TEXT NOT NULL REFERENCES "SemanticBuild"("id") ON DELETE CASCADE,
 "hash" TEXT NOT NULL, "nodeId" TEXT NOT NULL, "path" TEXT NOT NULL, "label" TEXT NOT NULL,
 "text" TEXT NOT NULL, "metadata" JSONB NOT NULL, "embedding" DOUBLE PRECISION[] NOT NULL
);
CREATE INDEX "SemanticChunk_buildId_idx" ON "SemanticChunk"("buildId");
