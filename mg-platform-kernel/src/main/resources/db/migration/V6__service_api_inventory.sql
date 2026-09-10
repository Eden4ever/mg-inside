CREATE TABLE IF NOT EXISTS service_api_inventory (
 id integer PRIMARY KEY CHECK(id=1),
 value jsonb NOT NULL
);
INSERT INTO service_api_inventory(id,value) VALUES(1,'{"revision":0,"document":{"schemaVersion":1,"categories":[],"boundaries":[],"entries":[],"gaps":[]}}'::jsonb) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS service_api_inventory_history (
 revision bigint PRIMARY KEY,
 value jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
-- 运行账号需要台账 SELECT/UPDATE 和历史 INSERT 权限；不授予 DDL 权限。
