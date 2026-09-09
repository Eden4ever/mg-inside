-- 同一供应商可通过同一适配器配置多个账户，由 code 作为账户唯一标识。

SET @has_unique_supplier_adapter = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'supplier_accounts'
    AND INDEX_NAME = 'uq_supplier_accounts_supplier_adapter'
    AND NON_UNIQUE = 0
);
SET @sql = IF(@has_unique_supplier_adapter > 0,
  'ALTER TABLE supplier_accounts DROP INDEX uq_supplier_accounts_supplier_adapter',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_supplier_adapter_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'supplier_accounts'
    AND INDEX_NAME = 'idx_supplier_accounts_supplier_adapter'
);
SET @sql = IF(@has_supplier_adapter_index = 0,
  'CREATE INDEX idx_supplier_accounts_supplier_adapter ON supplier_accounts (supplierId, adapterCode)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
