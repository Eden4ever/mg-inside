import { ChannelProtocol, normalizeChannelProtocols } from '@/common/utils/upstream-protocol.util'

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'host',
  'content-type',
  'content-length',
  'connection',
  'transfer-encoding',
  'cookie',
  'set-cookie',
])

export function parseChannelHeaders(value?: string | null): Record<string, string> {
  if (!value?.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('自定义请求头不是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('自定义请求头必须是 JSON 对象')
  }

  const normalized: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(parsed)) {
    const name = rawName.trim().toLowerCase()
    if (!HEADER_NAME.test(name)) throw new Error(`无效的请求头名称：${rawName}`)
    if (FORBIDDEN_HEADERS.has(name) || name.startsWith('x-forwarded-')) {
      throw new Error(`禁止配置敏感请求头：${rawName}`)
    }
    if (
      (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') ||
      /[\r\n]/.test(String(rawValue))
    ) {
      throw new Error(`请求头 ${rawName} 的值无效`)
    }
    normalized[name] = String(rawValue)
  }
  return normalized
}

export function normalizeChannelHeaders(value?: string | null): string | null {
  if (!value?.trim()) return null
  return JSON.stringify(parseChannelHeaders(value))
}

export function normalizeChannelBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('baseUrl 必填')
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('baseUrl 必须是有效 URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('baseUrl 只支持 http 或 https')
  }
  if (parsed.username || parsed.password) throw new Error('baseUrl 禁止包含用户名或密码')
  if (parsed.search || parsed.hash) throw new Error('baseUrl 禁止包含查询参数或片段')
  return baseUrl
}

export interface ChannelProxyConfig {
  protocol: 'http' | 'https'
  host: string
  port: number
  auth?: { username: string; password: string }
}

export function normalizeChannelProxy(value?: string | null): string | null {
  if (!value?.trim()) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('proxy 必须是有效 URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('proxy 只支持 http 或 https')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('proxy 只能包含协议、主机、端口和可选凭据')
  }
  return parsed.toString().replace(/\/$/, '')
}

/** Returns false to explicitly disable Axios environment proxy discovery. */
export function parseChannelProxy(value?: string | null): ChannelProxyConfig | false {
  const normalized = normalizeChannelProxy(value)
  if (!normalized) return false
  const parsed = new URL(normalized)
  return {
    protocol: parsed.protocol.slice(0, -1) as 'http' | 'https',
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    ...(parsed.username || parsed.password
      ? {
          auth: {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          },
        }
      : {}),
  }
}

export function normalizeChannelType(value?: string): 'openai' | 'anthropic' {
  if (value === undefined || value === '') return 'openai'
  if (value !== 'openai' && value !== 'anthropic') {
    throw new Error('渠道类型只支持 openai 或 anthropic')
  }
  return value
}

export function normalizeChannelPriority(value: unknown, fallback: number): number {
  if (typeof value === 'boolean') throw new Error('priority 必须是非负整数')
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(result) || result < 0) throw new Error('priority 必须是非负整数')
  return result
}

export function normalizeChannelWeight(value: unknown, fallback: number): number {
  if (typeof value === 'boolean') throw new Error('weight 必须是正整数')
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(result) || result < 1 || result > 1000) {
    throw new Error('weight 必须是 1-1000 的整数')
  }
  return result
}

export function normalizeChannelStatus(value: unknown, fallback: number): number {
  if (typeof value === 'boolean') throw new Error('status 必须是 0 或 1')
  const result = value === undefined ? fallback : Number(value)
  if (result !== 0 && result !== 1) throw new Error('status 必须是 0 或 1')
  return result
}

export function normalizeProtocols(
  value: { protocol?: ChannelProtocol; protocols?: ChannelProtocol[] },
  fallback: ChannelProtocol,
): ChannelProtocol[] {
  return normalizeChannelProtocols(value, fallback)
}
