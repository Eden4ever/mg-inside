<template>
  <main class="login-page">
    <section class="login-entry" :aria-label="isAdminEntry ? '管理后台登录' : '员工登录'">
      <div class="login-panel">
        <div class="login-brand">
          <img class="login-brand__logo" src="/logo.svg" alt="" aria-hidden="true" />
          <h1>Token One</h1>
        </div>
        <div class="login-panel__heading">
          <h2>{{ isAdminEntry ? '管理后台登录' : '员工登录' }}</h2>
          <p>{{ isAdminEntry ? '组织、渠道与用量管理' : 'LLM API 聚合分发网关' }}</p>
        </div>

        <p v-if="ssoEnabled && error" role="alert">{{ error }}</p>
        <el-button v-if="ssoEnabled" type="primary" size="large" @click="startSso">统一身份登录</el-button>
        <el-form v-if="!ssoEnabled"
          ref="formRef"
          class="login-form"
          :model="form"
          :rules="rules"
          label-position="top"
          size="large"
          @submit.prevent="doLogin"
        >
          <el-form-item label="用户名" prop="username">
            <el-input
              ref="usernameInput"
              v-model="form.username"
              :prefix-icon="User"
              autocomplete="username"
              maxlength="50"
              placeholder="请输入用户名"
              aria-label="用户名"
              @input="error = ''"
              @keyup.enter="doLogin"
            />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              :prefix-icon="Lock"
              type="password"
              autocomplete="current-password"
              maxlength="64"
              placeholder="请输入禅道密码"
              show-password
              aria-label="密码"
              @input="error = ''"
              @keyup.enter="doLogin"
            />
          </el-form-item>

          <p v-if="error" class="login-form__error" role="alert">{{ error }}</p>

          <el-button
            class="login-form__submit"
            type="primary"
            native-type="submit"
            :loading="loading"
          >
            登录
            <el-icon v-if="!loading"><ArrowRight /></el-icon>
          </el-button>
        </el-form>

        <p class="login-panel__tip">
          <el-icon><InfoFilled /></el-icon>
          {{ ssoEnabled ? '账号密码、禅道与企业微信均在统一认证中心登录' : '使用禅道系统账号统一登录' }}
        </p>
      </div>

      <p class="login-entry__foot">Meta Gravity · Token One Gateway</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { useAuthStore } from '@/store/auth'
import { ArrowRight, InfoFilled, Lock, User } from '@element-plus/icons-vue'
import api from '@/api'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const isAdminEntry = computed(() => route.meta.adminLogin === true)

const formRef = ref<FormInstance>()
const usernameInput = ref<{ focus?: () => void }>()
const form = reactive({ username: '', password: '' })
const loading = ref(false)
const error = ref('')
const ssoEnabled = ref(false)
function startSso() {
  const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')
  location.assign(`${base}/auth/sso/start?redirect=${encodeURIComponent(isAdminEntry.value ? '/admin/stats' : '/')}`)
}

const rules: FormRules = {
  username: [
    {
      required: true,
      validator: (_rule, value, callback) => {
        if (!String(value || '').trim()) callback(new Error('请输入用户名'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function doLogin() {
  // 同步置位：回车会同时触发表单原生提交与后续事件，避免重复发起登录请求
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await formRef.value?.validate()
  } catch {
    loading.value = false
    await nextTick()
    document.querySelector<HTMLInputElement>('.login-form .is-error input')?.focus()
    return
  }

  try {
    await auth.login(form.username, form.password)
    if (isAdminEntry.value && !auth.isAdmin()) {
      auth.logout()
      error.value = '该账号没有管理员权限，请从员工入口登录'
      return
    }
    router.replace(isAdminEntry.value ? '/admin/stats' : '/')
  } catch (e: any) {
    error.value = e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const ssoStatus = api.get('/auth/sso/status').then(({ data }) => { ssoEnabled.value = data.enabled === true }).catch(() => {})
  const ssoToken = new URLSearchParams(location.hash.slice(1)).get('sso_token')
  if (ssoToken) {
    history.replaceState({}, '', location.pathname)
    try {
      await auth.loginByToken(ssoToken)
      if (isAdminEntry.value && !auth.isAdmin()) { auth.logout(); error.value = '该账号没有管理员权限'; return }
      await router.replace(isAdminEntry.value ? '/admin/stats' : '/')
    } catch { auth.logout(); error.value = '统一登录失败，请重试或联系管理员' }
    return
  }
  if (route.query.sso_error) error.value = '统一登录失败或原账号尚未关联，请联系管理员'
  if (auth.isLoggedIn()) {
    router.replace(isAdminEntry.value && auth.isAdmin() ? '/admin/stats' : '/')
    return
  }
  const t = route.query.token
  if (typeof t === 'string' && t.length > 0) {
    setTimeout(() => {
      if (auth.isLoggedIn()) router.replace('/')
    }, 300)
    return
  }
  await ssoStatus
  if (ssoEnabled.value && !route.query.sso_error) { startSso(); return }
  usernameInput.value?.focus?.()
})
</script>

<style scoped>
.login-page {
  min-height: 100%;
  display: flex;
  /* 兜底：color-mix 晚于本项目的构建基线（Chrome 111 vs 107），不支持时整条 background 会失效 */
  background: var(--mg-bg-surface);
  background:
    radial-gradient(circle at 18% 16%, color-mix(in srgb, var(--mg-color-brand) 10%, transparent) 0, transparent 36%),
    radial-gradient(circle at 84% 88%, color-mix(in srgb, var(--mg-color-success) 8%, transparent) 0, transparent 34%),
    var(--mg-bg-surface);
}

.login-entry {
  width: 100%;
  min-height: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mg-space-lg);
  padding: var(--mg-space-xxl);
}

.login-panel {
  width: min(100%, 400px);
  display: flex;
  flex-direction: column;
  gap: var(--mg-space-xl);
  padding: var(--mg-space-xxl);
  background: var(--mg-bg-surface);
  border: 1px solid var(--mg-border-lighter);
  border-radius: 8px;
  box-shadow: 0 12px 36px rgba(48, 49, 51, .09);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: var(--mg-space-md);
}

.login-brand__logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.login-brand h1,
.login-panel__heading h2,
.login-panel__heading p,
.login-form__error {
  margin: 0;
}

.login-brand h1 {
  font-family: var(--mg-font-family-brand);
  font-size: var(--mg-font-size-xl);
  font-weight: var(--mg-font-weight-medium);
}

.login-panel__heading {
  display: flex;
  flex-direction: column;
  gap: var(--mg-space-xs);
}

.login-panel__heading h2 {
  font-size: var(--mg-font-size-lg);
  line-height: 1.4;
}

.login-panel__heading p {
  color: var(--mg-text-secondary);
  font-size: var(--mg-font-size-sm);
  line-height: var(--mg-line-height-base);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--mg-space-xs);
}

.login-form__error {
  color: var(--mg-color-danger);
  font-size: var(--mg-font-size-sm);
  line-height: var(--mg-line-height-base);
}

.login-form__submit {
  width: 100%;
}

.login-panel__tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mg-space-xs);
  margin: 0;
  color: var(--mg-text-secondary);
  font-size: var(--mg-font-size-xs);
}

.login-panel__tip .el-icon {
  color: var(--mg-color-brand);
}

.login-entry__foot {
  margin: 0;
  color: var(--mg-text-secondary);
  font-size: var(--mg-font-size-xs);
}

@media (max-width: 480px) {
  .login-brand__logo {
    width: 32px;
    height: 32px;
  }

  .login-entry {
    padding: var(--mg-space-xxl) var(--mg-space-lg);
  }

  .login-panel {
    padding: var(--mg-space-xl);
    box-shadow: 0 8px 24px rgba(48, 49, 51, .08);
  }
}
</style>
