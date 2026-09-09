-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "MailConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "security" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastTestAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "authSource" TEXT NOT NULL DEFAULT 'local',
    "departmentName" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "securityVersion" INTEGER NOT NULL DEFAULT 0,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZentaoIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZentaoIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "ApplicationUser" (
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localUserId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationUser_pkey" PRIMARY KEY ("clientId","userId")
);

-- CreateTable
CREATE TABLE "OidcRecord" (
    "model" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "uid" TEXT,
    "userCode" TEXT,
    "grantId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" INTEGER,

    CONSTRAINT "OidcRecord_pkey" PRIMARY KEY ("model","id")
);

-- CreateTable
CREATE TABLE "DirectorySnapshot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcSessionLink" (
    "grantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "OidcSessionLink_pkey" PRIMARY KEY ("grantId")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "securityVersion" INTEGER NOT NULL DEFAULT 0,
    "authMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeComIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "corpId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "WeComIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeComIdentityRevocation" (
    "corpId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeComIdentityRevocation_pkey" PRIMARY KEY ("corpId","externalUserId")
);

-- CreateTable
CREATE TABLE "VerifiedEmail" (
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedEmail_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TotpCredential" (
    "userId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "lastUsedStep" BIGINT NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SecurityKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "SecurityKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "firstMethod" TEXT NOT NULL,
    "securityVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'success',
    "detail" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "ZentaoIdentity_server_account_key" ON "ZentaoIdentity"("server", "account");

-- CreateIndex
CREATE UNIQUE INDEX "ZentaoIdentity_userId_server_key" ON "ZentaoIdentity"("userId", "server");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationUser_clientId_localUserId_key" ON "ApplicationUser"("clientId", "localUserId");

-- CreateIndex
CREATE INDEX "OidcRecord_model_uid_idx" ON "OidcRecord"("model", "uid");

-- CreateIndex
CREATE INDEX "OidcRecord_model_userCode_idx" ON "OidcRecord"("model", "userCode");

-- CreateIndex
CREATE INDEX "OidcRecord_grantId_idx" ON "OidcRecord"("grantId");

-- CreateIndex
CREATE INDEX "OidcRecord_expiresAt_idx" ON "OidcRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "DirectorySnapshot_expiresAt_idx" ON "DirectorySnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "OidcSessionLink_sessionId_idx" ON "OidcSessionLink"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_csrfToken_key" ON "AuthSession"("csrfToken");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_revokedAt_idx" ON "AuthSession"("expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "WeComIdentity_userId_idx" ON "WeComIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeComIdentity_corpId_externalUserId_key" ON "WeComIdentity"("corpId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WeComIdentity_userId_corpId_key" ON "WeComIdentity"("userId", "corpId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedEmail_address_key" ON "VerifiedEmail"("address");

-- CreateIndex
CREATE INDEX "SecurityKey_userId_idx" ON "SecurityKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_tokenHash_key" ON "AuthChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthChallenge_userId_purpose_expiresAt_idx" ON "AuthChallenge"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeComLoginState_stateHash_key" ON "WeComLoginState"("stateHash");

-- CreateIndex
CREATE INDEX "WeComLoginState_expiresAt_usedAt_idx" ON "WeComLoginState"("expiresAt", "usedAt");

-- AddForeignKey
ALTER TABLE "ZentaoIdentity" ADD CONSTRAINT "ZentaoIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationUser" ADD CONSTRAINT "ApplicationUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Application"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationUser" ADD CONSTRAINT "ApplicationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeComIdentity" ADD CONSTRAINT "WeComIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedEmail" ADD CONSTRAINT "VerifiedEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpCredential" ADD CONSTRAINT "TotpCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityKey" ADD CONSTRAINT "SecurityKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCode" ADD CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
