-- CCTQ API Key 的额度状态独立于通用余额数值：无限额、到期和模型限制均需保留原始语义。

SET @has_unlimited_quota = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_accounts' AND COLUMN_NAME = 'unlimitedQuota'
);
SET @sql = IF(@has_unlimited_quota = 0,
  'ALTER TABLE supplier_accounts ADD COLUMN unlimitedQuota TINYINT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_expires_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_accounts' AND COLUMN_NAME = 'expiresAt'
);
SET @sql = IF(@has_expires_at = 0,
  'ALTER TABLE supplier_accounts ADD COLUMN expiresAt BIGINT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_model_limits = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_accounts' AND COLUMN_NAME = 'modelLimits'
);
SET @sql = IF(@has_model_limits = 0,
  'ALTER TABLE supplier_accounts ADD COLUMN modelLimits JSON NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_model_limits_enabled = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_accounts' AND COLUMN_NAME = 'modelLimitsEnabled'
);
SET @sql = IF(@has_model_limits_enabled = 0,
  'ALTER TABLE supplier_accounts ADD COLUMN modelLimitsEnabled TINYINT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE supplier_accounts
SET unlimitedQuota = 0
WHERE unlimitedQuota IS NULL;

UPDATE supplier_accounts
SET expiresAt = 0
WHERE expiresAt IS NULL OR expiresAt < 0;

UPDATE supplier_accounts
SET modelLimitsEnabled = 0
WHERE modelLimitsEnabled IS NULL;
