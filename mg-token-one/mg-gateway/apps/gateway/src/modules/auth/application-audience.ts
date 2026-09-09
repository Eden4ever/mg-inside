/** 登录令牌的应用授权由服务端实际接口决定，浏览器参数不能扩大权限。 */
export const tokenApplications = ['token-one', 'token-one-console', 'token-one-docs'] as const
export type TokenApplication = typeof tokenApplications[number]

export function applicationAudience(path: string): TokenApplication {
  const route = path.split('?', 1)[0].toLowerCase().replace(/\/+$/, '')
  const identityEndpoint = /^\/api\/auth\/(?:me|logout)\/(token-one|token-one-console|token-one-docs)$/.exec(route)
  if (identityEndpoint) return identityEndpoint[1] as TokenApplication
  if (/^\/api\/(?:admin|wecom)(?:\/|$)/.test(route)) return 'token-one-console'
  return 'token-one'
}
