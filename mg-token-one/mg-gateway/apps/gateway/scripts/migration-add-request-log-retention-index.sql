-- Retention batches seek by (createdAt, id), matching DELETE's deterministic
-- ORDER BY. Require this exact leading column sequence before treating an
-- existing index as equivalent.
SET @has_request_logs_retention_index = (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'request_logs'
    GROUP BY INDEX_NAME
    HAVING COUNT(*) = 2
      AND MAX(CASE WHEN SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'createdAt' THEN 1 ELSE 0 END) = 1
      AND MAX(CASE WHEN SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'id' THEN 1 ELSE 0 END) = 1
  ) AS matching_indexes
);
SET @add_request_logs_retention_index_sql = IF(
  @has_request_logs_retention_index = 0,
  'CREATE INDEX IDX_request_logs_retention_created_at_id ON request_logs (createdAt, id)',
  'SELECT 1'
);
PREPARE add_request_logs_retention_index_stmt FROM @add_request_logs_retention_index_sql;
EXECUTE add_request_logs_retention_index_stmt;
DEALLOCATE PREPARE add_request_logs_retention_index_stmt;
