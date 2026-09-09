-- 请求日志增加原生协议维度。历史记录产生于 Responses 接入前，默认归为 chat。

SET @has_request_protocol = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'request_logs'
    AND COLUMN_NAME = 'protocol'
);
SET @add_request_protocol_sql = IF(
  @has_request_protocol = 0,
  'ALTER TABLE request_logs ADD COLUMN protocol VARCHAR(20) NOT NULL DEFAULT ''chat'' AFTER model',
  'SELECT 1'
);
PREPARE add_request_protocol_stmt FROM @add_request_protocol_sql;
EXECUTE add_request_protocol_stmt;
DEALLOCATE PREPARE add_request_protocol_stmt;

SET @has_request_protocol_index = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'request_logs'
    AND INDEX_NAME = 'IDX_request_logs_protocol'
);
SET @add_request_protocol_index_sql = IF(
  @has_request_protocol_index = 0,
  'CREATE INDEX IDX_request_logs_protocol ON request_logs (protocol)',
  'SELECT 1'
);
PREPARE add_request_protocol_index_stmt FROM @add_request_protocol_index_sql;
EXECUTE add_request_protocol_index_stmt;
DEALLOCATE PREPARE add_request_protocol_index_stmt;
