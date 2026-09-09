export class RelayClientAbortError extends Error {
  readonly originalError: unknown

  constructor(originalError?: unknown) {
    super('客户端在响应完成前断开连接')
    this.name = 'RelayClientAbortError'
    this.originalError = originalError
  }
}

export function isRelayClientAbortError(
  error: unknown,
): error is RelayClientAbortError {
  return error instanceof RelayClientAbortError
}
