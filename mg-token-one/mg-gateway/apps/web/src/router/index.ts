import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { desktop, unifiedDesktop, tokenApplicationForPath, tokenApplicationId, openTokenApplication, tokenPresentation } from '../desktop'

const routes: RouteRecordRaw[] = [
  {
    path: '/docs',
    component: () => import('@/views/docs/DocsLayout.vue'),
    meta: { public: true },
    children: [
      { path: '', name: 'docs-overview', component: () => import('@/views/docs/DocsOverview.vue'), meta: { public: true, title: '快速开始' } },
      { path: 'models', name: 'docs-models', component: () => import('@/views/docs/DocsModels.vue'), meta: { public: true, title: '模型目录' } },
      { path: 'chat-completions', name: 'docs-chat', component: () => import('@/views/docs/DocsChat.vue'), meta: { public: true, title: 'Chat Completions' } },
      { path: 'streaming', name: 'docs-streaming', component: () => import('@/views/docs/DocsStreaming.vue'), meta: { public: true, title: '流式响应' } },
      { path: 'tools', name: 'docs-tools', component: () => import('@/views/docs/DocsTools.vue'), meta: { public: true, title: '工具接入' } },
      { path: 'gpt6-astra', name: 'docs-gpt6-astra', component: () => import('@/views/docs/DocsGpt6Astra.vue'), meta: { public: true, title: '现已支持 GPT-6' } },
      { path: 'cc-switch-codex', name: 'docs-cc-switch-codex', component: () => import('@/views/docs/DocsCcSwitchCodex.vue'), meta: { public: true, title: 'CC Switch 与 Codex' } },
      { path: 'claude-code', name: 'docs-claude-code', component: () => import('@/views/docs/DocsClaudeCode.vue'), meta: { public: true, title: 'Claude Code CLI / Desktop' } },
      { path: 'errors', name: 'docs-errors', component: () => import('@/views/docs/DocsErrors.vue'), meta: { public: true, title: '错误排查' } },
    ],
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/admin',
    component: () => import('@/views/AdminLayout.vue'),
    children: [
      { path: '', name: 'admin-login', component: () => import('@/views/Login.vue'), meta: { public: true, adminLogin: true } },
      { path: 'stats', name: 'admin-stats', component: () => import('@/views/admin/Stats.vue'), meta: { title: '统计分析', admin: true } },
      { path: 'availability-alerts', name: 'admin-availability-alerts', component: () => import('@/views/admin/AvailabilityAlerts.vue'), meta: { title: '可用性告警', admin: true } },
      { path: 'channels', name: 'admin-channels', component: () => import('@/views/admin/Channels.vue'), meta: { title: '渠道管理', admin: true } },
      { path: 'models', name: 'admin-models', component: () => import('@/views/admin/Models.vue'), meta: { title: '模型管理', admin: true } },
      { path: 'users', name: 'admin-users', component: () => import('@/views/admin/Users.vue'), meta: { title: '用户管理', admin: true } },
      { path: 'groups', name: 'admin-groups', component: () => import('@/views/admin/Groups.vue'), meta: { title: '分组管理', admin: true } },
      { path: 'tokens', name: 'admin-tokens', component: () => import('@/views/admin/Tokens.vue'), meta: { title: '令牌管理', admin: true } },
      { path: 'logs', name: 'admin-logs', component: () => import('@/views/admin/Logs.vue'), meta: { title: '调用日志', admin: true } },
      { path: 'wecom', name: 'admin-wecom', component: () => import('@/views/admin/Wecom.vue'), meta: { title: '企业微信', admin: true } },
      { path: 'suppliers', name: 'admin-suppliers', component: () => import('@/views/admin/SupplierAccounts.vue'), meta: { title: '供应商账户', admin: true } },
      { path: 'suppliers/:supplier/:accountId(\\d+)', name: 'admin-generic-supplier-account-detail', component: () => import('@/views/admin/SupplierAccountDetail.vue'), meta: { title: '供应商账户详情', admin: true } },
      { path: 'suppliers/:supplier', name: 'admin-supplier-account-detail', component: () => import('@/views/admin/SupplierAccount.vue'), meta: { title: 'CCTQ 账户详情', admin: true } },
      { path: 'supplier-account', redirect: '/admin/suppliers/cctq' },
      { path: 'provider-account', redirect: '/admin/suppliers/cctq' },
    ],
  },
  {
    path: '/',
    component: () => import('@/views/Layout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/portal/Dashboard.vue'), meta: { title: '概览' } },
      { path: 'my-usage', name: 'my-usage', component: () => import('@/views/portal/MyUsage.vue'), meta: { title: '令牌与用量' } },
      { path: 'playground', name: 'playground', component: () => import('@/views/portal/Playground.vue'), meta: { title: 'API 调试' } },
    ],
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { public: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (unifiedDesktop && tokenApplicationForPath(to.path) !== tokenApplicationId) {
    openTokenApplication(to.fullPath)
    return false
  }
  const auth = useAuthStore()
  const isPublic = to.matched.some((record) => record.meta.public === true)
  const needsAdmin = to.matched.some((record) => record.meta.admin === true)
  const adminLogin = to.matched.some((record) => record.meta.adminLogin === true)
  if (unifiedDesktop) {
    // 每次进入统一认证页面都验证当前应用授权，文档也是独立受授权应用。
    try { await auth.fetchMe() } catch { desktop.login(to.fullPath); return false }
    if (to.path === '/login' || adminLogin) return { path: adminLogin ? '/admin/stats' : '/dashboard' }
    return true
  }
  // 回调须先消费新凭据，避免已有本地登录把 SSO 回调提前重定向。
  if (isPublic && new URLSearchParams(to.hash.slice(1)).has('sso_token')) return true

  if (!isPublic && !auth.isLoggedIn()) {
    return { path: needsAdmin ? '/admin' : '/login' }
  }

  if (needsAdmin && !auth.user) {
    try {
      await auth.fetchMe()
    } catch {
      auth.logout()
      return { path: '/admin' }
    }
  }

  if (needsAdmin && !auth.isAdmin()) return { path: '/dashboard' }
  if (adminLogin && auth.isLoggedIn()) {
    if (!auth.user) {
      try { await auth.fetchMe() } catch { auth.logout(); return true }
    }
    return auth.isAdmin() ? { path: '/admin/stats' } : { path: '/dashboard' }
  }
  return true
})

export default router
desktop.configure({ onNavigate: async path => { await router.push(path) } })
router.afterEach(to => { desktop.setTitle(`${to.meta.title || '工作台'} · ${tokenPresentation.name}`); desktop.routeChanged(to.fullPath) })
