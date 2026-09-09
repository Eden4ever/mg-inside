-- 单一 CCTQ 全局账户配置、当前快照与历史快照。

CREATE TABLE IF NOT EXISTS cctq_account (
  id TINYINT NOT NULL DEFAULT 1,
  dashboardTokenEncrypted TEXT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  syncIntervalMinutes INT NOT NULL DEFAULT 10,
  upstreamAccountId BIGINT NULL,
  displayName VARCHAR(100) NULL,
  accountGroup VARCHAR(100) NULL,
  quotaAvailableRaw BIGINT NULL,
  quotaUsedRaw BIGINT NULL,
  requestCount BIGINT NULL,
  last30dQuotaRaw BIGINT NULL,
  rpm INT NULL,
  tpm BIGINT NULL,
  quotaDisplayType VARCHAR(16) NOT NULL DEFAULT 'CNY',
  quotaPerUnit BIGINT NOT NULL DEFAULT 500000,
  usdExchangeRate DOUBLE NOT NULL DEFAULT 1,
  billingPreference VARCHAR(64) NULL,
  subscriptions JSON NULL,
  `groups` JSON NULL,
  models JSON NULL,
  lastSyncStatus VARCHAR(32) NOT NULL DEFAULT 'unconfigured',
  lastAttemptAt DATETIME NULL,
  lastSyncAt DATETIME NULL,
  lastErrorCode VARCHAR(64) NULL,
  lastErrorMessage VARCHAR(255) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT chk_cctq_account_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cctq_account_snapshots (
  id BIGINT NOT NULL AUTO_INCREMENT,
  quotaAvailableRaw BIGINT NOT NULL,
  quotaUsedRaw BIGINT NOT NULL,
  requestCount BIGINT NOT NULL,
  last30dQuotaRaw BIGINT NOT NULL,
  capturedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  INDEX idx_cctq_account_snapshots_capturedAt (capturedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
