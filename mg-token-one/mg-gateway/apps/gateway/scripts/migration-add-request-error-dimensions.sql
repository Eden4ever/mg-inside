-- 为实时可用性监控保留稳定错误码和 HTTP 状态维度。
-- 历史日志无法从自由文本可靠还原，保持 NULL，避免错误回填。

SET @has_request_error_code = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'request_logs'
    AND COLUMN_NAME = 'errorCode'
);
SET @add_request_error_code_sql = IF(
  @has_request_error_code = 0,
  'ALTER TABLE request_logs ADD COLUMN errorCode VARCHAR(64) NULL AFTER errorMessage',
  'SELECT 1'
);
PREPARE add_request_error_code_stmt FROM @add_request_error_code_sql;
EXECUTE add_request_error_code_stmt;
DEALLOCATE PREPARE add_request_error_code_stmt;

SET @has_request_response_status = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'request_logs'
    AND COLUMN_NAME = 'responseStatus'
);
SET @add_request_response_status_sql = IF(
  @has_request_response_status = 0,
  'ALTER TABLE request_logs ADD COLUMN responseStatus SMALLINT NULL AFTER errorCode',
  'SELECT 1'
);
PREPARE add_request_response_status_stmt FROM @add_request_response_status_sql;
EXECUTE add_request_response_status_stmt;
DEALLOCATE PREPARE add_request_response_status_stmt;

SET @has_request_error_code_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'request_logs'
    AND INDEX_NAME = 'IDX_request_logs_error_code_created_at'
);
SET @add_request_error_code_index_sql = IF(
  @has_request_error_code_index = 0,
  'CREATE INDEX IDX_request_logs_error_code_created_at ON request_logs (errorCode, createdAt)',
  'SELECT 1'
);
PREPARE add_request_error_code_index_stmt FROM @add_request_error_code_index_sql;
EXECUTE add_request_error_code_index_stmt;
DEALLOCATE PREPARE add_request_error_code_index_stmt;

SET @has_request_availability_index = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'request_logs'
    AND INDEX_NAME = 'IDX_request_logs_availability_window'
);
SET @add_request_availability_index_sql = IF(
  @has_request_availability_index = 0,
  'CREATE INDEX IDX_request_logs_availability_window ON request_logs (protocol, model, channelId, createdAt)',
  'SELECT 1'
);
PREPARE add_request_availability_index_stmt FROM @add_request_availability_index_sql;
EXECUTE add_request_availability_index_stmt;
DEALLOCATE PREPARE add_request_availability_index_stmt;
