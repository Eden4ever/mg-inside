-- 为现有官方渠道建立账户范围。凭据仍由 channels.keysEncrypted 承载；manual 表示暂无余额同步适配器。

INSERT INTO supplier_accounts (
  id, code, supplierId, adapterCode, name, credentialEncrypted, enabled, lastSyncStatus
) VALUES
  (2, 'minimax-default', 4, 'manual', 'MiniMax 默认账户', NULL, 1, 'unconfigured'),
  (3, 'moonshot-default', 5, 'manual', 'Moonshot AI 默认账户', NULL, 1, 'unconfigured'),
  (4, 'deepseek-default', 3, 'manual', 'DeepSeek 默认账户', NULL, 1, 'unconfigured')
ON DUPLICATE KEY UPDATE name = VALUES(name), enabled = VALUES(enabled);

UPDATE channels SET supplierAccountId = 2
WHERE supplierAccountId IS NULL AND LOWER(baseUrl) LIKE '%minimaxi.com%';
UPDATE channels SET supplierAccountId = 3
WHERE supplierAccountId IS NULL AND LOWER(baseUrl) LIKE '%kimi.com%';
UPDATE channels SET supplierAccountId = 4
WHERE supplierAccountId IS NULL AND LOWER(baseUrl) LIKE '%deepseek.com%';
