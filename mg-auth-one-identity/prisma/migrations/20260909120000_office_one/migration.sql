-- Office One 为需显式授权的内部应用，不加入基础应用豁免。
INSERT INTO "Application" ("clientId", "name", "enabled")
VALUES ('office-one', 'Office One', true)
ON CONFLICT ("clientId") DO NOTHING;
