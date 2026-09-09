export interface RelayRetryDecision {
  retry: boolean
  recordChannelFailure: boolean
}

const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 404, 408, 409, 425, 429])

/**
 * Distinguishes request-semantic failures from channel/upstream failures.
 * Client-semantic 4xx responses must not be amplified or poison channel health.
 */
export function classifyUpstreamFailure(status: number): RelayRetryDecision {
  if (status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)) {
    return { retry: false, recordChannelFailure: false }
  }
  return { retry: true, recordChannelFailure: true }
}
