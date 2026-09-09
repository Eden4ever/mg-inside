-- 模型峰谷计价与请求实际报价快照。
-- 所有变更均幂等，可安全重复执行。

SET @has_pricing_mode = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'pricingMode'
);
SET @sql = IF(@has_pricing_mode = 0,
  "ALTER TABLE model_configs ADD COLUMN pricingMode VARCHAR(32) NOT NULL DEFAULT 'fixed' AFTER outputPrice",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_peak_input = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'peakInputPrice'
);
SET @sql = IF(@has_peak_input = 0,
  'ALTER TABLE model_configs ADD COLUMN peakInputPrice DOUBLE NOT NULL DEFAULT 0 AFTER pricingMode',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_peak_cache = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'peakCachePrice'
);
SET @sql = IF(@has_peak_cache = 0,
  'ALTER TABLE model_configs ADD COLUMN peakCachePrice DOUBLE NOT NULL DEFAULT 0 AFTER peakInputPrice',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_peak_output = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'peakOutputPrice'
);
SET @sql = IF(@has_peak_output = 0,
  'ALTER TABLE model_configs ADD COLUMN peakOutputPrice DOUBLE NOT NULL DEFAULT 0 AFTER peakCachePrice',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_pricing_tier = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_logs' AND COLUMN_NAME = 'pricingTier'
);
SET @sql = IF(@has_pricing_tier = 0,
  "ALTER TABLE request_logs ADD COLUMN pricingTier VARCHAR(16) NOT NULL DEFAULT 'fixed' AFTER costYuan",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_applied_input = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_logs' AND COLUMN_NAME = 'appliedInputPrice'
);
SET @sql = IF(@has_applied_input = 0,
  'ALTER TABLE request_logs ADD COLUMN appliedInputPrice DOUBLE NOT NULL DEFAULT 0 AFTER pricingTier',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_applied_cache = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_logs' AND COLUMN_NAME = 'appliedCachePrice'
);
SET @sql = IF(@has_applied_cache = 0,
  'ALTER TABLE request_logs ADD COLUMN appliedCachePrice DOUBLE NOT NULL DEFAULT 0 AFTER appliedInputPrice',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_applied_output = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_logs' AND COLUMN_NAME = 'appliedOutputPrice'
);
SET @sql = IF(@has_applied_output = 0,
  'ALTER TABLE request_logs ADD COLUMN appliedOutputPrice DOUBLE NOT NULL DEFAULT 0 AFTER appliedCachePrice',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
