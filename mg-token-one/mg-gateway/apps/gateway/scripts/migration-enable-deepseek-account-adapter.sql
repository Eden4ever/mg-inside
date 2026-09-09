-- DeepSeek 默认账户切换到官方余额适配器。渠道密钥仍保留在 channels.keysEncrypted，且不会复制为账户凭据。

UPDATE supplier_accounts
SET adapterCode = 'deepseek',
    credentialEncrypted = NULL,
    enabled = 0,
    lastSyncStatus = 'unconfigured',
    lastAttemptAt = NULL,
    lastSyncAt = NULL,
    lastErrorCode = NULL,
    lastErrorMessage = NULL
WHERE code = 'deepseek-default'
  AND adapterCode = 'manual';
