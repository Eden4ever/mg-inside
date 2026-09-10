BEGIN;
ALTER TABLE desktop_applications ADD COLUMN IF NOT EXISTS runtime_policy jsonb;
-- 仅显式结构迁移转换旧行为；已有策略、启停和排序均不覆盖。
WITH previous AS (
 SELECT a.*, jsonb_build_object(
   'apiMode', 'compatibility',
   'versionOwnerAppId', CASE WHEN id IN ('token-one-console','token-one-docs') THEN 'token-one' ELSE id END,
   'rolePath', CASE WHEN id='token-one-console' THEN '/auth/me/token-one-console' ELSE '/auth/me' END,
   'rolePointer', CASE WHEN id='identity' THEN '/user/role' ELSE '/role' END,
   'allowedApiMethods', CASE WHEN id='token-one-docs' THEN '["GET","HEAD"]'::jsonb ELSE '["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]'::jsonb END
 ) AS policy FROM desktop_applications a WHERE runtime_policy IS NULL
), updated AS (
 UPDATE desktop_applications a SET runtime_policy=p.policy, revision=a.revision+1, updated_at=now()
 FROM previous p WHERE a.id=p.id
 RETURNING a.id, to_jsonb(p)-'policy' AS before_config, to_jsonb(a) AS after_config
)
INSERT INTO desktop_application_audit(application_id,action,before_config,after_config,actor)
 SELECT id,'update',before_config,after_config,'migration:application-policy' FROM updated;
ALTER TABLE desktop_applications ALTER COLUMN runtime_policy SET DEFAULT '{}'::jsonb;
ALTER TABLE desktop_applications ALTER COLUMN runtime_policy SET NOT NULL;
COMMIT;
