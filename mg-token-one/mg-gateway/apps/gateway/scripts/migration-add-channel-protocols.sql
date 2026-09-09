-- Token One 渠道多协议能力迁移
-- 旧 protocol 列继续保留；protocols 是新的权威能力集合。

SET @has_protocols = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'protocols'
);
SET @add_protocols_sql = IF(
  @has_protocols = 0,
  'ALTER TABLE channels ADD COLUMN protocols JSON NULL AFTER protocol',
  'SELECT 1'
);
PREPARE add_protocols_stmt FROM @add_protocols_sql;
EXECUTE add_protocols_stmt;
DEALLOCATE PREPARE add_protocols_stmt;

UPDATE channels
SET protocols = JSON_ARRAY(COALESCE(NULLIF(protocol, ''), 'chat'))
WHERE protocols IS NULL OR JSON_LENGTH(protocols) = 0;

-- CCTQ 是否启用双协议必须以两个真实端点测试结果为准，不能在迁移中盲目开启。
-- 验证通过后执行：
-- UPDATE channels SET protocol = 'chat', protocols = JSON_ARRAY('chat', 'responses')
-- WHERE name = 'CCTQ-Codex';
-- UPDATE model_configs SET supportsResponses = 1
-- WHERE name IN ('gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra');
