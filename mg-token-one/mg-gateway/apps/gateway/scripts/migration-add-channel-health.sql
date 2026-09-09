-- 渠道健康时间轴：保留最近一次成功和失败，便于运维判断。

SET @has_last_success_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'lastSuccessAt'
);
SET @sql = IF(
  @has_last_success_at = 0,
  'ALTER TABLE channels ADD COLUMN lastSuccessAt DATETIME(6) NULL AFTER failedRequests',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_last_failure_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'lastFailureAt'
);
SET @sql = IF(
  @has_last_failure_at = 0,
  'ALTER TABLE channels ADD COLUMN lastFailureAt DATETIME(6) NULL AFTER lastSuccessAt',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
