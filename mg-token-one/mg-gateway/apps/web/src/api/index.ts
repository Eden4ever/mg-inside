import axios from 'axios'
import { apiErrorMessage } from './error-message'
import { createPlatformSession,serviceRequestUrl } from '@mg-inside/frontend'
import { desktop, unifiedDesktop,tokenApplicationId } from '../desktop'

const API_BASE = unifiedDesktop ? desktop.apiBase : import.meta.env.VITE_API_BASE || '/api'
const RELAY_BASE = import.meta.env.VITE_RELAY_BASE || '/v1'

export const api = axios.create({ baseURL: API_BASE, timeout: 15000, withCredentials: unifiedDesktop })
const session = createPlatformSession({ origin: desktop.origin, onExpired: () => desktop.login() })
const pending = new WeakMap<object, () => void>()

api.interceptors.request.use(async (config) => {
  if (unifiedDesktop) {
    localStorage.removeItem('mg_token')
    if(config.url?.startsWith('/'))config.url=serviceRequestUrl(desktop.origin,tokenApplicationId,config.url,(config.method||'GET').toUpperCase())
    if (!['get', 'head', 'options'].includes(config.method || 'get')) { config.headers['X-CSRF-Token'] = await session.csrf(); pending.set(config, desktop.beginRequest()) }
  } else { const token = localStorage.getItem('mg_token'); if (token) config.headers.Authorization = `Bearer ${token}` }
  return config
})

api.interceptors.response.use(
  (resp) => { pending.get(resp.config)?.(); return resp },
  (err) => {
    const status = err?.response?.status
    pending.get(err.config)?.()
    if (status === 401) {
      localStorage.removeItem('mg_token')
      session.clear()
      if (unifiedDesktop) desktop.login()
      else if (location.pathname !== '/login') location.href = '/login'
    }
    const msg = apiErrorMessage(err?.response?.data, err?.message || '请求失败')
    err.message = msg
    return Promise.reject(err)
  },
)

// relay 走独立 base（/v1），带 sk- 令牌，不走登录态拦截
export const relayApi = axios.create({ baseURL: RELAY_BASE, timeout: 60000 })

export default api
