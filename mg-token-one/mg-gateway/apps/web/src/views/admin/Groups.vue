<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>分组管理</h2>
        <p class="sub">分组决定用户可见与可访问的模型（用户 ↔ 分组与模型均为多对多）</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建分组</el-button>
    </div>

    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column prop="name" label="分组名" width="160">
          <template #default="{ row }">
            <el-tag effect="dark" :type="row.name === 'default' ? 'primary' : 'success'" round>
              {{ row.name }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.description || '—' }}</template>
        </el-table-column>
        <el-table-column label="每人每月额度" width="150" align="center">
          <template #default="{ row }">¥{{ Number(row.monthlyQuota || 0).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="包含模型" min-width="240">
          <template #default="{ row }">
            <template v-if="row.modelNames && row.modelNames.length">
              <el-tag
                v-for="m in row.modelNames" :key="m" size="small" effect="plain"
                style="margin: 2px 4px 2px 0"
              >{{ m }}</el-tag>
            </template>
            <span v-else style="color: var(--ink-3)">暂无模型</span>
          </template>
        </el-table-column>
        <el-table-column prop="modelCount" label="数量" width="70" align="center" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" round>
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">管理</el-button>
            <el-button size="small" text type="danger" :disabled="row.name === 'default'" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无分组" />
        </template>
      </el-table>
    </div>

    <el-alert type="info" :closable="false" show-icon style="margin-top: 14px"
      title="在“管理”中选择模型即可调整分组关联。一个模型可属于多个分组，用户可访问所属全部分组模型的并集。" />

    <el-dialog v-model="visible" :title="editing ? '编辑分组' : '新建分组'" width="480px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="分组名" required>
          <el-input v-model="form.name" :disabled="editing" placeholder="如 vip / dept-a" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" placeholder="可选" />
        </el-form-item>
        <el-form-item label="月度额度">
          <el-input-number v-model="form.monthlyQuota" :min="0" :precision="2" :step="10" style="width: 100%" />
          <div class="form-tip">每位普通员工每自然月可消费的人民币额度；多群组时取最高值。</div>
        </el-form-item>
        <el-form-item label="模型">
          <el-select v-model="form.models" multiple filterable :loading="modelsLoading" style="width: 100%" placeholder="选择要归入此分组的模型">
            <el-option v-for="model in allModels" :key="model.id" :label="model.name" :value="model.name">
              <span>{{ model.name }}</span>
              <span class="model-option__group">当前：{{ (model.groupNames || []).join('、') || '未分配' }}</span>
            </el-option>
          </el-select>
          <div class="form-tip">保存后仅更新当前分组与模型的关联，不会改变模型在其他分组中的归属。</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.statusOn" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import api from '@/api'

const rows = ref<any[]>([])
const loading = ref(false)
const visible = ref(false)
const editing = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const allModels = ref<any[]>([])
const modelsLoading = ref(false)
const form = reactive({ name: '', description: '', monthlyQuota: 0, statusOn: true, models: [] as string[] })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/groups')
    rows.value = data
  } finally {
    loading.value = false
  }
}

async function loadModelCatalog() {
  modelsLoading.value = true
  try {
    const { data } = await api.get('/admin/groups/model-catalog')
    allModels.value = data
  } finally {
    modelsLoading.value = false
  }
}

function openCreate() {
  editing.value = false
  editingId.value = null
  Object.assign(form, { name: '', description: '', monthlyQuota: 0, statusOn: true, models: [] })
  visible.value = true
}

function openEdit(row: any) {
  editing.value = true
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    description: row.description || '',
    monthlyQuota: Number(row.monthlyQuota || 0),
    statusOn: row.status === 1,
    models: [...(row.modelNames || [])],
  })
  visible.value = true
}

async function save() {
  if (!form.name) {
    ElMessage.warning('请填写分组名')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.name,
      description: form.description || undefined,
      monthlyQuota: form.monthlyQuota,
      status: form.statusOn ? 1 : 0,
      models: form.models,
    }
    if (editing.value) await api.put(`/admin/groups/${editingId.value}`, payload)
    else await api.post('/admin/groups', payload)
    ElMessage.success('保存成功')
    visible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除分组「${row.name}」？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  await api.delete(`/admin/groups/${row.id}`)
  ElMessage.success('已删除')
  load()
}

onMounted(() => {
  load()
  loadModelCatalog()
})
</script>

<style scoped>
.form-tip { font-size: 12px; color: var(--ink-3); margin-top: 4px; }
.model-option__group { float: right; color: var(--ink-3); font-size: 12px; }
</style>
