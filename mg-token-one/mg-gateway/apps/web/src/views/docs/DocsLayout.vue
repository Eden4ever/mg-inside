<template>
  <div class="docs-shell" :class="{ 'is-directory-collapsed': collapsed }">
    <ConfiguredApplicationHeader class="docs-header" :config="shellConfig" :assets="{ enterpriseLogo: '/logo.svg' }" :title="String(route.meta.title || '快速开始')" @navigate="router.push($event)">
      <template #actions>
        <button class="docs-header-action" type="button" @click="openTokenApplication('/dashboard')">员工门户</button>
        <button v-if="auth.canAccessConsole()" class="docs-header-action" type="button" @click="openTokenApplication('/admin/stats')">控制台</button>
      </template>
      
    </ConfiguredApplicationHeader>
    <div class="docs-grid" :class="{ 'has-reader-toolbar': collapsed || narrow }">
      <div v-if="collapsed || narrow" class="docs-reader-toolbar"><button ref="directoryToggle" type="button" :aria-expanded="!collapsed" aria-controls="docs-directory-links" class="docs-menu-button" @click="collapsed = !collapsed">{{ collapsed ? '☰ 文档目录' : '关闭目录' }}</button><span>{{ route.meta.title }}</span></div>
      <button v-if="!collapsed" class="docs-directory-backdrop" type="button" aria-label="关闭文档目录" @click="closeDirectory" />
      <aside v-show="!collapsed" class="docs-directory" :class="{ 'is-collapsed': collapsed }" aria-label="阅读目录">
        <nav v-show="!collapsed" id="docs-directory-links" class="docs-directory-links" aria-label="文档目录" @keydown.esc="closeDirectory">
          <p class="docs-directory-caption">开发者文档</p>
          <label class="docs-search"><span class="docs-sr-only">搜索文档目录</span><input v-model="search" type="search" placeholder="搜索文档…" autocomplete="off" data-desktop-search /></label>
          <p v-if="!filteredSections.length" class="docs-search-empty">未找到匹配的文档</p>
          <section v-for="section in filteredSections" :key="section.title" class="docs-directory-group">
            <h2>{{ section.title }}</h2>
            <RouterLink v-for="link in section.links" :key="link.to" :to="link.to" :title="link.label" :aria-current="isActive(link.to) ? 'page' : undefined" class="docs-directory-link" :class="{ active: isActive(link.to) }" @click="onDirectorySelect">{{ link.label }}</RouterLink>
          </section>
        </nav>
        <div class="docs-directory-footer">
          <button class="docs-directory-action" type="button" title="收起文档目录" aria-label="收起文档目录" aria-controls="docs-directory-links" @click="closeDirectory">← 收起目录</button>
        </div>
      </aside>
      <main ref="main" class="docs-main"><router-view /><nav class="docs-pagination" aria-label="文档翻页"><RouterLink v-if="previousPage" :to="previousPage.to"><span>上一页</span><strong>← {{ previousPage.label }}</strong></RouterLink><RouterLink v-if="nextPage" class="docs-pagination-next" :to="nextPage.to"><span>下一页</span><strong>{{ nextPage.label }} →</strong></RouterLink></nav></main>
      <aside v-if="onPageLinks.length" class="docs-on-page" aria-label="本页目录"><div class="docs-on-page__title">本页目录</div><a v-for="link in onPageLinks" :key="link.id" :href="`#${link.id}`" @click.prevent="goToSection(link.id)">{{ link.label }}</a></aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ConfiguredApplicationHeader, loadApplicationConfig, applyApplicationDocument } from '@mg-inside/frontend'
import shellInput from '../../config/docs.json'
const shellConfig = loadApplicationConfig(shellInput, { components: ['route'], assets: ['enterpriseLogo'] })
shellConfig.name = tokenPresentation.name
shellConfig.brand.name = tokenPresentation.name
import { unifiedDesktop, openTokenApplication, tokenPresentation } from '../../desktop'
import { useAuthStore } from '@/store/auth'

const route = useRoute()
watch(() => route.meta.title, title => applyApplicationDocument(shellConfig, {enterpriseLogo:'/logo.svg'}, String(title || tokenPresentation.name)), {immediate:true})
const router = useRouter()
const media = window.matchMedia('(max-width: 980px)')
const narrow = ref(media.matches)
const collapsed = ref(media.matches)
const search = ref('')
const main = ref<HTMLElement>()
function mediaChanged() { narrow.value = media.matches; collapsed.value = media.matches }
onMounted(() => media.addEventListener('change', mediaChanged))
onUnmounted(() => media.removeEventListener('change', mediaChanged))
const directoryToggle = ref<HTMLButtonElement>()
async function closeDirectory() { collapsed.value = true; await nextTick(); directoryToggle.value?.focus() }
const isActive = (path: string) => route.path.replace(/\/$/, '') === path.replace(/\/$/, '')
function onDirectorySelect() { if (window.matchMedia('(max-width: 980px)').matches) collapsed.value = true }
const auth = useAuthStore()
// 统一模式由路由校验文档授权；旧模式仅恢复已有身份。
onMounted(async () => {
  if (auth.user) return
  try {
    if (!unifiedDesktop && auth.isLoggedIn()) await auth.fetchMe()
  } catch { /* 旧模式保留公开文档行为 */ }
})
const sections = [
  { title: '快速开始', links: [{ to: '/docs/', label: '首次调用 API' }, { to: '/docs/models', label: '模型目录' }] },
  { title: 'API 指南', links: [{ to: '/docs/chat-completions', label: 'Chat Completions' }, { to: '/docs/streaming', label: '流式响应' }] },
  { title: '接入与支持', links: [{ to: '/docs/tools', label: '工具接入' }, { to: '/docs/gpt6-astra', label: '现已支持 GPT-6' }, { to: '/docs/cc-switch-codex', label: 'CC Switch 与 Codex' }, { to: '/docs/claude-code', label: 'Claude Code CLI / Desktop' }, { to: '/docs/errors', label: '错误排查' }] },
]
const filteredSections = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return sections.map(section => ({ ...section, links: section.links.filter(link => !query || `${section.title} ${link.label}`.toLocaleLowerCase().includes(query)) })).filter(section => section.links.length)
})
const allPages = sections.flatMap(section => section.links)
const pageIndex = computed(() => allPages.findIndex(link => isActive(link.to)))
const previousPage = computed(() => allPages[pageIndex.value - 1])
const nextPage = computed(() => allPages[pageIndex.value + 1])
async function goToSection(id: string) {
  await router.replace({ hash: `#${id}` })
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
watch(() => route.path, async () => { await nextTick(); main.value?.scrollTo({ top: 0 }); if (route.hash) document.getElementById(route.hash.slice(1))?.scrollIntoView() })
const toc = {
  'docs-overview': [{ id: 'authentication', label: '认证与地址' }, { id: 'quick-request', label: '发送首个请求' }],
  'docs-models': [{ id: 'model-catalog', label: '可用模型' }, { id: 'availability', label: '权限说明' }],
  'docs-chat': [{ id: 'request', label: '请求参数' }, { id: 'response', label: '响应结构' }],
  'docs-streaming': [{ id: 'sse', label: 'SSE 响应' }, { id: 'usage', label: '用量信息' }],
  'docs-tools': [{ id: 'workbuddy', label: 'WorkBuddy' }, { id: 'cursor', label: 'Cursor' }, { id: 'continue', label: 'Continue' }],
  'docs-gpt6-astra': [{ id: 'gpt6-intro', label: '模型介绍' }, { id: 'gpt6-video', label: '介绍视频' }],
  'docs-cc-switch-codex': [{ id: 'compatibility', label: '配置项' }, { id: 'why', label: '接入步骤' }, { id: 'next-steps', label: '使用提示' }],
  'docs-claude-code': [{ id: 'endpoint', label: '协议与地址' }, { id: 'cli', label: 'CLI' }, { id: 'desktop', label: 'Desktop' }, { id: 'request', label: '直接验证' }, { id: 'cc-switch', label: 'CC Switch' }],
  'docs-errors': [{ id: 'status-codes', label: '常见状态码' }, { id: 'troubleshooting', label: '排查顺序' }],
} as Record<string, { id: string; label: string }[]>
const onPageLinks = computed(() => toc[String(route.name)] || [])

</script>

<style scoped src="./docs-reading.css"></style>
