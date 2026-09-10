CREATE TABLE "OidcClient" (
  "clientId" TEXT PRIMARY KEY,
  "redirectUris" TEXT[] NOT NULL,
  "encryptedSecret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "registrationId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "OidcRecord" ADD COLUMN "clientId" TEXT, ADD COLUMN "clientRevision" INTEGER;
CREATE INDEX "OidcRecord_clientId_idx" ON "OidcRecord"("clientId");
