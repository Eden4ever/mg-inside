<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>企业微信</h2>
        <p class="sub">企业微信登录与组织架构同步</p>
      </div>
      <el-button type="primary" :icon="Refresh" :loading="syncing" @click="sync">同步通讯录</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :md="14">
        <div class="page-card">
          <div class="panel-title">连接配置</div>
          <el-form :model="form" label-width="150px" label-position="right">
            <el-form-item label="Corp ID">
              <el-input v-model="form.corpid" placeholder="企业 ID" />
            </el-form-item>
            <el-form-item label="Agent ID">
              <el-input v-model="form.agentid" placeholder="自建应用 AgentId" />
            </el-form-item>
            <el-form-item label="Secret">
              <el-input
                v-model="form.secret"
                type="password"
                show-password
                :placeholder="secretMasked ? '已配置（留空不修改）' : '应用 Secret'"
              />
            </el-form-item>
            <el-form-item label="回调地址路径">
              <el-input v-model="form.callbackPath" placeholder="/api/auth/wecom/callback" />
            </el-form-item>
            <el-form-item label="管理员白名单(用户)">
              <el-input v-model="form.adminUserIds" placeholder="逗号分隔的 userid" />
            </el-form-item>
            <el-form-item label="管理员白名单(部门)">
              <el-input v-model="form.adminDeptIds" placeholder="逗号分隔的部门 id" />
            </el-form-item>
            <el-form-item label="启用企微登录">
              <el-switch v-model="form.enabledOn" active-text="启用" inactive-text="停用" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-col>
      <el-col :xs="24" :md="10">
        <div class="page-card">
          <div class="panel-title">接入指引</div>
          <el-timeline style="padding-left: 4px">
            <el-timeline-item type="primary" timestamp="第 1 步">
              企业微信管理后台创建自建应用，记录 CorpID / AgentId / Secret
            </el-timeline-item>
            <el-timeline-item type="primary" timestamp="第 2 步">
              将本系统域名配置为「可信域名」，出口 IP 加入「可信 IP」
            </el-timeline-item>
            <el-timeline-item type="primary" timestamp="第 3 步">
              应用开启「网页授权」与「读取成员」权限
            </el-timeline-item>
            <el-timeline-item type="success" timestamp="完成">
              保存配置后点击「同步通讯录」拉取组织与成员
            </el-timeline-item>
          </el-timeline>
          <el-divider />
          <div class="cb-label">回调地址</div>
          <div class="code-block" style="font-size: 12px">{{ publicUrl }}{{ form.callbackPath }}</div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import api from '@/api'

const saving = ref(false)
const syncing = ref(false)
const secretMasked = ref(false)
const publicUrl = ref('')
const form = reactive({
  corpid: '', agentid: '', secret: '',
  callbackPath: '/api/auth/wecom/callback',
  adminUserIds: '', adminDeptIds: '', enabledOn: true,
})

async function load() {
  try {
    const { data } = await api.get('/wecom/config')
    secretMasked.value = !!data.secretMasked
    Object.assign(form, {
      corpid: data.corpid || '', agentid: data.agentid || '', secret: '',
      callbackPath: data.callbackPath || '/api/auth/wecom/callback',
      adminUserIds: data.adminUserIds || '', adminDeptIds: data.adminDeptIds || '',
      enabledOn: data.enabled !== 0,
    })
    publicUrl.value = (data.gatewayPublicUrl as string) || ''
  } catch { /* ignore */ }
}

async function save() {
  saving.value = true
  try {
    const payload: any = {
      corpid: form.corpid, agentid: form.agentid, callbackPath: form.callbackPath,
      adminUserIds: form.adminUserIds, adminDeptIds: form.adminDeptIds,
      enabled: form.enabledOn ? 1 : 0,
    }
    if (form.secret) payload.secret = form.secret
    await api.put('/wecom/config', payload)
    ElMessage.success('配置已保存')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function sync() {
  syncing.value = true
  try {
    const { data } = await api.post('/wecom/sync')
    ElMessage.success(`同步完成：部门 ${data.departments}，用户 ${data.users}`)
  } catch (e: any) {
    ElMessage.error(e?.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.panel-title { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
.cb-label { font-size: 13px; color: var(--ink-3); margin-bottom: 6px; }
</style>
