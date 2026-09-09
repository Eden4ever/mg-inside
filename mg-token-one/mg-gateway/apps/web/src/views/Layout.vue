<template>
  <ConfiguredApplicationShell :config="shellConfig" :active-path="route.path" :title="String(route.meta.title || tokenPresentation.name)" @navigate="navigate">
      <template #actions><button v-if="auth.canAccessConsole()" class="workspace-text-action workspace-desktop-action" type="button" @click="openTokenApplication('/admin/stats')">管理后台</button></template>
      
    <div class="workspace-body"><router-view v-slot="{ Component }"><transition name="el-fade-in-linear" mode="out-in"><component :is="Component" /></transition></router-view></div>
  </ConfiguredApplicationShell>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { openTokenApplication, tokenPresentation } from '../desktop'
import { ConfiguredApplicationShell, loadApplicationConfig, applyApplicationDocument } from '@mg-inside/frontend'
import shellInput from '../config/portal.json'
const shellConfig = loadApplicationConfig(shellInput, { components: ['route'] })
shellConfig.name = tokenPresentation.name
shellConfig.brand.name = tokenPresentation.name

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
watch(() => route.meta.title, title => applyApplicationDocument(shellConfig, {enterpriseLogo:'/logo.svg'}, String(title || tokenPresentation.name)), {immediate:true})



function navigate(path: string) { if (path === '/docs') openTokenApplication(path); else router.push(path) }
</script>

<style scoped src="@/styles/workspace-content.css"></style>
