ALTER TABLE "AISuggestion"
  ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'module',
  ADD COLUMN "evidenceIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "verificationItems" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "sourceRevisionIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "modelId" TEXT NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'm0-contract',
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decidedByUserId" TEXT,
  ADD COLUMN "resultRevisionId" TEXT;

ALTER TABLE "AISuggestion" ALTER COLUMN "moduleKey" DROP NOT NULL;

CREATE INDEX "AISuggestion_recordId_targetType_status_idx" ON "AISuggestion"("recordId", "targetType", "status");
CREATE INDEX "AISuggestion_decidedByUserId_idx" ON "AISuggestion"("decidedByUserId");

ALTER TABLE "AISuggestion" ADD CONSTRAINT "AISuggestion_decidedByUserId_fkey"
  FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
