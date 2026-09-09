CREATE TABLE "WeComIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "corpId" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "WeComIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeComIdentity_corpId_externalUserId_key" ON "WeComIdentity"("corpId", "externalUserId");
CREATE INDEX "WeComIdentity_userId_idx" ON "WeComIdentity"("userId");

CREATE TABLE "WeComLoginState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "browserNonceHash" TEXT NOT NULL,
  "returnTo" TEXT NOT NULL DEFAULT '/',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeComLoginState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeComLoginState_stateHash_key" ON "WeComLoginState"("stateHash");
CREATE INDEX "WeComLoginState_expiresAt_usedAt_idx" ON "WeComLoginState"("expiresAt", "usedAt");

ALTER TABLE "WeComIdentity" ADD CONSTRAINT "WeComIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
