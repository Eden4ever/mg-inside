export const CHANNEL_PROTOCOLS = ['chat', 'responses', 'anthropic'] as const

export type ChannelProtocol = (typeof CHANNEL_PROTOCOLS)[number]
export type RelayProtocol = ChannelProtocol

export interface ChannelProtocolConfig {
  protocol?: ChannelProtocol | null
  protocols?: ChannelProtocol[] | null
}

export function normalizeChannelProtocols(
  config: ChannelProtocolConfig,
  fallback: ChannelProtocol = 'chat',
): ChannelProtocol[] {
  const source = Array.isArray(config.protocols) && config.protocols.length
    ? config.protocols
    : [config.protocol || fallback]
  const protocols = [...new Set(source)]
  const invalid = protocols.filter(
    (protocol) => !CHANNEL_PROTOCOLS.includes(protocol as ChannelProtocol),
  )
  if (invalid.length) {
    throw new Error(`不支持的渠道协议：${invalid.join('、')}`)
  }
  return protocols as ChannelProtocol[]
}

export function buildUpstreamUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return base.endsWith('/v1')
    ? `${base}${normalizedPath}`
    : `${base}/v1${normalizedPath}`
}
