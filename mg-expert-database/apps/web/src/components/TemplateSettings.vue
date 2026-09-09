<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { ScrollbarInstance, TreeInstance } from 'element-plus';
import { Plus, ArrowUp, ArrowDown, Collection, Document, Delete } from '@element-plus/icons-vue';
import { api } from '@/api/client';
import type { IndicatorSystemSummary } from '@/types/domain';
import type { SystemTemplateSettings, ResearchModuleDefinition, ResearchFieldDefinition, FieldType } from '@mg-expert/contracts';
const props = defineProps<{ system: IndicatorSystemSummary }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const settings = ref<SystemTemplateSettings>();
const level = ref(1);
const busy = ref(false);
const preview = ref(false);
const error = ref('');
const current = computed(() => settings.value?.levels.find(l => l.level === level.value));
const navOpen = ref(false);
const activeAnchor = ref('');
const editorScroll = ref<ScrollbarInstance>();
const navTree = ref<TreeInstance>();
const savedItemKeys = new Set<string>();
const confirmingDelete = ref(false);
const deletedPopoverOpen = ref(false);
const visibleModules = computed(() => current.value?.modules.filter(module => !module.deleted) ?? []);
const visibleFields = (module: ResearchModuleDefinition) => module.fields.filter(field => !field.deleted);
type TemplateNavNode = { key: string; moduleKey: string; fieldId?: string; label: string; inactive: boolean; kind: 'module' | 'field'; children?: TemplateNavNode[] };
// 字段标识只需在模块内唯一，使用元组编码避免跨模块或特殊字符碰撞。
const anchorKey = (moduleKey: string, fieldId?: string) => JSON.stringify([moduleKey, fieldId ?? null]);
const savedItemKey = (itemLevel: number, moduleKey: string, fieldId?: string) => JSON.stringify([itemLevel, moduleKey, fieldId ?? null]);
const selectedModule = computed(() => visibleModules.value.find(module =>
  anchorKey(module.moduleKey) === activeAnchor.value || visibleFields(module).some(field => anchorKey(module.moduleKey, field.fieldId) === activeAnchor.value),
));
const navigation = computed<TemplateNavNode[]>(() => visibleModules.value
  .filter(module => !preview.value || module.active !== false)
  .map(module => ({
    key: anchorKey(module.moduleKey), moduleKey: module.moduleKey, label: module.name || '未命名模块', inactive: module.active === false, kind: 'module',
    children: visibleFields(module).filter(field => !preview.value || field.active !== false).map(field => ({
      key: anchorKey(module.moduleKey, field.fieldId), moduleKey: module.moduleKey, fieldId: field.fieldId, label: field.label || '未命名字段',
      inactive: module.active === false || field.active === false, kind: 'field',
    })),
  })));
const selectedNavNode = computed(() => navigation.value.flatMap(node => [node, ...(node.children ?? [])]).find(node => node.key === activeAnchor.value));
const deletedItems = computed<TemplateNavNode[]>(() => (current.value?.modules ?? []).flatMap<TemplateNavNode>(module => module.deleted
  ? [{ key: anchorKey(module.moduleKey), moduleKey: module.moduleKey, kind: 'module' as const, label: module.name, inactive: true }]
  : module.fields.filter(field => field.deleted).map(field => ({ key: anchorKey(module.moduleKey, field.fieldId), moduleKey: module.moduleKey, fieldId: field.fieldId, kind: 'field' as const, label: module.name + ' / ' + field.label, inactive: true }))));
watch(navigation, async nodes => {
  if (!nodes.some(node => node.key === activeAnchor.value || node.children?.some(field => field.key === activeAnchor.value))) {
    activeAnchor.value = nodes[0]?.key ?? '';
  }
  await nextTick();
  navTree.value?.setCurrentKey(activeAnchor.value);
}, { immediate: true });
watch(level, async () => {
  activeAnchor.value = navigation.value[0]?.key ?? '';
  navOpen.value = false;
  deletedPopoverOpen.value = false;
  await nextTick();
  if (editorScroll.value?.wrapRef) editorScroll.value.wrapRef.scrollTop = 0;
  navTree.value?.setCurrentKey(activeAnchor.value);
});
async function locateAnchor(key: string, editName = false) {
  activeAnchor.value = key;
  navOpen.value = false;
  await nextTick();
  navTree.value?.setCurrentKey(key);
  const wrap = editorScroll.value?.wrapRef;
  const target = wrap && Array.from(wrap.querySelectorAll<HTMLElement>('[data-template-anchor]')).find(element => element.dataset.templateAnchor === key);
  if (!wrap || !target) return;
  wrap.scrollTop = Math.max(0, wrap.scrollTop + target.getBoundingClientRect().top - wrap.getBoundingClientRect().top - 8);
  const input = editName ? target.querySelector<HTMLInputElement>('input[aria-label="模块名称"], input[aria-label="字段名称"]') : null;
  (input ?? target).focus({ preventScroll: true });
  input?.select();
}
function selectFocusedAnchor(event: FocusEvent) {
  if (!(event.target instanceof HTMLElement)) return;
  const key = event.target.closest<HTMLElement>('[data-template-anchor]')?.dataset.templateAnchor;
  if (!key || key === activeAnchor.value) return;
  activeAnchor.value = key;
  navTree.value?.setCurrentKey(key);
}
const types: Array<[FieldType, string]> = [['short_text', '单行文本'], ['long_text', '多行文本'], ['rich_text', '长内容'], ['number', '数值'], ['decimal', '小数'], ['percentage', '百分比'], ['date', '日期'], ['enum', '选项'], ['reference_list', '依据列表'], ['object_list', '对象列表'], ['organization_contact_list', '联系信息']];
onMounted(async () => {
  try {
    settings.value = await api.getTemplates(props.system.id);
    for (const entry of settings.value.levels) for (const module of entry.modules) {
      savedItemKeys.add(savedItemKey(entry.level, module.moduleKey));
      for (const field of module.fields) savedItemKeys.add(savedItemKey(entry.level, module.moduleKey, field.fieldId));
    }
  } catch (e) { error.value = e instanceof Error ? e.message : '读取失败'; }
});
function changeDepth() {
  if (!settings.value) return;
  for (let n = 1; n <= settings.value.maxLevel; n++) {
    if (!settings.value.levels.some(l => l.level === n)) {
      // 新级别仅在保存时由服务端初始化；预览使用明细模板。
      const base = settings.value.levels.find(l => l.level === 3) ?? settings.value.levels.at(-1);
      settings.value.levels.push({ level: n, revisionNo: 1, affectedCount: 0, modules: JSON.parse(JSON.stringify(base?.modules ?? [])) });
    }
  }
  if (level.value > settings.value.maxLevel) level.value = settings.value.maxLevel;
}
const id = (prefix: string) => prefix + crypto.randomUUID().replaceAll('-', '');
function addModule() {
  if (!current.value || preview.value || busy.value) return;
  const moduleKey = id('module_');
  current.value.modules.push({ moduleKey, name: '新模块', researchQuestion: '', displayOrder: current.value.modules.length + 1, active: true, fields: [] });
  void locateAnchor(anchorKey(moduleKey), true);
}
function addField(m: ResearchModuleDefinition) {
  if (preview.value || busy.value || m.deleted || !current.value?.modules.includes(m)) return;
  const fieldId = id('field_');
  m.fields.push({ fieldId, label: '新字段', fieldType: 'long_text', requirement: 'optional', active: true, allowNotApplicable: false });
  void locateAnchor(anchorKey(m.moduleKey, fieldId), true);
}
function addSelectedField() {
  if (selectedModule.value) addField(selectedModule.value);
}
async function deleteItem(moduleKey: string, fieldId?: string) {
  if (!current.value || preview.value || busy.value || confirmingDelete.value) return;
  const origin = current.value;
  const itemLevel = level.value;
  const module = origin.modules.find(item => item.moduleKey === moduleKey && !item.deleted);
  if (!module) return;
  const field = fieldId === undefined ? undefined : module.fields.find(item => item.fieldId === fieldId && !item.deleted);
  if (fieldId !== undefined && !field) return;
  const isLastModule = () => !field && (visibleModules.value.length <= 1 || (module.active !== false && visibleModules.value.filter(item => item.active !== false).length <= 1));
  if (isLastModule()) { ElMessage.warning('至少保留一个启用模块，请先新增或启用其他模块。'); return; }
  const label = field ? field.label : module.name;
  const kind = field ? '字段' : '模块';
  confirmingDelete.value = true;
  try {
    await ElMessageBox.confirm('删除' + kind + '「' + label + '」' + (field ? '' : '及其全部字段') + '？保存模板后将从本级 ' + origin.affectedCount + ' 个指标的日常填写中移除。已有内容、依据及历史修订保留，已保存项可恢复。', '删除' + kind, { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
    if (busy.value || preview.value || current.value !== origin || level.value !== itemLevel || module.deleted || field?.deleted || isLastModule()) return;
    let nextKey: string;
    if (field) {
      const index = visibleFields(module).indexOf(field);
      if (savedItemKeys.has(savedItemKey(itemLevel, moduleKey, field.fieldId))) { field.deleted = true; field.active = false; }
      else module.fields.splice(module.fields.indexOf(field), 1);
      const remaining = visibleFields(module);
      const next = remaining[Math.min(index, remaining.length - 1)];
      nextKey = anchorKey(moduleKey, next?.fieldId);
    } else {
      const index = visibleModules.value.indexOf(module);
      if (savedItemKeys.has(savedItemKey(itemLevel, moduleKey))) { module.deleted = true; module.active = false; }
      else origin.modules.splice(origin.modules.indexOf(module), 1);
      origin.modules.forEach((item, order) => { item.displayOrder = order + 1; });
      const next = visibleModules.value[Math.min(index, visibleModules.value.length - 1)];
      nextKey = next ? anchorKey(next.moduleKey) : '';
    }
    await locateAnchor(nextKey);
  } catch { /* 取消确认时保留模板及当前输入。 */ }
  finally { confirmingDelete.value = false; }
}
function deleteSelectedItem() {
  const node = selectedNavNode.value;
  if (node) void deleteItem(node.moduleKey, node.fieldId);
}
function restoreItem(item: TemplateNavNode) {
  if (!current.value || preview.value || busy.value || confirmingDelete.value) return;
  const module = current.value.modules.find(module => module.moduleKey === item.moduleKey);
  if (!module || (item.fieldId !== undefined && module.deleted)) return;
  const target = item.fieldId === undefined ? module : module.fields.find(field => field.fieldId === item.fieldId);
  if (!target?.deleted) return;
  target.deleted = false;
  target.active = true;
  deletedPopoverOpen.value = false;
  void locateAnchor(item.key);
}
function reorder<T>(items: T[], index: number, target: number) {
  if (preview.value || busy.value || index === target || index < 0 || index >= items.length || target < 0 || target >= items.length) return false;
  const [item] = items.splice(index, 1);
  items.splice(target, 0, item!);
  current.value?.modules.forEach((module, order) => { module.displayOrder = order + 1; });
  return true;
}
function moveModule(module: ResearchModuleDefinition, delta: number) {
  const target = visibleModules.value[visibleModules.value.indexOf(module) + delta];
  if (current.value && target) reorder(current.value.modules, current.value.modules.indexOf(module), current.value.modules.indexOf(target));
}
function moveField(module: ResearchModuleDefinition, field: ResearchFieldDefinition, delta: number) {
  const fields = visibleFields(module);
  const target = fields[fields.indexOf(field) + delta];
  if (target) reorder(module.fields, module.fields.indexOf(field), module.fields.indexOf(target));
}
type DragNode = { data: TemplateNavNode };
function allowDrag() { return !preview.value && !busy.value && !confirmingDelete.value; }
function allowDrop(drag: DragNode, target: DragNode, type: string) {
  return allowDrag() && ['prev', 'next', 'before', 'after'].includes(type)
    && drag.data.key !== target.data.key && drag.data.kind === target.data.kind
    && (drag.data.kind === 'module' || drag.data.moduleKey === target.data.moduleKey);
}
function onDrop(drag: DragNode, target: DragNode, type: string) {
  if (!current.value || !allowDrop(drag, target, type) || !['before', 'after'].includes(type)) return;
  const items = drag.data.kind === 'module' ? current.value.modules : current.value.modules.find(module => module.moduleKey === drag.data.moduleKey)?.fields;
  if (!items) return;
  const keyOf = (item: ResearchModuleDefinition | ResearchModuleDefinition['fields'][number]) => 'moduleKey' in item ? anchorKey(item.moduleKey) : anchorKey(drag.data.moduleKey, item.fieldId);
  const from = items.findIndex(item => keyOf(item) === drag.data.key);
  const to = items.findIndex(item => keyOf(item) === target.data.key);
  if (from < 0 || to < 0) return;
  const insertion = to + (type === 'after' ? 1 : 0);
  if (reorder<ResearchModuleDefinition | ResearchModuleDefinition['fields'][number]>(items, from, insertion - (from < insertion ? 1 : 0))) {
    void locateAnchor(drag.data.key);
  }
}
async function save() {
  if (!settings.value) return;
  try { await ElMessageBox.confirm(settings.value.levels.filter(l => l.level <= settings.value!.maxLevel).map(l => l.level + ' 级：' + l.affectedCount + ' 个指标').join('；') + '。保存后使用最新模板，已有内容保留。', '确认应用模板', { confirmButtonText: '保存并应用', cancelButtonText: '取消' }); } catch { return; }
  busy.value = true; error.value = '';
  try {
    settings.value = await api.saveTemplates(props.system.id, { expectedRevisionNo: settings.value.revisionNo, maxLevel: settings.value.maxLevel, levels: settings.value.levels.filter(l => l.level <= settings.value!.maxLevel).map(l => ({ level: l.level, modules: l.modules })) });
    ElMessage.success('模板已保存'); emit('saved'); emit('close');
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败'; } finally { busy.value = false; }
}
</script>

<template>
  <el-dialog class="template-settings-dialog" :model-value="true" :title="system.name + ' · 模板设置'" top="5vh" width="min(1100px, 96vw)" :close-on-click-modal="false" @close="emit('close')">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-skeleton v-if="!settings && !error" :rows="5" animated />
    <template v-if="settings">
      <div class="settings-head">
        <label>最大层级 <el-select v-model="settings.maxLevel" aria-label="最大层级" @change="changeDepth"><el-option v-for="n in 6" :key="n" :label="n + ' 级'" :value="n" /></el-select></label>
        <div class="settings-actions">
          <el-button class="template-nav-toggle" :icon="Collection" :aria-label="navOpen ? '收起模板目录' : '展开模板目录'" :aria-expanded="navOpen" @click="navOpen = !navOpen">目录</el-button>
          <el-switch v-model="preview" active-text="预览" inactive-text="编辑" aria-label="预览模板" />
        </div>
      </div>
      <el-tabs v-model="level"><el-tab-pane v-for="n in settings.maxLevel" :key="n" :label="n + ' 级模板'" :name="n" /></el-tabs>
      <div class="scope-note">
        <span>本级共 {{ current?.affectedCount ?? 0 }} 个指标（包含所有业务版本）</span>
        <el-popover v-if="!preview && deletedItems.length" v-model:visible="deletedPopoverOpen" placement="bottom-end" :width="300" trigger="click">
          <template #reference><el-button class="template-deleted-trigger" link :disabled="busy || confirmingDelete">已删除（{{ deletedItems.length }}）</el-button></template>
          <div class="deleted-template-list">
            <div v-for="item in deletedItems" :key="item.key" class="deleted-template-item">
              <span :title="item.label">{{ item.label }}</span>
              <el-button link type="primary" :aria-label="item.kind === 'module' ? '恢复模块' : '恢复字段'" :disabled="busy || confirmingDelete" @click="restoreItem(item)">恢复</el-button>
            </div>
          </div>
        </el-popover>
      </div>
      <div class="template-workspace">
        <aside class="template-nav" :class="{ 'is-mobile-open': navOpen }" aria-label="本级模板目录">
          <div class="template-nav-heading">
            <div class="template-nav-title"><span>模板目录</span><el-button v-if="!preview" link :icon="Delete" aria-label="删除选中项" title="删除选中项" :disabled="busy || confirmingDelete || !selectedNavNode" @click="deleteSelectedItem" /></div>
            <div v-if="!preview" class="template-nav-actions">
              <el-button :icon="Plus" :disabled="busy || !current" @click="addModule">新增模块</el-button>
              <el-button :icon="Plus" :disabled="busy || !selectedModule" :title="selectedModule ? '向「' + (selectedModule.name || '未命名模块') + '」新增字段' : '请先新增模块'" @click="addSelectedField">新增字段</el-button>
            </div>
          </div>
          <el-scrollbar class="template-nav-scroll">
            <el-tree ref="navTree" class="template-nav-tree" :data="navigation" node-key="key" :current-node-key="activeAnchor" default-expand-all highlight-current :expand-on-click-node="false" :indent="16" :draggable="allowDrag()" :allow-drag="allowDrag" :allow-drop="allowDrop" empty-text="暂无模块" @node-click="(node: TemplateNavNode) => locateAnchor(node.key)" @node-drop="onDrop">
              <template #default="{ data }">
                <span class="template-nav-label" :class="{ 'is-inactive': data.inactive }" :data-nav-key="data.key" :title="data.label">
                  <el-icon><Collection v-if="data.kind === 'module'" /><Document v-else /></el-icon>
                  <span class="template-nav-name">{{ data.label }}</span>
                  <span v-if="data.inactive" class="template-nav-status">停用</span>
                </span>
              </template>
            </el-tree>
          </el-scrollbar>
        </aside>
      <el-scrollbar ref="editorScroll" class="template-editor-scroll" @focusin="selectFocusedAnchor">
        <template v-if="preview">
          <section v-for="m in visibleModules.filter(m => m.active !== false)" :key="m.moduleKey" class="template-module" :data-template-anchor="anchorKey(m.moduleKey)" :data-module-key="m.moduleKey" tabindex="-1">
            <h3>{{ m.name }}</h3><p>{{ m.researchQuestion }}</p>
            <el-form label-position="top"><div v-for="f in visibleFields(m).filter(f => f.active !== false)" :key="f.fieldId" :data-template-anchor="anchorKey(m.moduleKey, f.fieldId)" :data-field-id="f.fieldId" tabindex="-1"><el-form-item :label="f.label">
              <el-select v-if="f.fieldType === 'enum'" :placeholder="f.description || '请选择'"><el-option v-for="v in f.enumValues" :key="v" :value="v" /></el-select>
              <el-input v-else :type="['long_text', 'rich_text'].includes(f.fieldType) ? 'textarea' : 'text'" :placeholder="f.description || f.label" readonly />
              <el-checkbox v-if="f.allowNotApplicable">不适用</el-checkbox>
            </el-form-item></div></el-form>
          </section>
        </template>
        <template v-else>
          <section v-for="(m, mi) in visibleModules" :key="m.moduleKey" class="template-module" :class="{ inactive: m.active === false }" :data-template-anchor="anchorKey(m.moduleKey)" :data-module-key="m.moduleKey" tabindex="-1">
            <div class="module-head">
              <el-input v-model="m.name" aria-label="模块名称" placeholder="模块名称" />
              <el-button :icon="ArrowUp" aria-label="模块上移" :disabled="mi === 0" @click="moveModule(m, -1)" />
              <el-button :icon="ArrowDown" aria-label="模块下移" :disabled="mi === visibleModules.length - 1" @click="moveModule(m, 1)" />
              <el-switch :model-value="m.active !== false" active-text="启用" @change="m.active = Boolean($event)" />
              <el-button :icon="Delete" class="template-delete-button" aria-label="删除模块" title="删除模块" :disabled="busy || confirmingDelete" @click="deleteItem(m.moduleKey)" />
            </div>
            <el-input v-model="m.researchQuestion" placeholder="模块说明" aria-label="模块说明" />
            <div v-for="(f, fi) in visibleFields(m)" :key="f.fieldId" class="field-editor" :class="{ inactive: f.active === false }" :data-template-anchor="anchorKey(m.moduleKey, f.fieldId)" :data-field-id="f.fieldId" tabindex="-1">
              <div class="field-main">
                <el-input v-model="f.label" placeholder="字段名称" aria-label="字段名称" />
                <el-select v-model="f.fieldType" aria-label="字段类型"><el-option v-for="[value, label] in types" :key="value" :value="value" :label="label" /></el-select>
                <el-button :icon="ArrowUp" aria-label="字段上移" :disabled="fi === 0" @click="moveField(m, f, -1)" />
                <el-button :icon="ArrowDown" aria-label="字段下移" :disabled="fi === visibleFields(m).length - 1" @click="moveField(m, f, 1)" />
                <el-switch :model-value="f.active !== false" active-text="启用" @change="f.active = Boolean($event)" />
                <el-button :icon="Delete" class="template-delete-button" aria-label="删除字段" title="删除字段" :disabled="busy || confirmingDelete" @click="deleteItem(m.moduleKey, f.fieldId)" />
              </div>
              <el-input v-model="f.description" placeholder="填写说明" aria-label="填写说明" />
              <el-select v-if="f.fieldType === 'enum'" v-model="f.enumValues" multiple filterable allow-create default-first-option placeholder="输入选项并回车；移除即停用" class="options-input"><el-option v-for="v in f.enumValues" :key="v" :value="v" /></el-select>
              <el-checkbox v-model="f.allowNotApplicable">允许不适用</el-checkbox>
              <el-checkbox v-model="f.requiresEvidence">需要依据</el-checkbox>
            </div>
            <el-button link type="primary" :icon="Plus" :disabled="busy" @click="addField(m)">新增字段</el-button>
          </section>
          <el-button :icon="Plus" :disabled="busy" @click="addModule">新增模块</el-button>
        </template>
      </el-scrollbar>
      </div>
    </template>
    <template #footer><el-button @click="emit('close')">取消</el-button><el-button type="primary" :loading="busy" :disabled="!settings" @click="save">保存模板</el-button></template>
  </el-dialog>
</template>

<style scoped>
.settings-head, .settings-actions, .module-head, .field-main { display:flex; align-items:center; gap:10px; }
.settings-head { justify-content:space-between; margin:12px 0; }
.settings-head .el-select { width:110px; margin-left:10px; }
.scope-note { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; color:var(--el-text-color-secondary); margin-bottom:14px; }
.template-deleted-trigger { flex-shrink:0; }
.deleted-template-list { max-height:240px; overflow-y:auto; }
.deleted-template-item { display:flex; align-items:center; gap:12px; padding:8px 0; }
.deleted-template-item > span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.deleted-template-item > .el-button { flex-shrink:0; }
.template-workspace { position:relative; display:grid; grid-template-columns:220px minmax(0, 1fr); gap:16px; flex:1; min-height:0; }
.template-nav { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border:1px solid var(--el-border-color-lighter); border-radius:6px; background:#f8fafc; }
.template-nav-heading { flex-shrink:0; padding:12px; color:var(--el-text-color-regular); font-size:13px; border-bottom:1px solid var(--el-border-color-lighter); }
.template-nav-title { display:flex; align-items:center; justify-content:space-between; }
.template-nav-title > .el-button { padding:0; min-height:18px; }
.template-delete-button:hover, .template-nav-title > .el-button:not(:disabled):hover { color:var(--el-color-danger); border-color:var(--el-color-danger-light-7); background:var(--el-color-danger-light-9); }
.template-nav-actions { display:flex; gap:6px; margin-top:10px; }
.template-nav-actions > .el-button { flex:1; min-width:0; margin:0; padding:8px; }
.template-nav-scroll { flex:1; min-height:0; }
.template-nav-tree { background:transparent; padding:8px 6px; }
.template-nav-label { display:flex; align-items:center; gap:6px; min-width:0; flex:1; padding-right:6px; }
.template-nav-label > .el-icon { flex-shrink:0; color:var(--el-text-color-secondary); font-size:14px; }
.template-nav-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.template-nav-status { flex-shrink:0; margin-left:auto; color:var(--el-text-color-placeholder); font-size:11px; }
.template-nav-label.is-inactive { color:var(--el-text-color-placeholder); }
.template-nav-toggle { display:none; }
.template-editor-scroll { min-width:0; container-type:inline-size; container-name:template-editor; }
[data-template-anchor]:focus { outline:none; }
[data-template-anchor]:focus-visible { outline:1px solid var(--el-color-primary-light-5); outline-offset:-1px; border-radius:4px; }
.template-module { border:1px solid var(--el-border-color-lighter); border-radius:8px; padding:16px; margin-bottom:14px; }
.module-head { margin-bottom:10px; }
.module-head > .el-input, .field-main > .el-input { flex:1; }
.module-head .el-switch, .field-main .el-switch { flex-shrink:0; }
.field-editor { padding:14px 0; border-bottom:1px solid var(--el-border-color-lighter); margin-bottom:10px; }
.field-main { margin-bottom:8px; }
.field-main .el-select { width:150px; }
.options-input { margin-top:8px; }
.inactive { background:var(--el-fill-color-lighter); }
h3 { font-size:15px; margin:0 0 8px; } p { color:var(--el-text-color-secondary); }
@container template-editor (max-width:560px) {
  .module-head, .field-main { flex-wrap:wrap; }
  .module-head > .el-input, .field-main > .el-input { flex:1 0 100%; }
  .module-head > .el-switch, .field-main > .el-switch { margin-left:auto; }
}
@container template-editor (max-width:380px) {
  .field-main > .el-select { flex:1 0 100%; width:100%; }
}
@media (max-width:760px) {
  .template-workspace { grid-template-columns:minmax(0, 1fr); }
  .template-nav-toggle { display:inline-flex; }
  .template-nav { display:none; position:absolute; z-index:2; inset:0; background:#fff; box-shadow:0 2px 8px rgb(48 49 51 / 6%); }
  .template-nav.is-mobile-open { display:flex; }
}
@media (max-width:420px) {
  .settings-head { flex-wrap:wrap; gap:8px; }
  .settings-head .el-select { width:90px; margin-left:6px; }
  .settings-actions { margin-left:auto; }
}
</style>
