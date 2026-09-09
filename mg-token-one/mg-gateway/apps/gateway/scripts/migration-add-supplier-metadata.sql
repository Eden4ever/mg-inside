-- 模型所有者、供应商、通用供应商账户及兼容关联字段。
-- 旧 CCTQ 表暂时保留，数据复制后由通用表承接后续写入。

CREATE TABLE IF NOT EXISTS model_owners (
  id INT NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  website VARCHAR(255) NULL,
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_owners_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id INT NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'third_party',
  website VARCHAR(255) NULL,
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_suppliers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO model_owners (id, code, name, website, status) VALUES
  (1, 'openai', 'OpenAI', 'https://openai.com', 1),
  (2, 'anthropic', 'Anthropic', 'https://www.anthropic.com', 1),
  (3, 'deepseek', 'DeepSeek', 'https://www.deepseek.com', 1),
  (4, 'minimax', 'MiniMax', 'https://www.minimaxi.com', 1),
  (5, 'moonshot', 'Moonshot AI', 'https://www.moonshot.cn', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), website = VALUES(website), status = VALUES(status);

INSERT INTO suppliers (id, code, name, kind, website, status) VALUES
  (1, 'openai', 'OpenAI 官方', 'official', 'https://platform.openai.com', 1),
  (2, 'anthropic', 'Anthropic 官方', 'official', 'https://console.anthropic.com', 1),
  (3, 'deepseek', 'DeepSeek 官方', 'official', 'https://platform.deepseek.com', 1),
  (4, 'minimax', 'MiniMax 官方', 'official', 'https://platform.minimaxi.com', 1),
  (5, 'moonshot', 'Moonshot AI 官方', 'official', 'https://platform.moonshot.cn', 1),
  (6, 'cctq', 'CCTQ', 'third_party', 'https://www.cctq.ai', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), website = VALUES(website), status = VALUES(status);

CREATE TABLE IF NOT EXISTS supplier_accounts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  supplierId INT NOT NULL,
  adapterCode VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  credentialEncrypted TEXT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  syncIntervalMinutes INT NOT NULL DEFAULT 10,
  externalAccountId BIGINT NULL,
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
  UNIQUE KEY uq_supplier_accounts_code (code),
  UNIQUE KEY uq_supplier_accounts_supplier_adapter (supplierId, adapterCode),
  KEY idx_supplier_accounts_supplierId (supplierId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO supplier_accounts (
  id, code, supplierId, adapterCode, name, credentialEncrypted, enabled, syncIntervalMinutes,
  externalAccountId, displayName, accountGroup, quotaAvailableRaw, quotaUsedRaw, requestCount,
  last30dQuotaRaw, rpm, tpm, quotaDisplayType, quotaPerUnit, usdExchangeRate,
  billingPreference, subscriptions, `groups`, models, lastSyncStatus, lastAttemptAt, lastSyncAt,
  lastErrorCode, lastErrorMessage, createdAt, updatedAt
)
SELECT
  1, 'cctq-global', 6, 'cctq', 'CCTQ 全局账户', dashboardTokenEncrypted, enabled, syncIntervalMinutes,
  upstreamAccountId, displayName, accountGroup, quotaAvailableRaw, quotaUsedRaw, requestCount,
  last30dQuotaRaw, rpm, tpm, quotaDisplayType, quotaPerUnit, usdExchangeRate,
  billingPreference, subscriptions, `groups`, models, lastSyncStatus, lastAttemptAt, lastSyncAt,
  lastErrorCode, lastErrorMessage, createdAt, updatedAt
FROM cctq_account WHERE id = 1;

CREATE TABLE IF NOT EXISTS supplier_account_snapshots (
  id BIGINT NOT NULL AUTO_INCREMENT,
  supplierAccountId BIGINT NOT NULL,
  quotaAvailableRaw BIGINT NOT NULL,
  quotaUsedRaw BIGINT NOT NULL,
  requestCount BIGINT NOT NULL,
  last30dQuotaRaw BIGINT NOT NULL,
  capturedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_supplier_account_snapshots_account (supplierAccountId),
  KEY idx_supplier_account_snapshots_capturedAt (capturedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO supplier_account_snapshots (
  id, supplierAccountId, quotaAvailableRaw, quotaUsedRaw, requestCount, last30dQuotaRaw, capturedAt
)
SELECT id, 1, quotaAvailableRaw, quotaUsedRaw, requestCount, last30dQuotaRaw, capturedAt
FROM cctq_account_snapshots;

SET @has_model_owner_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_configs' AND COLUMN_NAME = 'modelOwnerId'
);
SET @sql = IF(@has_model_owner_id = 0,
  'ALTER TABLE model_configs ADD COLUMN modelOwnerId INT NULL AFTER name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_supplier_account_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channels' AND COLUMN_NAME = 'supplierAccountId'
);
SET @sql = IF(@has_supplier_account_id = 0,
  'ALTER TABLE channels ADD COLUMN supplierAccountId BIGINT NULL AFTER name',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE model_configs SET modelOwnerId = 1
WHERE modelOwnerId IS NULL AND (LOWER(name) LIKE 'gpt-%' OR LOWER(name) LIKE 'codex-%');
UPDATE model_configs SET modelOwnerId = 2
WHERE modelOwnerId IS NULL AND LOWER(name) LIKE 'claude-%';
UPDATE model_configs SET modelOwnerId = 3
WHERE modelOwnerId IS NULL AND LOWER(name) LIKE 'deepseek-%';
UPDATE model_configs SET modelOwnerId = 4
WHERE modelOwnerId IS NULL AND LOWER(name) LIKE 'minimax-%';
UPDATE model_configs SET modelOwnerId = 5
WHERE modelOwnerId IS NULL AND LOWER(name) LIKE 'kimi%';

UPDATE channels SET supplierAccountId = 1
WHERE supplierAccountId IS NULL AND LOWER(baseUrl) LIKE '%cctq.ai%';
