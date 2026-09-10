CREATE TABLE IF NOT EXISTS desktop_application_onboarding (
 application_id text PRIMARY KEY REFERENCES desktop_applications(id),
 request_id text NOT NULL UNIQUE,
 actor text NOT NULL,
 config jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','failed')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS desktop_application_icons (
 id text PRIMARY KEY,
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
WITH changed AS (
 UPDATE desktop_applications SET kind='system',revision=revision+1,updated_at=now()
 WHERE id='resource-manager' AND kind<>'system' RETURNING *
)
INSERT INTO desktop_application_audit(application_id,action,after_config,actor)
SELECT id,'update',to_jsonb(changed),'migration:resource-system' FROM changed;
