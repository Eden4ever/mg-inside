-- 模型缓存价格与缓存命中 token 记录迁移
-- 所有变更均幂等，可安全重复执行。

SET @has_model_cache_price = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'cachePrice'
);
SET @add_model_cache_price_sql = IF(
  @has_model_cache_price = 0,
  'ALTER TABLE model_configs ADD COLUMN cachePrice DOUBLE NOT NULL DEFAULT 0 AFTER inputPrice',
  'SELECT 1'
);
PREPARE add_model_cache_price_stmt FROM @add_model_cache_price_sql;
EXECUTE add_model_cache_price_stmt;
DEALLOCATE PREPARE add_model_cache_price_stmt;

SET @has_cached_tokens = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'request_logs' AND COLUMN_NAME = 'cachedTokens'
);
SET @add_cached_tokens_sql = IF(
  @has_cached_tokens = 0,
  'ALTER TABLE request_logs ADD COLUMN cachedTokens INT NOT NULL DEFAULT 0 AFTER promptTokens',
  'SELECT 1'
);
PREPARE add_cached_tokens_stmt FROM @add_cached_tokens_sql;
EXECUTE add_cached_tokens_stmt;
DEALLOCATE PREPARE add_cached_tokens_stmt;
