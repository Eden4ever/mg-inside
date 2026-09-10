<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Edit, Loading, Setting, User, Warning } from '@element-plus/icons-vue';
import HeaderBar from '@/components/HeaderBar.vue';
import LoginView from '@/components/LoginView.vue';
import UsersView from '@/components/UsersView.vue';
import SystemAccessDialog from '@/components/SystemAccessDialog.vue';
import SystemEditDialog from '@/components/SystemEditDialog.vue';
import TemplateSettings from '@/components/TemplateSettings.vue';
import ModelManagement from '@/components/ModelManagement.vue';
import MailSettings from '@/components/MailSettings.vue';
import SemanticLibraries from '@/components/SemanticLibraries.vue';
import SystemsView from '@/components/SystemsView.vue';
import ProfileView from '@/components/ProfileView.vue';
import IndicatorTreePanel from '@/components/IndicatorTreePanel.vue';
import ResearchWorkspace from '@/components/ResearchWorkspace.vue';
import appLogoUrl from '../../../logo.svg?url';
import { api, ApiError, setCsrfToken } from '@/api/client';
import { installNavigationGuard, type LeaveDecision } from '@/router';
import { desktop, unifiedDesktop } from './desktop';
import { hasVisibleEditingDialog, observeEditingDialogs } from './desktop-close-state';
import { MODULE_DEFINITIONS } from '@/data/moduleSchema';
import type { CreateNodeInput, CreateSystemInput, EvidenceItem, ImportPreview, IndicatorSystemSummary, IndicatorTreeNode, IndicatorVersionDetail, ModuleRecord, ResearchModuleKey, ResearchWorkspace as WorkspacePayload, SessionUser, SystemPermissions, UpdateModuleInput } from '@/types/domain';

const authLoading = ref(true);
const currentUser = ref<SessionUser | null>(null);
const route = useRoute();
const router = useRouter();
const activeView = computed<'systems' | 'semantic' | 'models' | 'mail' | 'users' | 'profile'>(() => route.name === 'mail' ? 'mail' : route.name === 'models' ? 'models' : route.name === 'semantic' ? 'semantic' : route.name === 'users' ? 'users' : route.name === 'profile' ? 'profile' : 'systems');

const systems = ref<IndicatorSystemSummary[]>([]);
const systemsLoading = ref(false);
const systemsError = ref('');
const currentSystem = ref<IndicatorSystemSummary | null>(null);
const systemDetail = ref<IndicatorVersionDetail | null>(null);
const systemDetailLoading = ref(false);
const systemDetailError = ref('');
const tree = ref<IndicatorTreeNode[]>([]);
const treeLoading = ref(false);
const selectedNode = ref<IndicatorTreeNode | null>(null);
const treePanelRef = ref<InstanceType<typeof IndicatorTreePanel> | null>(null);
const workspace = ref<WorkspacePayload | null>(null);
const workspaceLoading = ref(false);
const workspaceError = ref('');
const accessDialogOpen = ref(false);
const templateSystem = ref<IndicatorSystemSummary | null>(null);
async function openTemplateSettings() { if (workspaceDirty.value) { ElMessage.warning('请先保存或取消当前编辑'); return; } templateSystem.value = currentSystem.value; }
const systemEditOpen = ref(false);
function openSystemEdit() {
  if (!canManageCatalog.value || !currentSystem.value) return;
  if (workspaceDirty.value) { ElMessage.warning('请先保存或取消当前编辑'); return; }
  systemEditOpen.value = true;
}
async function systemSaved(input: { name: string; region: string }) {
  if (currentSystem.value) Object.assign(currentSystem.value, input);
  systemEditOpen.value = false;
  await loadSystems();
}
async function systemRemoved() {
  systemEditOpen.value = false;
  await router.push({ name: 'systems' });
  await loadSystems();
}
async function templatesSaved() { await loadSystems(); if (currentSystem.value) { await loadVersionContext(currentSystem.value.versionId, routeSyncVersion); await refreshWorkspace(); } }
const selectedModuleKey = ref<ResearchModuleKey>('portrait');
const saveVersion = ref(0);
const revisions = ref<WorkspacePayload['recentRevisions']>([]);
const revisionsLoading = ref(false);
const importPreview = ref<ImportPreview | null>(null);
const importBusy = ref(false);
const importFile = ref<File | null>(null);
const importVersionId = ref('');
const evidenceItems = ref<EvidenceItem[]>([]);
const workspaceDirty = ref(false);
const workspaceCloseState = ref({ dirty: false, busy: false });
watch(workspace, value => { if (!value) workspaceCloseState.value = { dirty: false, busy: false }; }, { flush: 'sync' });
const mailCloseState = ref({ dirty: false, busy: false });
const modelCloseState = ref({ dirty: false, busy: false });
const semanticCloseState = ref({ dirty: false, busy: false });
const editingDialogOpen = ref(false);
let stopEditingDialogObserver: (() => void) | undefined;
let desktopSaveDone: ((success: boolean) => void) | undefined;
const pendingRouteAfterSave = ref<RouteLocationRaw | null>(null);
const workspaceRef = ref<{ saveCurrent: () => boolean; discardCurrent: () => void; showConflict: (message: string) => void; saveFailed: () => void; isSaving: () => boolean } | null>(null);
let routeSyncVersion = 0;
let workspaceRequestVersion = 0;
const emptyAccess: SystemPermissions = { canView: false, canResearch: false, canManageCatalog: false, canReview: false, canPublish: false };
const fullAccess: SystemPermissions = { canManageAccess: true, canView: true, canResearch: true, canManageCatalog: true, canReview: true, canPublish: true };

const isWorkspace = computed(() => route.name === 'indicator-workspace' || route.name === 'system-detail');
const versionWritable = computed(() => Boolean(currentSystem.value));
const currentAccess = computed<SystemPermissions>(() => currentSystem.value?.access ?? (currentUser.value?.role === 'system_admin' ? fullAccess : emptyAccess));
const canCreateSystem = computed(() => currentUser.value?.role === 'system_admin' || currentUser.value?.role === 'catalog_manager');
const canManageCatalog = computed(() => currentAccess.value.canManageCatalog);
const canEditResearch = computed(() => currentAccess.value.canResearch);
const canReviewSystem = computed(() => currentAccess.value.canReview);
const canEditEvidence = computed(() => versionWritable.value && (currentAccess.value.canResearch || currentAccess.value.canReview));
const treeReadonly = computed(() => !versionWritable.value || !canManageCatalog.value);
const workspaceReadonly = computed(() => !versionWritable.value || !canEditResearch.value);

function unwrapList<T>(payload: unknown, keys: string[] = ['items', 'nodes', 'data']): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

function normalizeSystem(value: IndicatorSystemSummary): IndicatorSystemSummary {
  const fallback = currentUser.value?.role === 'system_admin' ? fullAccess : emptyAccess;
  return { ...value, indicatorCount: Number(value.indicatorCount || 0), progress: Number(value.progress || 0), access: { ...fallback, ...(value.access || {}) } };
}

function createEmptyModule(definition: typeof MODULE_DEFINITIONS[number]): ModuleRecord {
  return { id: `pending-${definition.moduleKey}`, moduleKey: definition.moduleKey, status: 'not_started', revisionNo: 0, completedFields: 0, totalFields: definition.fields.length, values: definition.fields.map((field) => ({ fieldKey: field.fieldId, value: null, evidence: [] })), updatedAt: '' };
}

function normalizeWorkspace(value: WorkspacePayload): WorkspacePayload {
  const definitions = (value.moduleDefinitions?.length ? value.moduleDefinitions : MODULE_DEFINITIONS).sort((a, b) => a.displayOrder - b.displayOrder);
  const existing = value.modules || [];
  const modules = definitions.map((definition) => {
    const record = existing.find((item) => item.moduleKey === definition.moduleKey);
    if (!record) return createEmptyModule(definition);
    const values = definition.fields.map((field) => record.values.find((item) => item.fieldKey === field.fieldId) || { fieldKey: field.fieldId, value: null, evidence: [] });
    return { ...record, revisionNo: record.revisionNo ?? (record as unknown as { revision?: number }).revision ?? 0, totalFields: record.totalFields || definition.fields.length, values };
  });
  return { ...value, summary: value.summary || null, moduleDefinitions: definitions, modules };
}

async function loadSystems() {
  systemsLoading.value = true;
  systemsError.value = '';
  try {
    systems.value = unwrapList<IndicatorSystemSummary>(await api.listSystems()).map(normalizeSystem);
  } catch (error) {
    systemsError.value = error instanceof Error ? error.message : '加载指标体系失败';
  } finally {
    systemsLoading.value = false;
  }
}

function openSystem(system: IndicatorSystemSummary) {
  void router.push({ name: 'system-detail', params: { versionId: system.versionId } });
}

async function loadVersionContext(versionId: string, requestId: number) {
  systemDetailLoading.value = true;
  systemDetailError.value = '';
  workspace.value = null;
  workspaceError.value = '';
  selectedNode.value = null;
  treeLoading.value = true;
  try {
    const detail = await api.getVersionDetail(versionId);
    if (requestId !== routeSyncVersion) return;
    systemDetail.value = detail;
    currentSystem.value = normalizeSystem(detail);
    tree.value = detail.tree;
  } catch (error) {
    if (requestId !== routeSyncVersion) return;
    const message = error instanceof Error ? error.message : '加载指标体系详情失败';
    systemDetail.value = null;
    currentSystem.value = null;
    tree.value = [];
    systemDetailError.value = message;
    workspaceError.value = message;
  } finally {
    if (requestId === routeSyncVersion) {
      treeLoading.value = false;
      systemDetailLoading.value = false;
    }
  }
}

function returnToSystems() {
  void router.push({ name: 'systems' });
}

function findFirstLeaf(nodes: IndicatorTreeNode[]): IndicatorTreeNode | null {
  for (const node of nodes) {
    if (!node.children?.length) return node;
    const child = findFirstLeaf(node.children || []);
    if (child) return child;
  }
  return null;
}

function findNodeById(nodes: IndicatorTreeNode[], id: string): IndicatorTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children || [], id);
    if (child) return child;
  }
  return null;
}

async function selectNode(node: IndicatorTreeNode, requestId = ++workspaceRequestVersion) {
  selectedNode.value = node;
  workspace.value = null;
  workspaceError.value = '';
  selectedModuleKey.value = 'portrait';
  if (!currentSystem.value) return;
  workspaceLoading.value = true;
  try {
    const result = normalizeWorkspace(await api.getWorkspace(currentSystem.value.versionId, node.id));
    if (requestId !== workspaceRequestVersion) return;
    workspace.value = result;
    selectedModuleKey.value = result.moduleDefinitions[0]?.moduleKey || '';
    await loadEvidence(requestId);
  } catch (error) {
    if (requestId !== workspaceRequestVersion) return;
    workspaceError.value = error instanceof Error ? error.message : '加载研究工作台失败';
  } finally {
    if (requestId === workspaceRequestVersion) workspaceLoading.value = false;
  }
}

async function onTreeSelect(node: IndicatorTreeNode) {
  if (!currentSystem.value || node.id === selectedNode.value?.id) return;
  await router.push({ name: 'indicator-workspace', params: { versionId: currentSystem.value.versionId, indicatorId: node.id } });
}

async function createSystem(input: CreateSystemInput, complete: (error?: string) => void) {
  try {
    await api.createSystem(input);
  } catch (error) {
    complete(error instanceof Error ? error.message : '创建指标体系失败');
    return;
  }
  complete();
  ElMessage.success('指标体系已创建');
  await loadSystems();
}

async function addNode(input: CreateNodeInput) {
  if (!currentSystem.value) return;
  try {
    await api.createNode(currentSystem.value.versionId, input);
    await reloadTree();
    ElMessage.success('指标节点已新增');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '新增指标节点失败');
  }
}

const treeSorting = ref(false);
async function reorderNode(input: { nodeId: string; targetId: string; position: 'before' | 'after' }) {
  if (!currentSystem.value || treeSorting.value) return;
  treeSorting.value = true;
  try {
    await api.reorderNode(currentSystem.value.versionId, input);
    await reloadTree();
    ElMessage.success('排序已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '排序保存失败');
    await reloadTree();
  } finally {
    treeSorting.value = false;
  }
}

async function editNode(nodeId: string, input: Partial<CreateNodeInput>) {
  if (!currentSystem.value) return;
  try {
    await api.updateNode(currentSystem.value.versionId, nodeId, input);
    await reloadTree();
    ElMessage.success('指标节点已更新');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '更新指标节点失败');
  }
}

async function removeNode(nodeId: string, confirmName: string) {
  if (!currentSystem.value || treeSorting.value) return;
  if (workspaceDirty.value || workspaceRef.value?.isSaving?.()) { ElMessage.warning('请先保存或取消当前编辑'); return; }
  const versionId = currentSystem.value.versionId;
  treeSorting.value = true;
  try {
    await api.deleteNode(versionId, nodeId, confirmName);
    await reloadTree();
    treeSorting.value = false;
    if (selectedNode.value?.id === nodeId) {
      const next = findFirstLeaf(tree.value);
      await router.replace(next
        ? { name: 'indicator-workspace', params: { versionId, indicatorId: next.id } }
        : { name: 'system-detail', params: { versionId } });
    }
    ElMessage.success('指标节点已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除指标节点失败');
  } finally {
    treeSorting.value = false;
  }
}

async function reloadTree() {
  if (!currentSystem.value) return;
  tree.value = unwrapList<IndicatorTreeNode>(await api.getTree(currentSystem.value.versionId));
  const currentNode = selectedNode.value && findNodeById(tree.value, selectedNode.value.id);
  if (!currentNode) return;
  selectedNode.value = currentNode;
  if (workspace.value?.indicator.id === currentNode.id) {
    const ancestors: IndicatorTreeNode[] = [];
    let ancestor: IndicatorTreeNode | null = currentNode;
    while (ancestor) {
      ancestors.push(ancestor);
      ancestor = ancestor.parentId ? findNodeById(tree.value, ancestor.parentId) : null;
    }
    workspace.value = {
      ...workspace.value,
      indicator: {
        ...workspace.value.indicator,
        name: currentNode.name,
        code: currentNode.code,
        level: currentNode.level,
        level1Name: ancestors.find((node) => node.level === 1)?.name || '',
        level2Name: ancestors.find((node) => node.level === 2)?.name || '',
      },
    };
  }
}

async function saveModule(moduleKey: ResearchModuleKey, input: UpdateModuleInput) {
  if (!workspace.value) return;
  const versionId = workspace.value.system.versionId;
  const indicatorId = workspace.value.indicator.id;
  const editor = workspaceRef.value;
  try {
    const result = await api.updateModule(versionId, indicatorId, moduleKey, { ...input, expectedTemplateRevision: input.expectedTemplateRevision ?? workspace.value.templateRevision });
    if (workspace.value?.system.versionId !== versionId || workspace.value.indicator.id !== indicatorId) return;
    workspace.value = normalizeWorkspace({
      ...workspace.value,
      modules: workspace.value.modules.map((module) => module.moduleKey === moduleKey ? result : module),
    });
    saveVersion.value += 1;
    workspaceDirty.value = false;
    desktopSaveDone?.(true); desktopSaveDone = undefined;
    if (pendingRouteAfterSave.value) {
      const target = pendingRouteAfterSave.value;
      pendingRouteAfterSave.value = null;
      await router.push(target);
    }
    ElMessage.success('内容已保存');
  } catch (error) {
    editor?.saveFailed?.();
    desktopSaveDone?.(false); desktopSaveDone = undefined;
    if (workspace.value?.system.versionId !== versionId || workspace.value.indicator.id !== indicatorId) return;
    pendingRouteAfterSave.value = null;
    if (error instanceof ApiError && (error.status === 409 || error.code === 'REVISION_CONFLICT')) {
      workspaceRef.value?.showConflict(error.message);
      ElMessage.error(error.message);
    } else {
      ElMessage.error(error instanceof Error ? error.message : '保存内容失败');
    }
  }
}

async function addEvidence(moduleKey: ResearchModuleKey, fieldKey: string, input: Omit<EvidenceItem, 'id'>) {
  if (!workspace.value) return;
  try {
    await api.createEvidence(workspace.value.system.versionId, workspace.value.indicator.id, moduleKey, { ...input, expectedTemplateRevision: workspace.value.templateRevision, fieldIds: [fieldKey] });
    await Promise.all([refreshWorkspace(), loadEvidence()]);
    ElMessage.success('依据材料已关联');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '关联依据失败');
  }
}

async function loadEvidence(requestId = workspaceRequestVersion) {
  const context = workspace.value;
  if (!context) return;
  try {
    const result = await api.listEvidence(context.system.versionId, context.indicator.id);
    if (requestId === workspaceRequestVersion && workspace.value?.indicator.id === context.indicator.id) evidenceItems.value = result;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载依据材料失败');
  }
}

async function updateEvidence(item: EvidenceItem, input: Partial<EvidenceItem>) {
  if (!workspace.value) return;
  try {
    await api.updateEvidence(workspace.value.system.versionId, workspace.value.indicator.id, item.id, { ...input, expectedTemplateRevision: workspace.value.templateRevision });
    await Promise.all([refreshWorkspace(), loadEvidence()]);
    ElMessage.success('依据材料已更新');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '更新依据材料失败');
  }
}

async function deleteEvidence(item: EvidenceItem) {
  if (!workspace.value) return;
  try {
    await api.deleteEvidence(workspace.value.system.versionId, workspace.value.indicator.id, item.id);
    await Promise.all([refreshWorkspace(), loadEvidence()]);
    ElMessage.success('依据材料已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除依据材料失败');
  }
}

async function saveSummary(input: { expectedRevisionNo: number; summary: string }) {
  if (!workspace.value) return;
  try {
    await api.saveSummary(workspace.value.system.versionId, workspace.value.indicator.id, input);
    await refreshWorkspace();
    ElMessage.success('研究结论摘要已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存研究结论摘要失败');
  }
}

async function cloneVersion(system: IndicatorSystemSummary, input: { year: number; versionCode: string }) {
  try {
    await api.cloneVersion(system.versionId, input);
    ElMessage.success('已复制为新的草稿版本');
    await loadSystems();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '复制版本失败');
  }
}

async function refreshWorkspace() {
  if (!currentSystem.value || !selectedNode.value) return;
  workspace.value = normalizeWorkspace(await api.getWorkspace(currentSystem.value.versionId, selectedNode.value.id));
  if (!workspace.value.moduleDefinitions.some(m => m.moduleKey === selectedModuleKey.value)) selectedModuleKey.value = workspace.value.moduleDefinitions[0]?.moduleKey || '';
}

async function loadRevisions() {
  if (!workspace.value) return;
  revisionsLoading.value = true;
  try {
    revisions.value = unwrapList(await api.listRevisions(workspace.value.system.versionId, workspace.value.indicator.id));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载修订记录失败');
  } finally {
    revisionsLoading.value = false;
  }
}

async function previewImport(versionId: string, file: File) {
  importBusy.value = true;
  try {
    importFile.value = file;
    importVersionId.value = versionId;
    importPreview.value = await api.createImportPreview(versionId, file);
    ElMessage.info('导入预检完成，请核对错误行后确认');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入预检失败');
  } finally {
    importBusy.value = false;
  }
}

async function commitImport() {
  if (!importVersionId.value || !importFile.value || !importPreview.value?.valid) return;
  importBusy.value = true;
  try {
    const result = await api.importTree(importVersionId.value, importFile.value);
    ElMessage.success(`已导入 ${result.imported} 个指标节点`);
    importPreview.value = null;
    importFile.value = null;
    importVersionId.value = '';
    await loadSystems();
    if (currentSystem.value) await openSystem(currentSystem.value);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认导入失败');
  } finally {
    importBusy.value = false;
  }
}

function resetWorkspaceState() {
  workspaceRequestVersion += 1;
  currentSystem.value = null;
  systemDetail.value = null;
  systemDetailLoading.value = false;
  systemDetailError.value = '';
  selectedNode.value = null;
  workspace.value = null;
  evidenceItems.value = [];
  tree.value = [];
  workspaceError.value = '';
  workspaceDirty.value = false;
}

function navigateGlobal(view: 'systems' | 'semantic' | 'models' | 'mail' | 'users' | 'profile') {
  if (view === 'profile' && unifiedDesktop) { desktop.openPersonalCenter(); return; }
  if ((view === 'users' || view === 'models') && currentUser.value?.role !== 'system_admin') return;
  void router.push({ name: view });
}

async function confirmLeaveWorkspace(): Promise<LeaveDecision> {
  if (workspaceRef.value?.isSaving?.()) {
    ElMessage.warning('内容正在保存，请稍候');
    return 'stay';
  }
  try {
    await ElMessageBox.confirm('当前内容有未保存修改。', '离开研究工作台', {
      confirmButtonText: '保存后离开',
      cancelButtonText: '放弃修改',
      distinguishCancelAndClose: true,
      type: 'warning',
    });
    return 'save';
  } catch (action) {
    return action === 'cancel' ? 'discard' : 'stay';
  }
}

const removeNavigationGuard = installNavigationGuard(router, {
  canNavigate: () => {
    if ((['systems', 'semantic'].includes(String(route.name)) && hasVisibleEditingDialog()) || (activeView.value === 'semantic' && semanticCloseState.value.busy)) {
      ElMessage.warning('请先完成或取消当前操作'); return false;
    }
    return true;
  },
  isAdmin: () => currentUser.value?.role === 'system_admin',
  isWorkspaceDirty: () => workspaceDirty.value || Boolean(workspaceRef.value?.isSaving?.()),
  confirmLeaveWorkspace,
  saveAndContinue: (target) => {
    pendingRouteAfterSave.value = target;
    if (!workspaceRef.value?.saveCurrent()) pendingRouteAfterSave.value = null;
  },
  discardWorkspaceChanges: () => {
    workspaceRef.value?.discardCurrent();
    workspaceDirty.value = false;
  },
});
desktop.configure({
  onNavigate: async path => { await router.push(path); },
  onClose: async () => {
    if (importBusy.value || treeSorting.value || workspaceRef.value?.isSaving() || (activeView.value === 'semantic' && semanticCloseState.value.busy)) { ElMessage.warning('操作正在完成，请稍后关闭'); return false; }
    const hasDialog = hasVisibleEditingDialog();
    if (hasDialog || templateSystem.value || systemEditOpen.value || accessDialogOpen.value) {
      ElMessage.warning('请先完成或取消当前对话框'); return false;
    }
    if ((activeView.value === 'mail' && (mailCloseState.value.dirty || mailCloseState.value.busy)) ||
        (activeView.value === 'models' && (modelCloseState.value.dirty || modelCloseState.value.busy)) ||
        (isWorkspace.value && workspaceCloseState.value.dirty && !workspaceDirty.value)) {
      ElMessage.warning('请先保存或取消当前页面的编辑内容'); return false;
    }
    if (workspaceDirty.value) {
      const decision = await confirmLeaveWorkspace();
      if (decision === 'stay') return false;
      if (decision === 'save') {
        const saved = await new Promise<boolean>(resolve => {
          const timeout = setTimeout(() => { desktopSaveDone = undefined; resolve(false); }, 25000);
          desktopSaveDone = ok => { clearTimeout(timeout); resolve(ok); };
          if (!workspaceRef.value?.saveCurrent()) { desktopSaveDone(false); desktopSaveDone = undefined; }
        });
        if (!saved) return false;
      } else { workspaceRef.value?.discardCurrent(); workspaceDirty.value = false; }
    }
    return true;
  },
});
const desktopCloseState = computed(() => ({
  dirty: workspaceDirty.value || editingDialogOpen.value || Boolean(templateSystem.value) || systemEditOpen.value || accessDialogOpen.value ||
    (isWorkspace.value && workspaceCloseState.value.dirty) || (activeView.value === 'mail' && mailCloseState.value.dirty) || (activeView.value === 'models' && modelCloseState.value.dirty),
  busy: importBusy.value || treeSorting.value || (activeView.value === 'semantic' && semanticCloseState.value.busy) ||
    (isWorkspace.value && workspaceCloseState.value.busy) || (activeView.value === 'mail' && mailCloseState.value.busy) || (activeView.value === 'models' && modelCloseState.value.busy),
}));
watch(desktopCloseState, state => desktop.setState(state), { immediate: true, flush: 'sync' });
watch(() => route.fullPath, path => { desktop.setTitle(currentSystem.value ? `${currentSystem.value.name} · 知识库` : '指标知识库'); desktop.routeChanged(path); }, { immediate: true });

async function syncFromRoute() {
  if (!currentUser.value) return;
  const requestId = ++routeSyncVersion;
  if (route.name === 'users' || route.name === 'models') {
    if (currentUser.value.role !== 'system_admin') {
      await router.replace({ name: 'systems' });
      return;
    }
    resetWorkspaceState();
    return;
  }
  if (route.name === 'systems' || route.name === 'profile' || route.name === 'semantic') {
    resetWorkspaceState();
    return;
  }
  if (route.name !== 'system-detail' && route.name !== 'indicator-workspace') return;

  const versionId = String(route.params.versionId || '');
  if (route.name === 'system-detail') {
    workspaceRequestVersion += 1;
    if (currentSystem.value?.versionId !== versionId || !systemDetail.value) await loadVersionContext(versionId, requestId);
    if (requestId !== routeSyncVersion || systemDetailError.value) return;
    const requestedNode = typeof route.query.node === 'string' ? findNodeById(tree.value, route.query.node) : null;
    const first = requestedNode || findFirstLeaf(tree.value);
    if (first) await router.replace({ name: 'indicator-workspace', params: { versionId, indicatorId: first.id } });
    else { selectedNode.value = null; workspace.value = null; workspaceLoading.value = false; }
    return;
  }

  if (currentSystem.value?.versionId !== versionId || !systemDetail.value) {
    await loadVersionContext(versionId, requestId);
    if (requestId !== routeSyncVersion || systemDetailError.value) return;
  }

  const indicatorId = String(route.params.indicatorId || '');
  const node = findNodeById(tree.value, indicatorId);
  if (!node) {
    ElMessage.error('指标不存在');
    await router.replace({ name: 'system-detail', params: { versionId } });
    return;
  }
  if (selectedNode.value?.id !== node.id || !workspace.value) await selectNode(node, ++workspaceRequestVersion);
}

watch([() => route.fullPath, () => currentUser.value?.userId, () => systems.value, () => systemsLoading.value], () => {
  void syncFromRoute();
}, { immediate: true });

async function restoreSession() {
  authLoading.value = true;
  try {
    currentUser.value = (await api.me()).user;
    await loadSystems();
  } catch (error) {
    currentUser.value = null;
    setCsrfToken('');
    if (!(error instanceof ApiError && error.status === 401)) ElMessage.error(error instanceof Error ? error.message : '恢复登录状态失败');
  } finally {
    authLoading.value = false;
  }
}

async function authenticated(user: SessionUser) {
  currentUser.value = user;
  await loadSystems();
}

async function logout() {
  try { await api.logout(); } catch { ElMessage.error('退出未完成，请检查连接后重试'); return; }
  currentUser.value = null;
  resetWorkspaceState();
  systems.value = [];
  await router.replace({ name: 'systems' });
}

function expireSession() {
  setCsrfToken('');
  currentUser.value = null;
  resetWorkspaceState();
  systems.value = [];
  void router.replace({ name: 'systems' });
}

function openUsers() {
  navigateGlobal('users');
}

function confirmUnload(event: BeforeUnloadEvent) {
  if (desktopCloseState.value.dirty || desktopCloseState.value.busy) { event.preventDefault(); event.returnValue = ''; }
}

onMounted(() => {
  stopEditingDialogObserver = observeEditingDialogs(open => { editingDialogOpen.value = open; });
  window.addEventListener('mg-auth-expired', expireSession);
  window.addEventListener('beforeunload', confirmUnload);
  void restoreSession();
});
onBeforeUnmount(() => {
  stopEditingDialogObserver?.();
  removeNavigationGuard();
  window.removeEventListener('mg-auth-expired', expireSession);
  window.removeEventListener('beforeunload', confirmUnload);
});
</script>

<template>
  <div v-if="authLoading" class="auth-loading"><img :src="appLogoUrl" alt="" /><el-icon class="is-loading"><Loading /></el-icon><span>正在验证登录状态</span></div>
  <LoginView v-else-if="!currentUser" @authenticated="authenticated" />
  <HeaderBar v-else :active-view="activeView" :user="currentUser" @systems="navigateGlobal('systems')" @semantic="navigateGlobal('semantic')" @users="openUsers" @models="navigateGlobal('models')" @mail="navigateGlobal('mail')" @profile="navigateGlobal('profile')" @logout="logout">
      <UsersView v-if="activeView === 'users'" :current-user-id="currentUser.userId" @expired="expireSession" />
      <ModelManagement v-else-if="route.name === 'models' && currentUser.role === 'system_admin'" @close-state-change="modelCloseState = $event" />
      <MailSettings v-else-if="route.name === 'mail' && currentUser.role === 'system_admin'" @close-state-change="mailCloseState = $event" />
      <SemanticLibraries v-else-if="route.name === 'semantic'" :systems="systems" @close-state-change="semanticCloseState = $event" @open-indicator="(versionId, indicatorId) => router.push({ name: 'indicator-workspace', params: { versionId, indicatorId } })" />
      <ProfileView v-else-if="route.name === 'profile'" :user="currentUser" @back="navigateGlobal('systems')" @expired="expireSession" />
      <SystemsView v-else-if="route.name === 'systems'" :systems="systems" :loading="systemsLoading" :error="systemsError" :import-preview="importPreview" :import-busy="importBusy" :can-manage="canCreateSystem" :current-role="currentUser.role" @template-settings="templateSystem = $event" @open="openSystem" @retry="loadSystems" @create="createSystem" @preview-import="previewImport" @commit-import="commitImport" @clone="cloneVersion" />
      <main v-else-if="isWorkspace" class="detail-page">
        <header class="workspace-toolbar">
          <div class="workspace-toolbar-context">
            <el-button class="workspace-back" :icon="ArrowLeft" @click="returnToSystems">返回列表</el-button>
            <h1>{{ currentSystem?.name || '知识库' }}</h1>
          </div>
          <div class="workspace-template-action"><el-button v-if="currentSystem && canManageCatalog" class="workspace-edit-system" :icon="Edit" :disabled="treeLoading || treeSorting" @click="openSystemEdit">编辑指标体系</el-button><el-button v-if="currentAccess.canManageAccess" :icon="User" @click="accessDialogOpen = true">权限管理</el-button><el-button v-if="canManageCatalog && currentSystem" :icon="Setting" @click="openTemplateSettings">模板设置</el-button><div id="workspace-toolbar-actions"></div></div>
        </header>
        <el-alert v-if="workspaceError" type="error" :closable="false" show-icon class="workspace-error"><template #title>{{ workspaceError }}</template><el-button link type="primary" @click="selectedNode ? selectNode(selectedNode) : syncFromRoute()">重新加载</el-button></el-alert>
        <div class="detail-layout">
          <IndicatorTreePanel ref="treePanelRef" :max-level="currentSystem?.maxLevel ?? 3" :sorting="treeSorting" @reorder="reorderNode" :nodes="tree" :selected-id="selectedNode?.id || ''" :readonly="treeReadonly" :loading="treeLoading" @select="onTreeSelect" @add="addNode" @edit="editNode" @remove="removeNode" />
          <div v-if="workspaceLoading" class="workspace-loading"><el-skeleton :rows="14" animated /></div>
          <ResearchWorkspace v-else-if="workspace" toolbar-target="#workspace-toolbar-actions" ref="workspaceRef" :workspace="workspace" :selected-module-key="selectedModuleKey" :save-version="saveVersion" :revisions="revisions" :revisions-loading="revisionsLoading" :readonly="workspaceReadonly" :user-role="currentUser.role" :can-review-access="canReviewSystem" :can-edit-evidence="canEditEvidence" :evidence="evidenceItems" @select-module="selectedModuleKey = $event" @save="saveModule" @add-evidence="addEvidence" @load-revisions="loadRevisions" @load-evidence="loadEvidence" @update-evidence="updateEvidence" @delete-evidence="deleteEvidence" @save-summary="saveSummary" @refresh-template="refreshWorkspace" @dirty-change="workspaceDirty = $event" @close-state-change="workspaceCloseState = $event" />
          <el-empty v-else class="workspace-empty" :description="treeLoading ? '加载中' : tree.length ? '请选择指标' : treeReadonly ? '暂无指标' : '暂无指标，请从左侧新增目录'" />
        </div>
    </main>
      <el-empty v-else description="页面不存在" />
      <SystemAccessDialog v-model="accessDialogOpen" :system="currentSystem" />
      <SystemEditDialog v-if="systemEditOpen && currentSystem" :system="currentSystem" @close="systemEditOpen = false" @saved="systemSaved" @removed="systemRemoved" />
      <TemplateSettings v-if="templateSystem" :system="templateSystem" @close="templateSystem = null" @saved="templatesSaved" />
  </HeaderBar>
</template>

<style>
.workspace-template-action { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.workspace-toolbar .el-button,
.workspace-detail .summary-actions .el-button,
.workspace-detail .module-actions .el-button { height:32px; padding:8px 12px; border-radius:4px; font-size:13px; font-weight:400; }
.workspace-template-action .el-button + .el-button,
.workspace-detail .summary-actions .el-button + .el-button,
.workspace-detail .module-actions .el-button + .el-button { margin-left:0; }
.workspace-toolbar .heading-actions { display:flex; align-items:center; gap:8px; }
.workspace-toolbar .el-button .el-icon { font-size:16px; }
:root {
  --el-color-primary: #409eff;
  --el-color-primary-light-3: #79bbff;
  --el-color-primary-light-5: #a0cfff;
  --el-color-primary-light-7: #c6e2ff;
  --el-color-primary-light-8: #d9ecff;
  --el-color-primary-light-9: #ecf5ff;
  --app-space-1: 4px;
  --app-space-2: 8px;
  --app-space-3: 12px;
  --app-space-4: 16px;
  --app-space-5: 24px;
  --app-space-6: 32px;
  --app-space-7: 48px;
}

* { box-sizing: border-box; }
html, body, #app { margin: 0; min-width: 320px; height: 100%; width: 100%; overflow: hidden; }
body { color: var(--el-text-color-primary); background: var(--el-fill-color-lighter); font-family: var(--mg-font-family); font-size: 14px; }
button, input, textarea, select { font: inherit; letter-spacing: 0; }
.auth-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; gap: 10px; color: #606266; background: #f5f7fa; }.auth-loading img { width: 34px; height: 34px; }.auth-loading .el-icon { color: var(--el-color-primary); font-size: 20px; }
.detail-page { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.detail-layout { --tree-panel-width: 270px; flex: 1; min-height: 0; display: grid; grid-template-columns: var(--tree-panel-width) minmax(620px, 1fr); overflow: hidden; transition: grid-template-columns 180ms ease; }
.workspace-error { margin: 10px 12px 0; }
.aggregate-banner { margin: 10px 12px 0; min-height: 36px; border: 1px solid var(--el-color-primary-light-7); background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2); display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; }
.workspace-loading, .workspace-empty { min-width: 0; background: var(--el-fill-color-lighter); padding: 28px; overflow: auto; }
.workspace-loading .el-skeleton { max-width: 700px; margin: 24px auto; }
.workspace-empty { display: flex; align-items: center; justify-content: center; }

@media (max-width: 1200px) {
  .detail-layout { --tree-panel-width: 250px; grid-template-columns: var(--tree-panel-width) minmax(0, 1fr); }
}

@media (max-width: 1100px) {
  .detail-layout { grid-template-columns: 240px minmax(0, 1fr); }
}

@media (max-width: 900px) {
  .detail-layout { grid-template-columns: minmax(0, 1fr); display: block; overflow: auto; }
  .workspace-loading, .workspace-empty { min-height: 380px; }
}

@media (max-width: 640px) {
  .aggregate-banner { margin: 8px; font-size: 12px; }
}
</style>

<style src="./styles/mg-shell.css"></style>
<style src="./styles/mg-content.css"></style>
