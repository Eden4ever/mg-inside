<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Edit, More, Plus, Search } from '@element-plus/icons-vue';
import type { CreateNodeInput, IndicatorTreeNode } from '@/types/domain';

const props = defineProps<{
  maxLevel?: number;
  nodes: IndicatorTreeNode[];
  selectedId: string;
  readonly: boolean;
  loading?: boolean;
  sorting?: boolean;
}>();

const emit = defineEmits<{
  select: [node: IndicatorTreeNode];
  reorder: [input: { nodeId: string; targetId: string; position: 'before' | 'after' }];
  add: [input: CreateNodeInput];
  edit: [nodeId: string, input: Partial<CreateNodeInput>];
  remove: [nodeId: string];
}>();

const query = ref('');
const expandedKeys = ref<string[]>([]);
const dialogOpen = ref(false);
const dialogMode = ref<'add' | 'edit'>('add');
const editingNode = ref<IndicatorTreeNode | null>(null);
const form = ref({ parentId: null as string | null, level: 1, name: '', code: '', sortOrder: 0 });
const formRef = ref();
const collapsed = ref(false);

function matches(node: IndicatorTreeNode, keyword: string): boolean {
  return `${node.name} ${node.code}`.toLowerCase().includes(keyword);
}

function filterNodes(nodes: IndicatorTreeNode[], keyword: string): IndicatorTreeNode[] {
  if (!keyword) return nodes.map((node) => ({ ...node, children: filterNodes(node.children || [], keyword) }));
  return nodes.reduce<IndicatorTreeNode[]>((result, node) => {
    const children = filterNodes(node.children || [], keyword);
    if (matches(node, keyword) || children.length) result.push({ ...node, children });
    return result;
  }, []);
}

const displayNodes = computed(() => filterNodes(props.nodes, query.value.trim().toLowerCase()));
const selectedNode = computed(() => findNode(props.nodes, props.selectedId));

watch(() => props.nodes, (nodes) => {
  expandedKeys.value = nodes.filter((node) => node.level === 1).map((node) => node.id);
}, { immediate: true });

function countLeaves(nodes: IndicatorTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + (1 + countLeaves(node.children || [])), 0);
}

function onExpand(data: IndicatorTreeNode) {
  if (!expandedKeys.value.includes(data.id)) expandedKeys.value.push(data.id);
}

function onCollapse(data: IndicatorTreeNode) {
  expandedKeys.value = expandedKeys.value.filter((key) => key !== data.id);
}

function findNode(nodes: IndicatorTreeNode[], id: string): IndicatorTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const match = findNode(node.children || [], id);
    if (match) return match;
  }
  return null;
}

function openAdd(parent?: IndicatorTreeNode) {
  const level = parent ? parent.level + 1 : 1;
  if (parent && parent.level >= (props.maxLevel ?? 3)) {
    ElMessage.warning('已达到该体系设置的最大层级');
    return;
  }
  dialogMode.value = 'add';
  editingNode.value = null;
  form.value = { parentId: parent?.id || null, level, name: '', code: '', sortOrder: (parent?.children?.length || props.nodes.length) + 1 };
  dialogOpen.value = true;
}

function openEdit(node: IndicatorTreeNode) {
  if (props.readonly || props.loading || props.sorting) return;
  dialogMode.value = 'edit';
  editingNode.value = node;
  form.value = { parentId: node.parentId, level: node.level, name: node.name, code: node.code, sortOrder: node.sortOrder || 0 };
  dialogOpen.value = true;
}

function submitForm() {
  formRef.value?.validate((valid: boolean) => {
    if (!valid) return;
    if (dialogMode.value === 'edit' && editingNode.value) emit('edit', editingNode.value.id, { name: form.value.name, sortOrder: form.value.sortOrder });
    if (dialogMode.value === 'add') emit('add', { parentId: form.value.parentId, level: form.value.level, name: form.value.name, sortOrder: form.value.sortOrder });
    dialogOpen.value = false;
  });
}

async function removeNode(node: IndicatorTreeNode) {
  if (node.children?.length) {
    ElMessage.warning('请先处理该节点下的子指标');
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除“${node.name}”？删除后不可恢复。`, '删除指标节点', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
    emit('remove', node.id);
  } catch {
    // 用户取消
  }
}

type DragNode = { data: IndicatorTreeNode };
function allowDrag() { return !props.readonly && !props.loading && !props.sorting && !query.value.trim(); }
function allowDrop(drag: DragNode, target: DragNode, type: string) {
  return allowDrag() && type !== 'inner' && drag.data.id !== target.data.id && drag.data.level === target.data.level && drag.data.parentId === target.data.parentId;
}
function onDrop(drag: DragNode, target: DragNode, type: string) {
  if (!allowDrop(drag, target, type) || !['before', 'after'].includes(type)) return;
  emit('reorder', { nodeId: drag.data.id, targetId: target.data.id, position: type as 'before' | 'after' });
}

function onNodeClick(node: IndicatorTreeNode) {
  emit('select', node);
}

defineExpose({ openEdit });
</script>

<template>
  <section class="tree-panel">
    <div class="panel-heading">
      <div class="tree-heading-title"><h2>指标目录</h2><span class="tree-count">{{ countLeaves(nodes) }}</span></div>
      <el-button v-if="!readonly" text type="primary" :icon="Plus" aria-label="新增一级指标" @click="openAdd()" />
    </div>
    <div class="tree-toolbar">
      <el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索指标名称或编码" />
    </div>
    <el-button class="mobile-collapse" text type="primary" @click="collapsed = !collapsed">{{ collapsed ? '展开指标树' : '收起指标树' }}</el-button>
    <el-scrollbar v-show="!collapsed" class="tree-scroll" v-loading="loading || sorting">
      <el-tree
        :data="displayNodes"
        :draggable="allowDrag()"
        :allow-drag="allowDrag"
        :allow-drop="allowDrop"
        @node-drop="onDrop"
        node-key="id"
        :indent="16"
        :props="{ label: 'name', children: 'children' }"
        :default-expanded-keys="expandedKeys"
        highlight-current
        :current-node-key="selectedId"
        :expand-on-click-node="false"
        :empty-text="query ? '未找到匹配指标' : '暂无指标'"
        @node-click="onNodeClick"
        @node-expand="onExpand"
        @node-collapse="onCollapse"
      >
        <template #default="{ data }">
          <div class="tree-label" :class="`level-${data.level}`">
            <span class="node-text" :title="`${data.name}\n${data.code}`">{{ data.name }}</span>
            <span v-if="!readonly" class="node-actions" @click.stop>
              <el-dropdown trigger="click" placement="bottom-end">
                <el-button class="node-more" text :icon="More" size="small" :aria-label="`管理指标：${data.name}`" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="data.level < (maxLevel ?? 3)" :icon="Plus" @click="openAdd(data)">新增下级</el-dropdown-item>
                    <el-dropdown-item :icon="Edit" @click="openEdit(data)">编辑</el-dropdown-item>
                    <el-dropdown-item :icon="Delete" divided @click="removeNode(data)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </div>
        </template>
      </el-tree>
    </el-scrollbar>

    <el-dialog v-model="dialogOpen" :title="dialogMode === 'add' ? '新增指标节点' : '编辑指标节点'" width="420px" destroy-on-close>
      <el-form ref="formRef" :model="form" label-width="82px">
        <el-form-item label="指标层级"><el-tag>{{ form.level }}级指标</el-tag></el-form-item>
        <el-form-item label="指标名称" prop="name" :rules="[{ required: true, message: '请输入指标名称', trigger: 'blur' }]"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="同级排序"><el-input-number v-model="form.sortOrder" :min="0" :max="9999" controls-position="right" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" @click="submitForm">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.tree-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; background: #fff; border-right: 1px solid var(--el-border-color-lighter); min-width: 0; }
.panel-heading { min-height: 52px; padding: 10px 14px 6px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.tree-heading-title { display: flex; align-items: center; gap: 8px; }
.panel-heading h2 { margin: 0; font-size: 14px; font-weight: 600; }
.tree-count { font-size: 12px; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.tree-toolbar { padding: 4px 12px 12px; }
.mobile-collapse { display: none; align-self: flex-start; margin: 2px 8px 0; }
.tree-scroll { flex: 1; min-height: 0; padding: 0 8px 16px; }
.tree-label { display: flex; align-items: center; min-width: 0; width: 100%; gap: 4px; padding: 6px 4px 6px 0; }
.node-text { min-width: 0; flex: 1; font-size: 13px; line-height: 21px; white-space: normal; overflow-wrap: anywhere; }
.level-1 .node-text { font-weight: 600; color: var(--el-text-color-primary); }
.node-actions { flex: 0 0 24px; opacity: 0; }
.node-more { width: 24px; height: 24px; padding: 0; }
:deep(.el-tree-node__content:hover) .node-actions,
:deep(.el-tree-node__content:focus-within) .node-actions,
:deep(.is-current > .el-tree-node__content) .node-actions { opacity: 1; }
:deep(.el-tree-node__content) { min-height: 36px; height: auto; margin: 2px 0; border-radius: 4px; }
:deep(.el-tree-node__expand-icon) { color: var(--el-text-color-secondary); padding: 6px; }
:deep(.el-tree-node__expand-icon.is-leaf) { color: transparent; }
:deep(.el-tree-node.is-current > .el-tree-node__content) { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
:deep(.el-tree-node.is-current > .el-tree-node__content) .node-text { color: var(--el-color-primary); }
@media (hover: none) { .node-actions { opacity: 1; } }

@media (max-width: 900px) {
  .tree-panel { border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); height: auto; max-height: 46vh; }
  .mobile-collapse { display: inline-flex; }
  .tree-scroll { min-height: 130px; max-height: 32vh; }
  .node-actions { opacity: 1; }
}
</style>
