<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Lock } from '@element-plus/icons-vue';
import QRCode from 'qrcode';
const identityAccountUrl = new URL('/account', import.meta.env.VITE_IDENTITY_ORIGIN || 'http://127.0.0.1:14200').href;
import { api, type AccountSecurityState } from '@/api/client';
const state = ref<AccountSecurityState | null>(null);
const error = ref(''); const busy = ref(false);
const action = ref<'bind' | 'remove' | 'email-bind' | 'email-remove' | 'enable' | 'disable' | null>(null);

const credentials = reactive({ password: '', code: '', method: 'totp' });
const emailAddress = ref(''); const emailBinding = ref(''); const emailCode = ref(''); const selectedMethods = ref<string[]>([]);
const binding = ref<{ token: string; secret: string; qr: string } | null>(null);
const bindingCode = ref(''); const recoveryCodes = ref<string[]>([]); const recoverySaved = ref(false);
async function load() { try { state.value = await api.accountSecurity(); } catch (e) { error.value = e instanceof Error ? e.message : '读取账户安全设置失败'; } }
function open(value: typeof action.value) { credentials.password = ''; credentials.code = ''; credentials.method = state.value?.methods[0] || 'totp'; selectedMethods.value = state.value?.methods.length ? [...state.value.methods] : [...(state.value?.totpBound ? ['totp'] : []), ...(state.value?.email ? ['email'] : []), ...(state.value?.keys.length ? ['key'] : [])]; error.value = ''; action.value = value; }
async function execute() {
  if (!state.value || !action.value || busy.value) return;
  if (state.value.mfaEnabled && credentials.method === 'key') { error.value = '安全密钥需要在统一认证原站点验证，请点击下方入口继续。'; return; }
  busy.value = true; error.value = '';
  try {
    const proof = credentials.code;
    const { token } = await api.authorizeSecurity(credentials.password, proof, credentials.method);
    credentials.password = ''; credentials.code = '';
    if (action.value === 'bind') {
      const result = await api.startTotp(token);
      binding.value = { token: result.token, secret: result.secret, qr: await QRCode.toDataURL(result.uri, { width: 220, margin: 2 }) };
      bindingCode.value = '';
    } else if (action.value === 'remove') { await api.removeTotp(token); ElMessage.success('认证器已解绑'); }
    else if (action.value === 'email-bind') { emailBinding.value = (await api.startEmailBinding(token, emailAddress.value.trim())).token; emailCode.value = ''; }
    else if (action.value === 'email-remove') { await api.removeEmailBinding(token); ElMessage.success('邮箱已解绑'); }
    else {
      const result = await api.setMfa(token, action.value === 'enable', selectedMethods.value);
      recoveryCodes.value = result.recoveryCodes; recoverySaved.value = false;
      ElMessage.success(result.enabled ? '多因素验证已开启' : '多因素验证已关闭');
    }
    action.value = null; await load();
  } catch (e) { error.value = e instanceof Error ? e.message : '操作失败，请重新验证身份'; }
  finally { busy.value = false; }
}
async function confirmBinding() {
  if (!binding.value || busy.value) return;
  busy.value = true; error.value = '';
  try { const result = await api.confirmTotp(binding.value.token, bindingCode.value); binding.value = null; bindingCode.value = ''; if (!result.ok) throw new Error('验证码不正确，请重新开始绑定'); await load(); ElMessage.success('认证器已绑定'); }
  catch (e) { error.value = e instanceof Error ? e.message : '绑定失败'; }
  finally { busy.value = false; }
}
onMounted(load);
async function sendSecurityCode() {
  busy.value = true;
  try { await api.sendSecurityEmail(); ElMessage.success('验证码已发送'); }
  catch (e) { error.value = e instanceof Error ? e.message : '发送失败'; }
  finally { busy.value = false; }
}
async function confirmEmail() {
  busy.value = true; error.value = '';
  try { const result = await api.confirmEmailBinding(emailBinding.value, emailCode.value); emailBinding.value = ''; emailCode.value = ''; if (!result.ok) throw new Error('验证码错误或邮箱不可用，请重新绑定'); await load(); ElMessage.success('邮箱已绑定'); }
  catch (e) { error.value = e instanceof Error ? e.message : '绑定失败'; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="security-options" aria-label="多因素验证设置">
    <h2 class="security-heading"><el-icon><Lock /></el-icon>登录保护</h2>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="state">
      <div class="security-row"><div><h3>认证器</h3><p>{{ state.totpBound ? '已绑定' : '支持 Google Authenticator 等6位认证码应用' }}</p></div><el-button :disabled="busy" @click="open(state.totpBound ? 'remove' : 'bind')">{{ state.totpBound ? '解除绑定' : '绑定认证器' }}</el-button></div>
      <div class="security-row"><div><h3>绑定邮箱</h3><p>{{ state.email || '用于接收身份验证码' }}</p></div><el-button :disabled="busy" @click="open(state.email ? 'email-remove' : 'email-bind')">{{ state.email ? '解除绑定' : '绑定邮箱' }}</el-button></div>
      <div class="security-row"><div><h3>安全密钥</h3><p>已绑定 {{ state.keys.length }} 个密钥，在统一认证页面管理。</p></div><el-link :href="identityAccountUrl" target="_blank" rel="noopener noreferrer" type="primary">管理安全密钥 ↗</el-link></div>
      <div v-for="key in state.keys" :key="key.id" class="security-row"><span>{{ key.name }}</span><span>已绑定</span></div>
      <div class="security-row"><div><h3>多因素验证</h3><p>{{ state.mfaEnabled ? '登录时需要额外验证' : '未开启，由你自行选择' }}</p></div><el-button v-if="state.mfaEnabled" :disabled="busy" @click="open('enable')">验证方式</el-button><el-switch :model-value="state.mfaEnabled" :disabled="busy || (!state.mfaEnabled && !state.totpBound && !state.email && !state.keys.length)" aria-label="多因素验证" @change="open(state.mfaEnabled ? 'disable' : 'enable')" /></div>
    </template>
    <el-dialog :model-value="Boolean(action)" title="验证身份" width="440px" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="action = null; credentials.password = ''; credentials.code = ''">
      <el-form label-position="top" @submit.prevent="execute">
        <el-form-item label="当前密码"><el-input v-model="credentials.password" type="password" show-password autocomplete="current-password" :disabled="busy" /></el-form-item>
        <el-form-item v-if="state?.mfaEnabled" label="验证方式"><el-select v-model="credentials.method" :disabled="busy" @change="credentials.code = ''"><el-option v-if="state.methods.includes('totp')" label="认证器" value="totp" /><el-option v-if="state.methods.includes('email')" label="邮箱" value="email" /><el-option v-if="state.methods.includes('key')" label="安全密钥" value="key" /><el-option label="恢复码" value="recovery" /><el-option v-if="state.recentRecovery" label="本次恢复登录" value="recovery_session" /></el-select></el-form-item>
        <el-form-item v-if="state?.mfaEnabled && !['key', 'recovery_session'].includes(credentials.method)" :label="credentials.method === 'recovery' ? '恢复码' : '验证码'"><el-input v-model="credentials.code" :inputmode="credentials.method === 'recovery' ? 'text' : 'numeric'" autocomplete="one-time-code" :maxlength="credentials.method === 'recovery' ? 32 : 6" :disabled="busy" /><el-button v-if="credentials.method === 'email'" :loading="busy" @click="sendSecurityCode">发送验证码</el-button></el-form-item>
        <p v-if="state?.mfaEnabled && credentials.method === 'recovery_session'">本次恢复码验证完成后 5 分钟内，可复核密码恢复账户设置，无需再次消耗恢复码。</p>
        <p v-if="state?.mfaEnabled && credentials.method === 'recovery'">请输入一枚未使用的恢复码，每枚仅能验证一次。设备丢失时，请先关闭多因素验证，再解绑旧设备、重新绑定并开启。</p>
        <el-form-item v-if="action === 'email-bind'" label="邮箱地址"><el-input v-model="emailAddress" type="email" maxlength="254" :disabled="busy" /></el-form-item>
        <el-form-item v-if="action === 'enable'" label="允许的登录验证方式"><el-checkbox-group v-model="selectedMethods"><el-checkbox v-if="state?.totpBound" value="totp">认证器</el-checkbox><el-checkbox v-if="state?.email" value="email">邮箱</el-checkbox><el-checkbox v-if="state?.keys.length" value="key">安全密钥</el-checkbox></el-checkbox-group><p v-if="selectedMethods.includes('email')">邮箱验证依赖邮箱账户安全，防护能力弱于安全密钥。</p></el-form-item>
      </el-form>
      <p v-if="state?.mfaEnabled && credentials.method === 'key'">安全密钥与统一认证站点绑定，请在原站点完成该项安全设置。</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <template #footer><el-button :disabled="busy" @click="action = null">取消</el-button><el-link v-if="state?.mfaEnabled && credentials.method === 'key'" :href="identityAccountUrl" target="_blank" rel="noopener noreferrer" type="primary">在统一认证中继续 ↗</el-link><el-button v-else type="primary" :loading="busy" :disabled="!credentials.password" @click="execute">确认</el-button></template>
    </el-dialog>
    <el-dialog :model-value="Boolean(emailBinding)" title="验证邮箱" width="440px" :close-on-click-modal="false" :show-close="!busy" @close="emailBinding = ''; emailCode = ''">
      <p>验证码已发送至 {{ emailAddress }}，5分钟内有效。</p><el-input v-model="emailCode" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="6位验证码" :disabled="busy" />
      <template #footer><el-button type="primary" :loading="busy" :disabled="emailCode.length !== 6" @click="confirmEmail">确认绑定</el-button></template>
    </el-dialog>
    <el-dialog :model-value="Boolean(binding)" title="绑定认证器" width="440px" :close-on-click-modal="false" :show-close="!busy" @close="binding = null; bindingCode = ''">
      <template v-if="binding"><div class="binding-code"><img :src="binding.qr" alt="认证器绑定二维码" /><p>使用认证器扫码，或手动输入密钥</p><code>{{ binding.secret }}</code></div>
      <el-input v-model="bindingCode" placeholder="输入认证器中的6位验证码" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :disabled="busy" /></template>
      <template #footer><el-button type="primary" :loading="busy" :disabled="bindingCode.length !== 6" @click="confirmBinding">确认绑定</el-button></template>
    </el-dialog>
    <el-dialog :model-value="recoveryCodes.length > 0" title="保存恢复码" width="520px" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false">
      <p>无法使用认证器时可用恢复码登录。每个仅能使用一次，请保存在密码管理器等安全位置，此后不再展示。</p>
      <pre class="recovery-codes">{{ recoveryCodes.join('\n') }}</pre>
      <el-checkbox v-model="recoverySaved">我已安全保存恢复码</el-checkbox>
      <template #footer><el-button type="primary" :disabled="!recoverySaved" @click="recoveryCodes = []">完成</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.security-options { min-width: 0; padding: 24px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: white; box-shadow: 0 2px 8px rgb(24 49 83 / 3%); }
.security-heading { display: flex; align-items: center; gap: 12px; }
.security-heading .el-icon { color: var(--el-color-primary); font-size: 20px; }
h2 { margin: 0 0 16px; font-size: 16px; font-weight: 500; }
.security-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.security-row:last-child { border-bottom: 0; }
.security-row > div { min-width: 0; flex: 1; }
.security-row > span, .security-row p { overflow-wrap: anywhere; }
.security-row > .el-button { min-width: 88px; flex-shrink: 0; }
.security-row > .el-switch { flex-shrink: 0; }
.security-row > span { min-width: 0; font-size: 13px; }
h3 { font-size: 14px; font-weight: 500; margin: 0 0 6px; }
p { font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.7; margin: 0; }
.binding-code { text-align: center; margin-bottom: 20px; }
.binding-code code { display: block; overflow-wrap: anywhere; margin-top: 8px; }
.recovery-codes { background: var(--el-fill-color-light); padding: 16px; font-size: 13px; overflow-x: auto; user-select: all; }
@media (max-width: 560px) {
  .security-options { padding: 16px; }
  .security-row { flex-wrap: wrap; gap: 12px; }
  .security-row > div { flex-basis: calc(100% - 108px); }
}
</style>