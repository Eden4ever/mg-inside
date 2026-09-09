-- 显式模型路由：model_routes 是模型与渠道多对多关系的权威存储。
-- model_configs.bindings 继续双写，供旧镜像回滚兼容。

CREATE TABLE IF NOT EXISTS model_routes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  modelId INT NOT NULL,
  channelId INT NOT NULL,
  upstreamModel VARCHAR(100) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  weight INT NOT NULL DEFAULT 1,
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_routes_model_channel (modelId, channelId),
  KEY idx_model_routes_model (modelId),
  KEY idx_model_routes_channel (channelId),
  CONSTRAINT fk_model_routes_model FOREIGN KEY (modelId) REFERENCES model_configs(id) ON DELETE CASCADE,
  CONSTRAINT fk_model_routes_channel FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO model_routes (modelId, channelId, upstreamModel, priority, weight, status)
SELECT
  model.id,
  route.channelId,
  route.upstreamModel,
  COALESCE(route.priority, 0),
  COALESCE(route.weight, channel.weight, 1),
  COALESCE(route.status, 1)
FROM model_configs AS model
JOIN JSON_TABLE(
  COALESCE(model.bindings, JSON_ARRAY()),
  '$[*]' COLUMNS (
    channelId INT PATH '$.channelId',
    upstreamModel VARCHAR(100) PATH '$.upstreamModel',
    priority INT PATH '$.priority' NULL ON EMPTY,
    weight INT PATH '$.weight' NULL ON EMPTY,
    status TINYINT PATH '$.status' NULL ON EMPTY
  )
) AS route
JOIN channels AS channel ON channel.id = route.channelId
WHERE route.channelId IS NOT NULL AND route.upstreamModel IS NOT NULL
ON DUPLICATE KEY UPDATE
  upstreamModel = VALUES(upstreamModel),
  priority = VALUES(priority),
  weight = VALUES(weight),
  status = VALUES(status);
