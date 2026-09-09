CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "authSource" TEXT, "passwordHash" TEXT);
CREATE TABLE "WeComIdentity" ("userId" TEXT, "corpId" TEXT, "externalUserId" TEXT, "boundAt" TIMESTAMP);
CREATE TABLE "AuditLog" ("action" TEXT, "targetType" TEXT, "targetId" TEXT, "detail" JSONB, "at" TIMESTAMP);
CREATE TABLE "AuthSession" ("userId" TEXT, "revokedAt" TIMESTAMP);
INSERT INTO "User" VALUES
 ('unsafe', 'local', 'hash'), ('explicit', 'local', 'hash'),
 ('directory', 'wecom', NULL), ('unbound', 'wecom', NULL),
 ('rebound', 'local', 'hash'), ('wrong-target', 'local', 'hash');
INSERT INTO "WeComIdentity"
 SELECT "id", 'corp', "id", '2026-01-01'::timestamp FROM "User";
INSERT INTO "AuthSession" SELECT "id", NULL FROM "User";
INSERT INTO "AuditLog" VALUES
 ('user.wecom_bound', 'User', 'explicit', '{"corpId":"corp","externalUserId":"explicit"}', '2026-01-02'),
 ('user.wecom_unbound', 'User', 'unbound', '{"corpId":"corp","externalUserId":"unbound"}', '2026-01-02'),
 ('user.wecom_unbound', 'User', 'rebound', '{"corpId":"corp","externalUserId":"rebound"}', '2026-01-02'),
 ('user.wecom_bound', 'User', 'rebound', '{"corpId":"corp","externalUserId":"rebound"}', '2026-01-03'),
 ('user.wecom_bound', 'User', 'different-user', '{"corpId":"corp","externalUserId":"wrong-target"}', '2026-01-03');
-- APPLY_MIGRATION
DO $$
BEGIN
 IF (SELECT count(*) FROM "User") <> 6 THEN RAISE EXCEPTION '用户数据不应删除'; END IF;
 IF (SELECT array_agg("userId" ORDER BY "userId") FROM "WeComIdentity")
    IS DISTINCT FROM ARRAY['directory', 'explicit', 'rebound'] THEN RAISE EXCEPTION '绑定保留范围错误'; END IF;
 IF (SELECT array_agg("userId" ORDER BY "userId") FROM "AuthSession" WHERE "revokedAt" IS NOT NULL)
    IS DISTINCT FROM ARRAY['unbound', 'unsafe', 'wrong-target'] THEN RAISE EXCEPTION '会话撤销范围错误'; END IF;
 IF (SELECT array_agg("externalUserId" ORDER BY "externalUserId") FROM "WeComIdentityRevocation")
    IS DISTINCT FROM ARRAY['unbound', 'unsafe', 'wrong-target'] THEN RAISE EXCEPTION '阻断恢复范围错误'; END IF;
END $$;
