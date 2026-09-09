-- DeepSeek 余额接口以主币单位返回，账户快照统一按分存储。

UPDATE supplier_accounts
SET quotaDisplayType = 'CNY',
    quotaPerUnit = 100,
    usdExchangeRate = 1
WHERE code = 'deepseek-default'
  AND adapterCode = 'deepseek'
  AND lastSyncAt IS NULL;
