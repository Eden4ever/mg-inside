-- Strict health state belongs to (channel, stable model identity, protocol).
-- Do not backfill from channels: a channel-level historical success does not prove
-- that a particular model/protocol path has ever succeeded.

CREATE TABLE IF NOT EXISTS channel_route_health (
  id INT NOT NULL AUTO_INCREMENT,
  channelId INT NOT NULL,
  modelIdentity VARCHAR(191) NOT NULL,
  modelName VARCHAR(100) NOT NULL,
  protocol VARCHAR(20) NOT NULL,
  consecutiveErrors INT NOT NULL DEFAULT 0,
  disabledUntil BIGINT NULL,
  totalRequests INT NOT NULL DEFAULT 0,
  failedRequests INT NOT NULL DEFAULT 0,
  lastSuccessAt DATETIME(6) NULL,
  lastFailureAt DATETIME(6) NULL,
  lastOutcomeAt DATETIME(6) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_route_health_path (channelId, modelIdentity, protocol),
  KEY idx_channel_route_health_channel (channelId),
  KEY idx_channel_route_health_disabled (disabledUntil)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
