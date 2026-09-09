<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>令牌管理</h2>
        <p class="sub">签发分发给客户端的 sk- 访问令牌</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建令牌</el-button>
    </div>

    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="userId" label="用户ID" width="80" align="center" />
        <el-table-column prop="groupTag" label="分组" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.groupTag" size="small" effect="plain">{{ row.groupTag }}</el-tag>
            <span v-else style="color: var(--ink-3)">全部</span>
          </template>
        </el-table-column>
        <el-table-column label="密钥前缀" width="140">
          <template #default="{ row }">
            <code class="prefix">sk-{{ row.keyPrefix }}…</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" round>
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无令牌" />
        </template>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next, sizes"
          :total="total"
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          @current-change="load"
          @size-change="load"
        />
      </div>
    </div>

    <el-dialog v-model="visible" title="新建令牌" width="480px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="令牌备注名" />
        </el-form-item>
        <el-form-item label="用户ID" required>
          <el-input-number v-model="form.userId" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="分组">
          <el-input v-model="form.groupTag" placeholder="可选，留空表示全部" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="keyVisible" title="令牌已生成" width="540px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon
        title="请立即复制保存，关闭后无法再次查看明文。" />
      <div class="key-box">{{ createdKey }}</div>
      <template #footer>
        <el-button type="primary" :icon="CopyDocument" @click="copyKey">复制</el-button>
        <el-button @click="keyVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, CopyDocument } from '@element-plus/icons-vue'
import api from '@/api'

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)

const visible = ref(false)
const saving = ref(false)
const keyVisible = ref(false)
const createdKey = ref('')
const form = reactive({ name: '', userId: 1, groupTag: '' })

function formatTime(t: any) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d.getTime()) ? String(t) : d.toLocaleString('zh-CN')
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/tokens', {
      params: { page: page.value, pageSize: pageSize.value },
    })
    rows.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, { name: '', userId: 1, groupTag: '' })
  visible.value = true
}

async function save() {
  if (!form.name) {
    ElMessage.warning('请填写名称')
    return
  }
  saving.value = true
  try {
    const payload: any = { name: form.name, userId: form.userId }
    if (form.groupTag) payload.groupTag = form.groupTag
    const { data } = await api.post('/admin/tokens', payload)
    createdKey.value = data.key
    keyVisible.value = true
    visible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除令牌「${row.name}」？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  await api.delete(`/admin/tokens/${row.id}`)
  ElMessage.success('已删除')
  load()
}

function copyKey() {
  navigator.clipboard?.writeText(createdKey.value)
  ElMessage.success('已复制')
}

onMounted(load)
</script>

<style scoped>
.prefix {
  background: #f2f3f5; padding: 2px 6px; border-radius: 4px; font-size: 12px;
}
.form-tip { font-size: 12px; color: var(--ink-3); margin-top: 4px; }
</style>
