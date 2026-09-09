-- CCTQ 渠道必须关联到实际存在的唯一全局账户。
-- 旧 cctq_account 可能从未写入 singleton 行，因此不能假设 supplier_accounts.id = 1 存在。

INSERT INTO supplier_accounts (
  code, supplierId, adapterCode, name, credentialEncrypted, enabled, routingEnabled,
  syncIntervalMinutes, externalAccountId, displayName, accountGroup, quotaAvailableRaw,
  quotaUsedRaw, requestCount, last30dQuotaRaw, rpm, tpm, quotaDisplayType, quotaPerUnit,
  usdExchangeRate, billingPreference, subscriptions, `groups`, models, lastSyncStatus,
  lastAttemptAt, lastSyncAt, lastErrorCode, lastErrorMessage, createdAt, updatedAt
)
SELECT
  'cctq-global', 6, 'cctq', 'CCTQ 全局账户', dashboardTokenEncrypted, enabled, 1,
  syncIntervalMinutes, upstreamAccountId, displayName, accountGroup, quotaAvailableRaw,
  quotaUsedRaw, requestCount, last30dQuotaRaw, rpm, tpm, quotaDisplayType, quotaPerUnit,
  usdExchangeRate, billingPreference, subscriptions, `groups`, models, lastSyncStatus,
  lastAttemptAt, lastSyncAt, lastErrorCode, lastErrorMessage, createdAt, updatedAt
FROM cctq_account
WHERE id = 1
  AND NOT EXISTS (SELECT 1 FROM supplier_accounts WHERE code = 'cctq-global');

INSERT INTO supplier_accounts (
  code, supplierId, adapterCode, name, credentialEncrypted, enabled, routingEnabled,
  syncIntervalMinutes, quotaDisplayType, quotaPerUnit, usdExchangeRate, lastSyncStatus
)
SELECT
  'cctq-global', 6, 'cctq', 'CCTQ 全局账户', NULL, 0, 1,
  10, 'CNY', 500000, 1, 'unconfigured'
WHERE NOT EXISTS (SELECT 1 FROM supplier_accounts WHERE code = 'cctq-global');

UPDATE channels AS channel_row
JOIN supplier_accounts AS account_row ON account_row.code = 'cctq-global'
SET channel_row.supplierAccountId = account_row.id
WHERE LOWER(channel_row.baseUrl) LIKE '%cctq.ai%';
