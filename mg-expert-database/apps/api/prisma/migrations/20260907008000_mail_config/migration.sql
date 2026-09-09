CREATE TABLE "MailConfig" (
 "id" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "host" TEXT NOT NULL, "port" INTEGER NOT NULL, "security" TEXT NOT NULL,
 "username" TEXT NOT NULL, "encryptedPassword" TEXT NOT NULL,
 "fromAddress" TEXT NOT NULL, "fromName" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1, "lastTestAt" TIMESTAMP(3),
 "updatedAt" TIMESTAMP(3) NOT NULL
);
