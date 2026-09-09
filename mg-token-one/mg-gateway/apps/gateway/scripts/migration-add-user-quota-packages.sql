-- 单用户额度包：固定包每月生效，临时包仅对指定自然月生效。

SET @has_fixed_monthly_quota = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'fixedMonthlyQuota'
);
SET @sql = IF(
  @has_fixed_monthly_quota = 0,
  'ALTER TABLE users ADD COLUMN fixedMonthlyQuota DECIMAL(14,6) NOT NULL DEFAULT 0 AFTER quotaUsed',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_temporary_monthly_quota = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_monthly_quotas'
    AND COLUMN_NAME = 'temporaryMonthlyQuota'
);
SET @sql = IF(
  @has_temporary_monthly_quota = 0,
  'ALTER TABLE user_monthly_quotas ADD COLUMN temporaryMonthlyQuota DECIMAL(14,6) NOT NULL DEFAULT 0 AFTER quotaUsed',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
