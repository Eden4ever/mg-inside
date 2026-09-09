CREATE TABLE "WeComIdentityRevocation" (
    "corpId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeComIdentityRevocation_pkey" PRIMARY KEY ("corpId", "externalUserId")
);

-- 保留既往明确解绑的身份；已显式重新绑定的身份不受影响。
WITH unbound AS (
SELECT a."detail"->>'corpId' AS "corpId", a."detail"->>'externalUserId' AS "externalUserId", MAX(a."at") AS "revokedAt"
FROM "AuditLog" a
WHERE a."action" = 'user.wecom_unbound'
  AND jsonb_typeof(a."detail"->'corpId') = 'string'
  AND jsonb_typeof(a."detail"->'externalUserId') = 'string'
GROUP BY a."detail"->>'corpId', a."detail"->>'externalUserId'
)
INSERT INTO "WeComIdentityRevocation" ("corpId", "externalUserId", "revokedAt")
SELECT u."corpId", u."externalUserId", u."revokedAt" FROM unbound u
WHERE NOT EXISTS (
  SELECT 1 FROM "AuditLog" b
  WHERE b."action" = 'user.wecom_bound'
    AND b."detail"->>'corpId' = u."corpId"
    AND b."detail"->>'externalUserId' = u."externalUserId"
    AND b."at" > u."revokedAt"
);

-- 旧同步曾按用户名自动绑定本地账号。缺少对应用户的显式绑定凭据时，
-- 无法安全区分误绑定与人工导入，要求管理员重新确认，保留本地账号及业务数据。
INSERT INTO "WeComIdentityRevocation" ("corpId", "externalUserId", "revokedAt")
SELECT i."corpId", i."externalUserId", CURRENT_TIMESTAMP
FROM "WeComIdentity" i JOIN "User" u ON u."id" = i."userId"
WHERE (u."authSource" = 'local' OR u."passwordHash" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "AuditLog" a
    WHERE a."action" = 'user.wecom_bound' AND a."targetType" = 'User'
      AND a."targetId" = i."userId"
      AND a."detail"->>'corpId' = i."corpId"
      AND a."detail"->>'externalUserId' = i."externalUserId"
      AND a."at" >= i."boundAt"
  )
ON CONFLICT ("corpId", "externalUserId") DO NOTHING;

-- 撤销可疑身份的全部会话和绑定，阻止同步自动恢复；显式重新绑定可以解除阻断。
UPDATE "AuthSession" s SET "revokedAt" = CURRENT_TIMESTAMP
FROM "WeComIdentity" i, "WeComIdentityRevocation" r
WHERE s."userId" = i."userId" AND s."revokedAt" IS NULL
  AND i."corpId" = r."corpId" AND i."externalUserId" = r."externalUserId";
DELETE FROM "WeComIdentity" i USING "WeComIdentityRevocation" r
WHERE i."corpId" = r."corpId" AND i."externalUserId" = r."externalUserId";
