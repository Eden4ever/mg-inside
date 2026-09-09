-- 账户路由开关与余额同步开关分离，避免关闭同步时误停关联渠道。

SET @has_routing_enabled = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'supplier_accounts'
    AND COLUMN_NAME = 'routingEnabled'
);
SET @sql = IF(@has_routing_enabled = 0,
  'ALTER TABLE supplier_accounts ADD COLUMN routingEnabled TINYINT NOT NULL DEFAULT 1 AFTER enabled',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_routing_enabled_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'supplier_accounts'
    AND INDEX_NAME = 'idx_supplier_accounts_routing_enabled'
);
SET @sql = IF(@has_routing_enabled_index = 0,
  'CREATE INDEX idx_supplier_accounts_routing_enabled ON supplier_accounts (routingEnabled)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
