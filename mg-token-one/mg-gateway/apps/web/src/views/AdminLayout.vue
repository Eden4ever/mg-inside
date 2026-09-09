<template>
  <router-view v-if="isLogin" />
  <ConfiguredApplicationShell v-else :config="shellConfig" :active-path="activeNav" :title="String(route.meta.title || tokenPresentation.name)" @navigate="navigate">
      <template #actions><button class="workspace-text-action workspace-desktop-action" type="button" @click="openDocs">开发文档</button></template>
      
    <div class="workspace-body"><router-view /></div>
  </ConfiguredApplicationShell>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { openTokenApplication, tokenPresentation } from '../desktop'
import { ConfiguredApplicationShell, loadApplicationConfig, applyApplicationDocument } from '@mg-inside/frontend'
import shellInput from '../config/console.json'
const shellConfig = loadApplicationConfig(shellInput, { components: ['route'] })
shellConfig.name = tokenPresentation.name
shellConfig.brand.name = tokenPresentation.name

const route = useRoute()
watch(() => route.meta.title, title => applyApplicationDocument(shellConfig, {enterpriseLogo:'/logo.svg'}, String(title || tokenPresentation.name)), {immediate:true})
const router = useRouter()
const isLogin = computed(() => route.matched.some((record) => record.meta.adminLogin === true))
const activeNav = computed(() => route.path.startsWith('/admin/suppliers') ? '/admin/suppliers' : route.path)


function openDocs() {
  openTokenApplication('/docs')
}
function navigate(path: string) { if (path === '/docs') openTokenApplication(path); else router.push(path) }
</script>

<style scoped src="@/styles/workspace-content.css"></style>
