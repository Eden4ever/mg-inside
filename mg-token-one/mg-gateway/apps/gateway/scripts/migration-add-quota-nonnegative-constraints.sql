-- 月度额度不能为负。先修复历史数据，再按命名约束幂等添加 MySQL 8 CHECK。

SET @has_users_fixed_monthly_quota = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'fixedMonthlyQuota'
);
SET @sql = IF(
  @has_users_fixed_monthly_quota = 1,
  'UPDATE `users` SET `fixedMonthlyQuota` = 0 WHERE `fixedMonthlyQuota` < 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_monthly_quota_used = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_monthly_quotas'
    AND COLUMN_NAME = 'quotaUsed'
);
SET @sql = IF(
  @has_monthly_quota_used = 1,
  'UPDATE `user_monthly_quotas` SET `quotaUsed` = 0 WHERE `quotaUsed` < 0',
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
  @has_temporary_monthly_quota = 1,
  'UPDATE `user_monthly_quotas` SET `temporaryMonthlyQuota` = 0 WHERE `temporaryMonthlyQuota` < 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- groups.monthlyQuota 也直接参与有效额度计算；NULL 保持为历史初始化兼容值。
SET @has_group_monthly_quota = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'groups'
    AND COLUMN_NAME = 'monthlyQuota'
);
SET @sql = IF(
  @has_group_monthly_quota = 1,
  'UPDATE `groups` SET `monthlyQuota` = 0 WHERE `monthlyQuota` IS NOT NULL AND `monthlyQuota` < 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_constraint = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'chk_users_fixed_monthly_quota_nonnegative'
    AND CONSTRAINT_TYPE = 'CHECK'
);
SET @sql = IF(
  @has_users_fixed_monthly_quota = 1 AND @has_constraint = 0,
  'ALTER TABLE `users` ADD CONSTRAINT `chk_users_fixed_monthly_quota_nonnegative` CHECK (`fixedMonthlyQuota` >= 0)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_constraint = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_monthly_quotas'
    AND CONSTRAINT_NAME = 'chk_user_monthly_quotas_quota_used_nonnegative'
    AND CONSTRAINT_TYPE = 'CHECK'
);
SET @sql = IF(
  @has_monthly_quota_used = 1 AND @has_constraint = 0,
  'ALTER TABLE `user_monthly_quotas` ADD CONSTRAINT `chk_user_monthly_quotas_quota_used_nonnegative` CHECK (`quotaUsed` >= 0)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_constraint = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_monthly_quotas'
    AND CONSTRAINT_NAME = 'chk_user_monthly_quotas_temporary_quota_nonnegative'
    AND CONSTRAINT_TYPE = 'CHECK'
);
SET @sql = IF(
  @has_temporary_monthly_quota = 1 AND @has_constraint = 0,
  'ALTER TABLE `user_monthly_quotas` ADD CONSTRAINT `chk_user_monthly_quotas_temporary_quota_nonnegative` CHECK (`temporaryMonthlyQuota` >= 0)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_constraint = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'groups'
    AND CONSTRAINT_NAME = 'chk_groups_monthly_quota_nonnegative'
    AND CONSTRAINT_TYPE = 'CHECK'
);
SET @sql = IF(
  @has_group_monthly_quota = 1 AND @has_constraint = 0,
  'ALTER TABLE `groups` ADD CONSTRAINT `chk_groups_monthly_quota_nonnegative` CHECK (`monthlyQuota` IS NULL OR `monthlyQuota` >= 0)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
