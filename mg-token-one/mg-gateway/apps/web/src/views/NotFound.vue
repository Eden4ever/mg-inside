<template>
  <main class="not-found">
    <div class="not-found__code">404</div>
    <h1>页面不存在</h1>
    <p>这个地址已经移除，或尚未发布。</p>
    <div class="not-found__actions">
      <el-button type="primary" @click="router.push('/dashboard')">返回员工门户</el-button>
      <el-button @click="router.push('/docs/')">查看开发文档</el-button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<style scoped>
.not-found { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 24px; background: var(--app-bg); color: var(--ink); text-align: center; }
.not-found__code { color: var(--brand); font-size: 64px; font-weight: 800; line-height: 1; letter-spacing: 0; }
.not-found h1, .not-found p { margin: 0; }
.not-found h1 { font-size: 22px; }
.not-found p { color: var(--ink-2); }
.not-found__actions { display: flex; gap: 10px; margin-top: 10px; }
@media (max-width: 480px) { .not-found__actions { flex-direction: column; width: 100%; } }
</style>
