<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { startAuthentication } from '@simplewebauthn/browser';
import { Lock, User } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import logoUrl from '../../../../logo.svg?url';
import wecomLogoUrl from '@/assets/wecom.svg?url';
import beianLogoUrl from '@/assets/beian.png?url';
import { api } from '@/api/client';
import { identityEndpoint } from '@/api/identity';
import { desktop, unifiedDesktop } from '../desktop';
import type { SessionUser } from '@/types/domain';

const emit = defineEmits<{ authenticated: [user: SessionUser] }>();
const form = reactive({ username: '', password: '' });
const pending = ref<'setup_required' | 'mfa_required' | null>(null);
const setup = reactive({ username: '', password: '', confirmation: '' });
const mfa = reactive({ method: 'totp', code: '', methods: [] as string[] });
const busy = ref(false);
const wecomBusy = ref(false);
const ssoEnabled = ref(unifiedDesktop);
function startSso() { if(unifiedDesktop) desktop.login(); else window.location.assign(identityEndpoint('start')); }
const wecom = ref({ enabled: false, message: '正在检查企业微信登录配置' });

onMounted(async () => {
  if (unifiedDesktop) { startSso(); return; }
  const ssoStatus = fetch(identityEndpoint('status')).then(r => r.json()).then(s => { ssoEnabled.value = s.enabled === true; }).catch(() => {});
  try { await loadPending(); } catch { /* 没有待完成的认证时正常登录。 */ }
  if (import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    try {
      const response = await fetch('/__local-login-defaults', { cache: 'no-store' });
      if (response.ok) {
        const defaults = await response.json();
        if (!form.username && !form.password) {
          form.username = defaults.username || '';
          form.password = defaults.password || '';
        }
      }
    } catch { /* 本地预填不可用时仍可手动登录。 */ }
  }
  const authError = new URLSearchParams(window.location.search).get('authError');
  if (authError) {
    ElMessage.error('统一登录失败或账号尚未获得系统授权，请重试或联系管理员');
    window.history.replaceState({}, '', window.location.pathname);
  }
  try {
    wecom.value = await api.wecomStatus();
  } catch {
    wecom.value = { enabled: false, message: '暂时无法读取企业微信登录配置' };
  }
  await ssoStatus;
  if (ssoEnabled.value && !pending.value && !authError) startSso();
});

async function login() {
  if (busy.value || wecomBusy.value) return;
  if (!form.username.trim() || !form.password) return ElMessage.warning('请输入账号和密码');
  busy.value = true;
  try {
    const result = await api.login(form.username.trim(), form.password);
    if ('user' in result) emit('authenticated', result.user);
    else { form.password = ''; await loadPending(); }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败');
  } finally {
    busy.value = false;
  }
}

async function loadPending() {
  const result = await api.pendingAuth();
  pending.value = result.state; setup.username = result.username;
  mfa.methods = result.methods; mfa.method = result.methods[0] || 'recovery';
}

async function verifyMfa() {
  if (busy.value || (mfa.method !== 'key' && !mfa.code.trim())) return;
  busy.value = true;
  try { const code = mfa.method === 'key' ? await startAuthentication({ optionsJSON: await api.mfaKeyOptions() }) : mfa.code.trim(); const result = await api.verifyMfa(mfa.method, code); mfa.code = ''; if ('user' in result) emit('authenticated', result.user); else await loadPending(); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '验证失败'); }
  finally { busy.value = false; }
}

async function sendEmailCode() {
  if (busy.value) return;
  busy.value = true;
  try { await api.sendMfaEmail(); ElMessage.success('验证码已发送，请检查绑定邮箱'); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '发送失败'); }
  finally { busy.value = false; }
}

async function completeSetup() {
  if (busy.value) return;
  if (setup.password.length < 15 || setup.password.length > 128) return ElMessage.warning('密码长度需为15至128位');
  if (setup.password !== setup.confirmation) return ElMessage.warning('两次输入的密码不一致');
  busy.value = true;
  try { const result = await api.setupCredentials(setup.username.trim(), setup.password); setup.password = ''; setup.confirmation = ''; emit('authenticated', result.user); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '设置失败'); }
  finally { busy.value = false; }
}

async function startWeCom() {
  if (!wecom.value.enabled || wecomBusy.value || busy.value) return;
  wecomBusy.value = true;
  try {
    const result = await api.startWeCom();
    window.location.assign(result.loginUrl);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '企业微信登录暂不可用');
  } finally {
    wecomBusy.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <div class="login-ambience" aria-hidden="true"><span class="login-glow login-glow-blue"></span><span class="login-glow login-glow-green"></span></div>
    <div class="login-content">
    <section class="login-brand" aria-label="营商环境指标知识库">
      <img :src="logoUrl" alt="元引" />
      <div>
        <h1>营商环境指标知识库</h1>
      </div>
    </section>
    <el-card class="login-card" shadow="never">
      <template #header><div class="login-title"><h2>{{ pending === 'setup_required' ? '设置账号' : pending === 'mfa_required' ? '身份验证' : '登录' }}</h2></div></template>
      <el-button v-if="ssoEnabled" class="wecom-button" @click="startSso">统一身份登录</el-button>
        <el-form v-show="!ssoEnabled" v-if="pending === 'setup_required'" label-position="top" @submit.prevent="completeSetup">
        <el-form-item label="用户名"><el-input v-model="setup.username" maxlength="50" autocomplete="username" size="large" :disabled="busy" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="setup.password" type="password" show-password maxlength="128" autocomplete="new-password" placeholder="15至128位" size="large" :disabled="busy" /></el-form-item>
        <el-form-item label="确认密码"><el-input v-model="setup.confirmation" type="password" show-password maxlength="128" autocomplete="new-password" size="large" :disabled="busy" /></el-form-item>
        <el-button class="login-submit" type="primary" native-type="submit" size="large" :loading="busy">保存并进入</el-button>
      </el-form>
      <el-form v-else-if="!ssoEnabled && pending === 'mfa_required'" label-position="top" @submit.prevent="verifyMfa">
        <el-form-item label="验证方式"><el-select v-model="mfa.method" :disabled="busy"><el-option v-if="mfa.methods.includes('totp')" label="认证器验证码" value="totp" /><el-option v-if="mfa.methods.includes('email')" label="邮箱验证码" value="email" /><el-option v-if="mfa.methods.includes('key')" label="安全密钥" value="key" /><el-option label="一次性恢复码" value="recovery" /></el-select></el-form-item>
        <el-button v-if="mfa.method === 'email'" :loading="busy" @click="sendEmailCode">发送邮箱验证码</el-button>
        <el-form-item v-if="mfa.method !== 'key'" :label="mfa.method !== 'recovery' ? '6位验证码' : '恢复码'"><el-input v-model="mfa.code" :maxlength="mfa.method !== 'recovery' ? 6 : 128" autocomplete="one-time-code" :inputmode="mfa.method !== 'recovery' ? 'numeric' : 'text'" size="large" :disabled="busy" /></el-form-item>
        <el-button class="login-submit" type="primary" native-type="submit" size="large" :loading="busy">验证并登录</el-button>
      </el-form>
      <el-form v-else-if="!ssoEnabled" label-position="top" @submit.prevent="login">
        <el-form-item label="账号">
          <el-input v-model="form.username" autocomplete="username" size="large" placeholder="请输入账号" :prefix-icon="User" :disabled="busy || wecomBusy" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" autocomplete="current-password" show-password size="large" placeholder="请输入密码" :prefix-icon="Lock" :disabled="busy || wecomBusy" />
        </el-form-item>
        <el-button type="primary" size="large" native-type="submit" :loading="busy" :disabled="wecomBusy" class="login-submit">登录</el-button>
      </el-form>
      <el-divider v-if="!ssoEnabled && !pending"><span>企业成员</span></el-divider>
      <el-button v-if="!ssoEnabled && !pending" size="large" class="wecom-button" :disabled="!wecom.enabled || busy" :loading="wecomBusy" @click="startWeCom">
        <img class="wecom-logo" :src="wecomLogoUrl" alt="" />企业微信扫码登录
      </el-button>
      <p v-if="!ssoEnabled && !pending && !wecom.enabled" class="wecom-status">{{ wecom.message }}</p>
    </el-card>
    </div>
    <footer class="login-footer" aria-label="版权与备案信息">
      <span>© 2026 郑州元引信息科技有限公司</span>
      <div class="login-registrations">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">豫ICP备2026018311号-1</a>
        <a href="https://beian.mps.gov.cn/#/query/webSearch?code=41010702004272" target="_blank" rel="noopener noreferrer">
          <img :src="beianLogoUrl" alt="" width="16" height="16" />豫公网安备41010702004272号
        </a>
      </div>
    </footer>
  </main>
</template>

<style scoped>
.login-page {
  position: relative; isolation: isolate; width: 100%; max-width: 100%; height: 100vh; height: 100dvh; min-height: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: safe center;
  overflow: auto; overscroll-behavior: contain; padding: 48px 24px 20px;
  background: radial-gradient(ellipse at 18% 12%, rgb(199 219 251 / 65%), transparent 48%), radial-gradient(ellipse at 90% 8%, rgb(230 241 220 / 56%), transparent 43%), radial-gradient(ellipse at 76% 92%, rgb(221 227 248 / 34%), transparent 42%), linear-gradient(140deg, #f4f7fc 0%, #fafcfe 52%, #f4f8fc 100%);
}
.login-content { width: 100%; flex: 1 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-bottom: 32px; }
.login-footer { position: relative; z-index: 1; flex-shrink: 0; max-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 5px; color: #788598; font-size: 12px; line-height: 1.8; text-align: center; }
.login-registrations { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; }
.login-footer a { display: inline-flex; align-items: center; gap: 5px; color: inherit; text-decoration: none; }
.login-footer a:hover { color: var(--el-color-primary); }
.login-footer a:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; border-radius: 2px; }
.login-footer img { flex-shrink: 0; object-fit: contain; }
.login-ambience { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; contain: paint; }
.login-glow { position: absolute; width: min(76vw, 900px); height: min(90vh, 800px); min-width: 360px; min-height: 360px; border-radius: 50%; opacity: .6; animation: login-glow-drift 28s ease-in-out infinite alternate; }
.login-glow-blue { left: -12%; top: -16%; background: radial-gradient(ellipse, rgb(83 136 225 / 13%), transparent 68%); }
.login-glow-green { right: -12%; bottom: -20%; background: radial-gradient(ellipse, rgb(146 186 132 / 13%), transparent 68%); animation-duration: 34s; animation-delay: -16s; --glow-x: -24px; --glow-y: -18px; }
@keyframes login-glow-drift { from { transform: translate3d(0, 0, 0) scale(1); opacity: .6; } to { transform: translate3d(var(--glow-x, 24px), var(--glow-y, 22px), 0) scale(1.035); opacity: .9; } }
.login-brand, .login-card { position: relative; z-index: 1; flex-shrink: 0; }
.login-brand { width: min(420px, 100%); min-width: 0; display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 28px; }
.login-brand img { flex-shrink: 0; width: 42px; height: 42px; object-fit: contain; filter: drop-shadow(0 3px 5px rgb(57 98 164 / 10%)); }
.login-brand h1 { margin: 0; color: #23334b; font-family: var(--mg-font-family-brand); font-size: 22px; font-weight: 400; line-height: 1.45; letter-spacing: .3px; }
.login-card { width: min(420px, 100%); max-width: 100%; min-width: 0; border: 1px solid rgb(255 255 255 / 90%); border-radius: 12px; background: rgb(255 255 255 / 96%); box-shadow: 0 18px 56px rgb(36 65 111 / 8%), 0 2px 8px rgb(36 65 111 / 4%), 0 0 0 1px rgb(111 137 176 / 7%); }
.login-card :deep(.el-card__header) { padding: 30px 32px 0; border: 0; }
.login-card :deep(.el-card__body) { padding: 26px 32px 30px; }
.login-title { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.login-title h2 { margin: 0; color: #23334b; font-size: 22px; font-weight: 500; line-height: 1.45; }
.wecom-status { min-width: 0; color: #8490a2; font-size: 12px; line-height: 1.7; }
.login-card :deep(.el-form-item) { margin-bottom: 20px; }
.login-card :deep(.el-form-item__label) { padding-bottom: 8px; color: #526174; font-size: 13px; line-height: 20px; }
.login-card :deep(.el-input__wrapper) { min-height: 44px; padding: 1px 12px; border-radius: 6px; background: #fbfcfe; box-shadow: 0 0 0 1px #dfe6ef inset; transition: background .16s ease, box-shadow .16s ease; }
.login-card :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px #bdcde3 inset; }
.login-card :deep(.el-input__wrapper.is-focus) { background: #fff; box-shadow: 0 0 0 1px var(--el-color-primary) inset, 0 0 0 3px rgb(0 82 217 / 7%); }
.login-card :deep(.el-input__prefix-inner) { color: #91a1b8; }
.login-submit, .wecom-button { width: 100%; min-height: 44px; border-radius: 6px; }
.login-submit { margin-top: 4px; border-color: transparent; background: linear-gradient(115deg, #1768de, #0052d9); box-shadow: 0 3px 8px rgb(0 82 217 / 13%); font-weight: 500; }
.login-submit:hover, .login-submit:focus-visible { border-color: transparent; background: linear-gradient(115deg, #2878e9, #1463dd); box-shadow: 0 4px 12px rgb(0 82 217 / 18%); }
.login-submit.is-disabled { background: var(--el-color-primary-light-5); box-shadow: none; }
.login-card :deep(.el-divider) { margin: 26px 0 22px; border-color: #e8edf4; }
.login-card :deep(.el-divider__text) { padding: 0 14px; color: #9aa5b4; background: #fff; font-size: 12px; }
.wecom-button { gap: 7px; color: #5c6c7e; border-color: #dfe6ef; background: #fff; }
.wecom-logo { width: 22px; height: 18px; margin-right: 7px; flex-shrink: 0; object-fit: contain; }
.wecom-button:not(.is-disabled):hover, .wecom-button:not(.is-disabled):focus-visible { color: #257e53; border-color: #b5d7c4; background: #f6fbf8; }
.wecom-button.is-disabled { color: #a2adba; border-color: #e7ecf2; background: #f9fbfd; }
.wecom-button.is-disabled .wecom-logo { opacity: .55; }
.wecom-status { margin: 10px 0 0; text-align: center; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .login-page { padding: 32px 20px; }
  .login-brand { gap: 10px; margin-bottom: 24px; }
  .login-brand img { width: 36px; height: 36px; }
  .login-brand h1 { font-size: 20px; letter-spacing: 0; }
  .login-card :deep(.el-card__header) { padding: 26px 24px 0; }
  .login-card :deep(.el-card__body) { padding: 24px; }
}
@media (max-width: 360px) {
  .login-page { padding: 24px 14px; }
  .login-brand { gap: 8px; }
  .login-brand img { width: 32px; height: 32px; }
  .login-brand h1 { font-size: 18px; }
  .login-card :deep(.el-card__header) { padding: 24px 20px 0; }
  .login-card :deep(.el-card__body) { padding: 22px 20px; }
}
@media (prefers-reduced-motion: reduce) { .login-glow { animation: none; } .login-card :deep(.el-input__wrapper), .login-submit, .wecom-button { transition: none; } }
</style>
