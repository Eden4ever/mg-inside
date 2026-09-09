import crypto from 'node:crypto'
import process from 'node:process'
import mysql from 'mysql2/promise'
import axios from 'axios'
import {
  parseChannelHeaders,
  parseChannelProxy,
} from '../dist/modules/channel/channel-policy.js'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=')
    return [key, value.join('=')]
  }),
)
const channelId = Number(args.get('channel'))
const protocols = (args.get('protocols') || 'chat,responses,anthropic')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value === 'chat' || value === 'responses' || value === 'anthropic')
if (!Number.isInteger(channelId) || channelId < 1) throw new Error('必须提供 --channel=<id>')
if (!protocols.length) throw new Error('protocols 必须包含 chat、responses 或 anthropic')

function required(name, fallback = '') {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

function decrypt(value, secret) {
  const key = crypto.createHash('sha256').update(String(secret)).digest()
  const buffer = Buffer.from(value, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
  decipher.setAuthTag(buffer.subarray(12, 28))
  return Buffer.concat([
    decipher.update(buffer.subarray(28)),
    decipher.final(),
  ]).toString('utf8')
}

function upstreamUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}${path}` : `${base}/v1${path}`
}

const db = await mysql.createConnection({
  host: required('DB_HOST', '127.0.0.1'),
  port: Number(required('DB_PORT', '3306')),
  user: required('DB_USERNAME', 'root'),
  password: required('DB_PASSWORD'),
  database: required('DB_DATABASE', 'mg_gateway'),
})

try {
  const [[channel]] = await db.execute(
    'SELECT id, name, baseUrl, keysEncrypted, headersJson, proxy FROM channels WHERE id = ? AND status = 1',
    [channelId],
  )
  if (!channel) throw new Error(`启用渠道 ${channelId} 不存在`)
  const [[binding]] = await db.execute(
    `SELECT model.name AS publicModel, route.upstreamModel
     FROM model_routes AS route
     JOIN model_configs AS model ON model.id = route.modelId
     WHERE route.channelId = ? AND route.status = 1 AND model.status = 1
     ORDER BY route.priority DESC, route.id ASC LIMIT 1`,
    [channelId],
  )
  const publicModel = binding?.publicModel || ''
  const upstreamModel = binding?.upstreamModel || ''
  if (!upstreamModel) throw new Error(`渠道 ${channelId} 没有绑定启用模型`)
  let decryptedKeys
  try {
    decryptedKeys = decrypt(channel.keysEncrypted, required('JWT_SECRET'))
  } catch {
    throw new Error(
      '渠道密钥无法用当前 JWT_SECRET 解密；请使用与写入渠道时相同的密钥环境',
    )
  }
  const key = decryptedKeys.split(/\r?\n/).map((value) => value.trim()).find(Boolean)
  if (!key) throw new Error('渠道没有可用密钥')
  const customHeaders = parseChannelHeaders(channel.headersJson)

  const results = []
  for (const protocol of protocols) {
    const path = protocol === 'responses'
      ? '/responses'
      : protocol === 'anthropic'
        ? '/messages'
        : '/chat/completions'
    const body = protocol === 'responses'
      ? { model: upstreamModel, input: 'Reply with OK.', max_output_tokens: 16, stream: false }
      : protocol === 'anthropic'
        ? { model: upstreamModel, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }], stream: false }
      : { model: upstreamModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16, stream: false }
    const requestHeaders = protocol === 'anthropic'
      ? {
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          ...customHeaders,
          'x-api-key': key,
        }
      : {
          'Content-Type': 'application/json',
          ...customHeaders,
          Authorization: `Bearer ${key}`,
        }
    try {
      const response = await axios.post(upstreamUrl(channel.baseUrl, path), body, {
        headers: requestHeaders,
        proxy: parseChannelProxy(channel.proxy),
        timeout: 60_000,
        validateStatus: () => true,
      })
      let error = null
      const ok = response.status >= 200 && response.status < 300 && !response.data?.error
      if (!ok) {
        error = response.data?.error?.message || response.data?.message || `HTTP ${response.status}`
      }
      results.push({ protocol, ok, status: response.status, error })
    } catch (error) {
      results.push({ protocol, ok: false, status: null, error: error.message })
    }
  }
  console.log(JSON.stringify({
    channel: { id: channel.id, name: channel.name },
    model: { public: publicModel, upstream: upstreamModel },
    results,
  }, null, 2))
  if (!results.every((result) => result.ok)) process.exitCode = 2
} finally {
  await db.end()
}
