CREATE TABLE IF NOT EXISTS service_workspace (
 id integer PRIMARY KEY CHECK(id=1),
 value jsonb NOT NULL
);
INSERT INTO service_workspace(id,value) VALUES(1,'{"revision":0,"services":{},"tags":[]}'::jsonb) ON CONFLICT DO NOTHING;
-- 由数据库所有者执行；运行账号仅需本表 SELECT、UPDATE 权限。
