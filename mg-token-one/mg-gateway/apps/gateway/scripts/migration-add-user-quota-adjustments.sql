-- 用户额度调整审计：额度变更与审计记录在同一事务内写入。

CREATE TABLE IF NOT EXISTS user_quota_adjustments (
  id BIGINT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  username VARCHAR(64) NOT NULL,
  operatorUserId INT NULL,
  operatorUsername VARCHAR(64) NOT NULL,
  period VARCHAR(7) NOT NULL,
  fixedQuotaBefore DECIMAL(14,6) NOT NULL DEFAULT 0,
  fixedQuotaAfter DECIMAL(14,6) NOT NULL DEFAULT 0,
  temporaryQuotaBefore DECIMAL(14,6) NOT NULL DEFAULT 0,
  temporaryQuotaAfter DECIMAL(14,6) NOT NULL DEFAULT 0,
  reason VARCHAR(255) NOT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_user_quota_adjustments_user_id (userId),
  KEY idx_user_quota_adjustments_created_at (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
