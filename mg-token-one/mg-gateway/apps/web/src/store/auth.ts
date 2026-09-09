import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import api from '@/api'
import { unifiedDesktop, tokenApplicationId, desktop } from '../desktop'

interface UserInfo {
  id: number
  username: string
  displayName: string
  role: string
  department?: string
  avatarUrl?: string
  syncSource?: string
}

export const useAuthStore = defineStore('auth', () => {
  const state = reactive({
    token: unifiedDesktop ? '' : localStorage.getItem('mg_token') || '',
    user: null as UserInfo | null,
    applications: [] as string[],
  })

  const isLoggedIn = () => unifiedDesktop ? !!state.user : !!state.token
  const isAdmin = () => state.user?.role === 'admin'
  const canAccessConsole = () => unifiedDesktop ? state.applications.includes('token-one-console') : isAdmin()

  async function login(username: string, password: string) {
    if (unifiedDesktop) throw new Error('请通过统一认证登录')
    const { data } = await api.post('/auth/login', { username, password })
    state.token = data.token
    state.user = data.user
    localStorage.setItem('mg_token', data.token)
  }

  async function loginByToken(token: string) {
    if (unifiedDesktop) throw new Error('统一认证模式不接收业务登录令牌')
    state.token = token
    localStorage.setItem('mg_token', token)
    await fetchMe()
  }

  async function fetchMe() {
    const { data } = await api.get(unifiedDesktop ? `/auth/me/${tokenApplicationId}` : '/auth/me')
    state.user = data
    if (unifiedDesktop) {
      try {
        const response = await fetch(`${desktop.origin}/api/session`, { credentials: 'include' })
        const session = response.ok ? await response.json() : null
        state.applications = Array.isArray(session?.apps) ? session.apps.map((app: { id: string }) => app.id) : []
      } catch { state.applications = [] }
    }
    return data
  }

  function logout() {
    state.token = ''
    state.user = null
    state.applications = []
    localStorage.removeItem('mg_token')
  }

  async function logoutEverywhere() {
    await api.post(unifiedDesktop ? `/auth/logout/${tokenApplicationId}` : '/auth/logout')
    logout()
  }

  return { ...toRefs(state), isLoggedIn, isAdmin, canAccessConsole, login, loginByToken, fetchMe, logout, logoutEverywhere }
})
