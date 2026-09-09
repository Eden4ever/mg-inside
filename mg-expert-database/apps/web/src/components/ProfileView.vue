<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { ArrowLeft, Lock, Warning } from '@element-plus/icons-vue';
import { api, ApiError } from '@/api/client';
import type { SessionUser } from '@/types/domain';
import AccountSecurity from './AccountSecurity.vue';
import { desktop } from '../desktop';

const props = defineProps<{
  user: SessionUser;
}>();

const emit = defineEmits<{
  back: [];
  expired: [];
}>();

const roleLabels: Record<string, string> = { system_admin: '系统管理员', catalog_manager: '指标管理员', researcher: '研究员', reviewer: '审核员', publisher: '发布员', reader: '普通用户' };
const isSso = computed(() => props.user.authSource === 'sso');
const isWeCom = computed(() => props.user.authSource === 'wecom');
const authSourceLabel = computed(() => (isSso.value ? '统一认证' : isWeCom.value ? '企业微信' : '本地账号'));

const formRef = ref<FormInstance>();
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const saving = ref(false);

const passwordRules: FormRules = {
  currentPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 10, max: 128, message: '新密码长度需为 10-128 位', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) => {
        if (value && value === passwordForm.currentPassword) callback(new Error('新密码不能与当前密码相同'));
        else callback();
      },
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) => {
        if (value !== passwordForm.newPassword) callback(new Error('两次输入的新密码不一致'));
        else callback();
      },
      trigger: 'blur',
    },
  ],
};

async function submitPassword() {
  if (saving.value || !formRef.value) return;
  if (!passwordForm.currentPassword) {
    ElMessage.warning('请输入当前密码');
    return;
  }
  if (passwordForm.newPassword.length < 10 || passwordForm.newPassword.length > 128) {
    ElMessage.warning('新密码长度需为 10-128 位');
    return;
  }
  if (passwordForm.newPassword === passwordForm.currentPassword) {
    ElMessage.warning('新密码不能与当前密码相同');
    return;
  }
  if (passwordForm.confirmPassword !== passwordForm.newPassword) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  saving.value = true;
  try {
    await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
    ElMessage.success('密码已修改，当前会话保持登录');
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
    formRef.value?.clearValidate();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      emit('expired');
      return;
    }
    ElMessage.error(error instanceof Error ? error.message : '修改密码失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="profile-page primary-page">
    <header class="profile-header primary-page-heading">
      <div class="profile-title">
        <h1>个人中心</h1>
      </div>
      <el-button class="back-button" :icon="ArrowLeft" @click="emit('back')">返回体系</el-button>
    </header>

    <div class="profile-scroll primary-page-scroll" tabindex="0" role="region" aria-label="个人资料与账户安全">
    <div class="profile-body">
      <section class="profile-panel account-panel" aria-labelledby="account-title">
        <div class="profile-identity">
          <el-avatar :size="56">{{ user.name.slice(0, 1) }}</el-avatar>
          <div>
            <h2 id="account-title">{{ user.name }}</h2>
            <p>{{ user.username || '企业微信用户' }}</p>
          </div>
          <el-tag type="success" effect="plain">已登录</el-tag>
        </div>

        <dl class="account-list">
          <div><dt>部门</dt><dd>{{ user.departmentName || '—' }}</dd></div>
          <div><dt>平台角色</dt><dd>{{ roleLabels[user.role] || user.role }}</dd></div>
          <div><dt>认证方式</dt><dd>{{ authSourceLabel }}</dd></div>
        </dl>
      </section>

      <section v-if="isSso" class="profile-panel"><h2>账号安全</h2><p>账号资料、密码和二次验证在统一认证中心管理。</p><el-button v-if="desktop.enabled" @click="desktop.openApplication('identity', '/account')">管理账号安全</el-button><a v-else href="https://identity.meta-gravity.com/account" target="_blank" rel="noopener">管理账号安全</a></section>
      <section v-else class="profile-panel security-panel" aria-labelledby="security-title">
        <div class="section-heading">
          <el-icon><Lock /></el-icon>
          <div><h2 id="security-title">登录密码</h2></div>
        </div>

        <el-alert v-if="!user.username" type="info" :closable="false" show-icon title="企业微信认证账号">
          <p class="wecom-note">当前账号通过企业微信扫码认证登录，未设置本地密码。如需调整登录方式，请联系系统管理员。</p>
        </el-alert>

        <template v-else>
          <el-form ref="formRef" :model="passwordForm" :rules="passwordRules" label-position="top" class="password-form" @submit.prevent>
            <el-form-item label="当前密码" prop="currentPassword">
              <el-input v-model="passwordForm.currentPassword" type="password" show-password autocomplete="current-password" placeholder="请输入当前密码" />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input v-model="passwordForm.newPassword" type="password" show-password autocomplete="new-password" placeholder="10-128 位，且不能与当前密码相同" />
            </el-form-item>
            <el-form-item label="确认新密码" prop="confirmPassword">
              <el-input v-model="passwordForm.confirmPassword" type="password" show-password autocomplete="new-password" placeholder="请再次输入新密码" />
            </el-form-item>
            <div class="primary-page-actions"><el-button class="save-button" type="primary" :loading="saving" :disabled="saving" @click="submitPassword">保存新密码</el-button></div>
          </el-form>
          <p class="profile-tip"><el-icon><Warning /></el-icon><span>修改后仅保留当前会话，其他设备将退出登录。</span></p>
        </template>
      </section>
      <AccountSecurity v-if="!isSso" class="protection-panel" />
    </div>
    </div>
  </main>
</template>

<style scoped>
.profile-page {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 16px 32px;
  background: #fff;
}

.profile-header {
  position: sticky;
  top: -16px;
  z-index: 5;
  min-height: 56px;
  margin: -16px -16px 24px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.profile-title h1 { margin: 0; font-size: 20px; line-height: 1.5; font-weight: 600; }
.profile-title p { margin: 2px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }

.profile-scroll { container-type: inline-size; }

.profile-body {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  grid-template-areas: "account account" "password protection";
  gap: 20px;
  align-items: start;
}

.security-panel { grid-area: password; }
.protection-panel { grid-area: protection; }

.profile-panel {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 2px 8px rgb(24 49 83 / 3%);
}

.account-panel { grid-area: account; display: flex; align-items: center; gap: 32px; background: linear-gradient(110deg, var(--el-color-primary-light-9), #fff 52%); }
.account-panel .profile-identity { flex: 1; min-width: 0; padding: 0; border: 0; }
.account-panel .account-list { flex: 1.5; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; gap: 24px; }
.account-panel .account-list > div { display: flex; flex-direction: column; gap: 8px; padding: 0 0 0 24px; border: 0; border-left: 1px solid var(--el-border-color-lighter); font-size: 13px; }
.profile-identity h2, .profile-identity p { overflow-wrap: anywhere; }

.profile-identity {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.profile-identity .el-avatar {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 20px;
}

.profile-identity h2,
.section-heading h2 { margin: 0; font-size: 16px; line-height: 1.5; font-weight: 500; }
.profile-identity p,
.section-heading p { margin: 3px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }

.account-list { margin: 8px 0 0; }
.account-list > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--el-border-color-extra-light); }
.account-list > div:last-child { border-bottom: 0; padding-bottom: 0; }
.account-list dt { color: var(--el-text-color-secondary); }
.account-list dd { margin: 0; color: var(--el-text-color-primary); overflow-wrap: anywhere; }

.section-heading { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 24px; }
.section-heading > .el-icon { margin-top: 2px; color: var(--el-color-primary); font-size: 20px; }
.password-form { max-width: 520px; }
.password-form :deep(.el-form-item) { margin-bottom: 18px; }
.password-form :deep(.el-form-item__label) { padding-bottom: 6px; line-height: 20px; }
.save-button { min-width: 112px; }

.wecom-note { margin: 4px 0 0; font-size: 13px; line-height: 1.6; }
.profile-tip { display: flex; align-items: flex-start; gap: 8px; margin: 18px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.profile-tip .el-icon { flex: 0 0 auto; margin-top: 2px; }

@media (max-width: 820px) {
  .profile-body { grid-template-columns: minmax(0, 1fr); grid-template-areas: "account" "password" "protection"; gap: 16px; }
}

@container (max-width: 820px) {
  .profile-body { grid-template-columns: minmax(0, 1fr); grid-template-areas: "account" "password" "protection"; gap: 16px; }
}

@container (max-width: 900px) {
  .account-panel { flex-direction: column; align-items: stretch; gap: 20px; }
  .account-panel .account-list { flex: auto; gap: 16px; }
  .account-panel .account-list > div { padding-left: 0; border: 0; }
}

@media (max-width: 560px) {
  .profile-page { padding: 12px 12px 24px; }
  .profile-header { top: -12px; margin: -12px -12px 16px; padding: 10px 12px; }
  .profile-title p { display: none; }
  .profile-panel { padding: 16px; }
  .profile-identity { grid-template-columns: 48px minmax(0, 1fr); }
  .profile-identity .el-avatar { width: 48px !important; height: 48px !important; }
  .profile-identity > .el-tag { grid-column: 2; justify-self: start; }
  .account-panel { flex-direction: column; align-items: stretch; gap: 20px; }
  .account-panel .account-list { gap: 12px; }
  .account-panel .account-list > div { padding-left: 0; border: 0; }
}
</style>
