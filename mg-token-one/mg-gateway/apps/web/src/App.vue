<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const route = useRoute()

onMounted(async () => {
  // 企业微信回跳携带 token
  const token = route.query.token
  if (typeof token === 'string' && token.length > 0) {
    try {
      await auth.loginByToken(token)
      window.history.replaceState({}, '', location.pathname)
    } catch {
      localStorage.removeItem('mg_token')
    }
  } else if (auth.isLoggedIn() && !auth.user) {
    try {
      await auth.fetchMe()
    } catch {
      auth.logout()
    }
  }
})
</script>
