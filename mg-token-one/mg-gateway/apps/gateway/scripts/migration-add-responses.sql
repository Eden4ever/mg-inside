-- mg-gateway Responses API 支持迁移
-- 执行时间: 2026-08-18

-- 1. channels 表新增 protocol 字段（上游协议格式）
SET @has_protocol = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channels' AND COLUMN_NAME = 'protocol'
);
SET @add_protocol_sql = IF(
  @has_protocol = 0,
  'ALTER TABLE channels ADD COLUMN protocol VARCHAR(20) NOT NULL DEFAULT ''chat'' AFTER type',
  'SELECT 1'
);
PREPARE add_protocol_stmt FROM @add_protocol_sql;
EXECUTE add_protocol_stmt;
DEALLOCATE PREPARE add_protocol_stmt;

-- 备注：现有渠道默认使用 'chat'（Chat Completions 协议）
-- 如果某个渠道原生支持 Responses API，可手动更新为 'responses'
-- UPDATE channels SET protocol = 'responses' WHERE name = 'OpenAI-Official';

-- 2. model_configs 表新增 supportsResponses 字段
SET @has_responses = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'supportsResponses'
);
SET @add_responses_sql = IF(
  @has_responses = 0,
  'ALTER TABLE model_configs ADD COLUMN supportsResponses TINYINT NOT NULL DEFAULT 0 AFTER supportsReasoning',
  'SELECT 1'
);
PREPARE add_responses_stmt FROM @add_responses_sql;
EXECUTE add_responses_stmt;
DEALLOCATE PREPARE add_responses_stmt;

-- 3. 可选：为 Codex 相关模型标记支持 Responses API
-- UPDATE model_configs SET supportsResponses = 1 WHERE name LIKE 'codex%';
