-- 旧版本只累计失败请求；回填最小合法总数，保证 totalRequests >= failedRequests。

UPDATE channels
SET totalRequests = failedRequests
WHERE totalRequests < failedRequests;
