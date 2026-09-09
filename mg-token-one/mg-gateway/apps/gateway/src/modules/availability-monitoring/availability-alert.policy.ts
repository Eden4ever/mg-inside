export const AVAILABILITY_ALERT_WINDOW_MINUTES = 5
export const AVAILABILITY_ALERT_SUPPRESSION_MS = 30 * 60_000
export const AVAILABILITY_ALERT_RECOVERY_WINDOWS = 2

export interface AvailabilityAlertMetricRow {
  protocol: string
  model: string
  channelId: number | null
  requests: number
  successes: number
  serviceFailures: number
  noResponsesFailures: number
  server5xxFailures: number
}

export interface AvailabilityAlertFinding extends AvailabilityAlertMetricRow {
  errorClass: 'no_responses_channel' | 'service_5xx'
  fingerprint: string
  serviceSuccessRate: number | null
  matchingFailures: number
}

export interface AvailabilityAlertSnapshot {
  findings: AvailabilityAlertFinding[]
  /** 仅对没有当前失败候选的指纹记录恢复所需的真实成功流量。 */
  recoveryEvidenceByFingerprint: Map<string, AvailabilityAlertRecoveryEvidence>
}

export interface AvailabilityAlertRecoveryEvidence {
  requests: number
  successes: number
  serviceFailures: number
  serviceSuccessRate: number
  matchingFailures: 0
}

function rate(successes: number, requests: number): number | null {
  if (!requests) return null
  return Math.round((successes / requests) * 10000) / 100
}

export function availabilityAlertFingerprint(
  protocol: string,
  model: string,
  channelId: number | null,
  errorClass: string,
): string {
  return [protocol, model, channelId === null ? 'none' : String(channelId), errorClass].join(':')
}

function aggregateNoResponsesRows(rows: AvailabilityAlertMetricRow[]): AvailabilityAlertMetricRow[] {
  const aggregated = new Map<string, AvailabilityAlertMetricRow>()
  for (const row of rows) {
    const key = `${row.protocol}\u0000${row.model}`
    const existing = aggregated.get(key)
    if (existing) {
      existing.requests += row.requests
      existing.successes += row.successes
      existing.serviceFailures += row.serviceFailures
      existing.noResponsesFailures += row.noResponsesFailures
      existing.server5xxFailures += row.server5xxFailures
      continue
    }
    aggregated.set(key, { ...row, channelId: null })
  }
  return [...aggregated.values()]
}

/**
 * 将原始窗口指标规范化为告警候选和恢复证据。
 * 无 Responses 渠道是协议+模型级别的问题；5xx 则保留到单一渠道维度。
 */
export function buildAvailabilityAlertSnapshot(rows: AvailabilityAlertMetricRow[]): AvailabilityAlertSnapshot {
  const findings: AvailabilityAlertFinding[] = []
  const recoveryEvidenceByFingerprint = new Map<string, AvailabilityAlertRecoveryEvidence>()
  const noResponseRows = aggregateNoResponsesRows(rows)

  for (const row of noResponseRows) {
    const serviceSuccessRate = rate(row.successes, row.requests)
    if (row.noResponsesFailures >= 3) {
      findings.push({
        ...row,
        errorClass: 'no_responses_channel',
        fingerprint: availabilityAlertFingerprint(row.protocol, row.model, null, 'no_responses_channel'),
        serviceSuccessRate,
        matchingFailures: row.noResponsesFailures,
      })
    }
  }

  for (const row of rows) {
    const serviceSuccessRate = rate(row.successes, row.requests)
    if (row.server5xxFailures >= 3 && serviceSuccessRate !== null && serviceSuccessRate < 95) {
      findings.push({
        ...row,
        errorClass: 'service_5xx',
        fingerprint: availabilityAlertFingerprint(row.protocol, row.model, row.channelId, 'service_5xx'),
        serviceSuccessRate,
        matchingFailures: row.server5xxFailures,
      })
    }
  }

  const activeFindingFingerprints = new Set(findings.map((finding) => finding.fingerprint))
  for (const row of noResponseRows) {
    const fingerprint = availabilityAlertFingerprint(row.protocol, row.model, null, 'no_responses_channel')
    if (
      !activeFindingFingerprints.has(fingerprint)
      && row.requests > 0
      && row.successes > 0
      && rate(row.successes, row.requests) !== null
      && rate(row.successes, row.requests)! >= 95
      && row.noResponsesFailures === 0
    ) {
      recoveryEvidenceByFingerprint.set(fingerprint, {
        requests: row.requests,
        successes: row.successes,
        serviceFailures: row.serviceFailures,
        serviceSuccessRate: rate(row.successes, row.requests)!,
        matchingFailures: 0,
      })
    }
  }
  for (const row of rows) {
    const fingerprint = availabilityAlertFingerprint(row.protocol, row.model, row.channelId, 'service_5xx')
    if (
      !activeFindingFingerprints.has(fingerprint)
      && row.requests > 0
      && row.successes > 0
      && rate(row.successes, row.requests) !== null
      && rate(row.successes, row.requests)! >= 95
      && row.server5xxFailures === 0
    ) {
      recoveryEvidenceByFingerprint.set(fingerprint, {
        requests: row.requests,
        successes: row.successes,
        serviceFailures: row.serviceFailures,
        serviceSuccessRate: rate(row.successes, row.requests)!,
        matchingFailures: 0,
      })
    }
  }
  return { findings, recoveryEvidenceByFingerprint }
}

/** 将原始窗口指标规范化为满足触发阈值的告警候选。 */
export function findAvailabilityAlerts(rows: AvailabilityAlertMetricRow[]): AvailabilityAlertFinding[] {
  return buildAvailabilityAlertSnapshot(rows).findings
}
