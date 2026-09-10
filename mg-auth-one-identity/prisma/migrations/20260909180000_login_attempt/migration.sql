CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "secondMethod" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginAttempt_at_idx" ON "LoginAttempt"("at");
CREATE INDEX "LoginAttempt_userId_at_idx" ON "LoginAttempt"("userId", "at");
CREATE INDEX "LoginAttempt_username_at_idx" ON "LoginAttempt"("username", "at");
CREATE INDEX "LoginAttempt_result_at_idx" ON "LoginAttempt"("result", "at");

ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
