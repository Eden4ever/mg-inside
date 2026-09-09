-- Token One 原生 Anthropic Messages 能力迁移。

SET @has_supports_anthropic = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'model_configs'
    AND COLUMN_NAME = 'supportsAnthropic'
);
SET @add_supports_anthropic_sql = IF(
  @has_supports_anthropic = 0,
  'ALTER TABLE model_configs ADD COLUMN supportsAnthropic TINYINT NOT NULL DEFAULT 0 AFTER supportsResponses',
  'SELECT 1'
);
PREPARE add_supports_anthropic_stmt FROM @add_supports_anthropic_sql;
EXECUTE add_supports_anthropic_stmt;
DEALLOCATE PREPARE add_supports_anthropic_stmt;

-- 已登记的 Anthropic-only 渠道模型标记为支持 Messages，但不改变模型启停状态。
UPDATE model_configs AS model
JOIN channels AS channel
  ON JSON_CONTAINS(
    model.bindings,
    JSON_OBJECT('channelId', channel.id),
    '$'
  )
SET model.supportsAnthropic = 1
WHERE channel.protocol = 'anthropic'
   OR JSON_CONTAINS(channel.protocols, JSON_QUOTE('anthropic'));
