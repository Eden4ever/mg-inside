-- 可用性告警独立状态机。只记录监控状态和事件，不修改渠道、模型或路由。

CREATE TABLE IF NOT EXISTS availability_alert_states (
  id INT NOT NULL AUTO_INCREMENT,
  fingerprint VARCHAR(191) NOT NULL,
  protocol VARCHAR(20) NOT NULL,
  model VARCHAR(100) NOT NULL,
  channelId INT NULL,
  errorClass VARCHAR(64) NOT NULL,
  active TINYINT NOT NULL DEFAULT 0,
  consecutiveHealthyWindows INT NOT NULL DEFAULT 0,
  lastEvaluationKey VARCHAR(32) NULL,
  lastEvaluatedAt DATETIME(6) NULL,
  lastTriggeredAt DATETIME(6) NULL,
  lastRecoveredAt DATETIME(6) NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY UQ_availability_alert_states_fingerprint (fingerprint),
  KEY IDX_availability_alert_states_active (active),
  KEY IDX_availability_alert_states_dimension (protocol, model, channelId, errorClass)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS availability_alert_events (
  id INT NOT NULL AUTO_INCREMENT,
  stateId INT NOT NULL,
  fingerprint VARCHAR(191) NOT NULL,
  protocol VARCHAR(20) NOT NULL,
  model VARCHAR(100) NOT NULL,
  channelId INT NULL,
  errorClass VARCHAR(64) NOT NULL,
  eventType VARCHAR(16) NOT NULL,
  windowMinutes SMALLINT NOT NULL,
  requests INT NOT NULL DEFAULT 0,
  successes INT NOT NULL DEFAULT 0,
  serviceFailures INT NOT NULL DEFAULT 0,
  matchingFailures INT NOT NULL DEFAULT 0,
  serviceSuccessRate DOUBLE NULL,
  windowEndAt DATETIME(6) NOT NULL,
  occurredAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY UQ_availability_alert_events_window (fingerprint, eventType, windowEndAt),
  KEY IDX_availability_alert_events_state (stateId),
  KEY IDX_availability_alert_events_fingerprint (fingerprint),
  KEY IDX_availability_alert_events_occurred (occurredAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
