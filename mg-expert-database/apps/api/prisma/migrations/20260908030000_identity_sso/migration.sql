ALTER TABLE "User" ADD COLUMN "identityIssuer" TEXT, ADD COLUMN "identitySubject" TEXT, ADD COLUMN "identityEnabled" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "User_identitySubject_key" ON "User"("identitySubject");
ALTER TABLE "AuthSession" ADD COLUMN "identitySubject" TEXT, ADD COLUMN "identitySessionId" TEXT;
