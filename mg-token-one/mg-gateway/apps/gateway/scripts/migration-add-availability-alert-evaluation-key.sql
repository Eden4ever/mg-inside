-- 跨实例评估按 UTC 分钟桶幂等，避免同一分钟重复推进恢复计数。

SET @has_availability_alert_evaluation_key = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'availability_alert_states'
    AND COLUMN_NAME = 'lastEvaluationKey'
);
SET @add_availability_alert_evaluation_key_sql = IF(
  @has_availability_alert_evaluation_key = 0,
  'ALTER TABLE availability_alert_states ADD COLUMN lastEvaluationKey VARCHAR(32) NULL AFTER consecutiveHealthyWindows',
  'SELECT 1'
);
PREPARE add_availability_alert_evaluation_key_stmt
  FROM @add_availability_alert_evaluation_key_sql;
EXECUTE add_availability_alert_evaluation_key_stmt;
DEALLOCATE PREPARE add_availability_alert_evaluation_key_stmt;
