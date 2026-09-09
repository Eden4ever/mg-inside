/** 同时读取网关原始错误和桌面出口错误，避免业务提示被通用 HTTP 文案覆盖。 */
export function apiErrorMessage(body: unknown, fallback = '请求失败'): string {
  if (!body || typeof body !== 'object') return fallback
  const value = body as { message?: unknown; error?: unknown }
  const nested = value.error && typeof value.error === 'object' ? (value.error as { message?: unknown }).message : undefined
  for (const message of [value.message, nested]) {
    if (typeof message === 'string' && message.trim()) return message
    if (Array.isArray(message) && message.length && message.every(item => typeof item === 'string')) return message.join('；')
  }
  return fallback
}
