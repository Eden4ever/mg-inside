-- 新增认证状态，不改变现有用户的多因素开关。
ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mfaMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuthSession" ADD COLUMN "authMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "VerifiedEmail" (
 "userId" TEXT PRIMARY KEY, "address" TEXT NOT NULL,
 "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VerifiedEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerifiedEmail_address_key" ON "VerifiedEmail"("address");
CREATE TABLE "TotpCredential" (
 "userId" TEXT PRIMARY KEY, "encryptedSecret" TEXT NOT NULL,
 "lastUsedStep" BIGINT NOT NULL DEFAULT -1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TotpCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SecurityKey" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "publicKey" BYTEA NOT NULL, "counter" BIGINT NOT NULL DEFAULT 0,
 "transports" TEXT[] DEFAULT ARRAY[]::TEXT[], "backedUp" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastUsedAt" TIMESTAMP(3),
 CONSTRAINT "SecurityKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SecurityKey_userId_idx" ON "SecurityKey"("userId");
CREATE TABLE "AuthChallenge" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL, "browserHash" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "purpose" TEXT NOT NULL, "firstMethod" TEXT NOT NULL,
 "securityVersion" INTEGER NOT NULL, "payload" JSONB NOT NULL DEFAULT '{}',
 "attempts" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL,
 "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthChallenge_tokenHash_key" ON "AuthChallenge"("tokenHash");
CREATE INDEX "AuthChallenge_userId_purpose_expiresAt_idx" ON "AuthChallenge"("userId", "purpose", "expiresAt");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");
CREATE TABLE "RecoveryCode" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "codeHash" TEXT NOT NULL,
 "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode"("codeHash");
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");
