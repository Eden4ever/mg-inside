<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { DesktopApp } from '../../../../mg-platform/packages/frontend/desktop-contracts/src/index';

const props = defineProps<{ enabled: boolean; shortcuts?: DesktopApp[] }>();
const emit = defineEmits<{ open: [path: string]; launch: [app: DesktopApp]; context: [event: MouseEvent, item: DesktopItem]; shortcutContext: [event: MouseEvent, app: DesktopApp]; trashCount: [count: number] }>();
type DesktopItem = { id: string; name: string; kind: 'file' | 'folder'; version?: number };
const root = ref<HTMLElement>(), items = ref<DesktopItem[]>([]), selectedId = ref('');
let request: AbortController | undefined, interval: ReturnType<typeof setInterval> | undefined;
let generation = 0, disposed = false;

function reset() {
  generation++; request?.abort(); request = undefined;
  items.value = []; selectedId.value = '';
  emit('trashCount', 0);
}
function validItem(value: unknown): value is DesktopItem {
  const item = value as DesktopItem | null;
  return !!item && typeof item.id === 'string' && !!item.id && typeof item.name === 'string'
    && !!item.name && (item.kind === 'file' || item.kind === 'folder');
}
async function refresh() {
  if (disposed || !props.enabled || !navigator.onLine) return;
  const version = ++generation;
  request?.abort(); const controller = new AbortController(); request = controller;
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('/api/apps/files/desktop', {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    });
    if (disposed || version !== generation || !props.enabled) return;
    if (response.status === 401 || response.status === 403) { reset(); return; }
    if (!response.ok) return;
    const data: { folderId?: unknown; items?: unknown; trashCount?: unknown } = await response.json();
    if (disposed || version !== generation || !props.enabled) return;
    if (typeof data.folderId !== 'string' || !Array.isArray(data.items)) return;
    if (Number.isSafeInteger(data.trashCount) && Number(data.trashCount) >= 0) emit('trashCount', Number(data.trashCount));
    const seen = new Set<string>();
    items.value = data.items.filter(validItem).filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id); return true;
    }).map(({ id, name, kind, version }) => ({ id, name, kind, version }));
    if (!selectedId.value.startsWith('app:') && !items.value.some(item => item.id === selectedId.value)) selectedId.value = '';
  } catch {
    // 断网或超时只影响刷新，当前账号已显示的文件仍可选择和打开。
  } finally {
    clearTimeout(timeout);
    if (request === controller) request = undefined;
  }
}
function open(item: DesktopItem) {
  if (!props.enabled) return;
  selectedId.value = item.id;
  const id = encodeURIComponent(item.id);
  emit('open', item.kind === 'folder' ? `/my-files/${id}` : `/my-files?open=${id}`);
}
function visible() { if (document.visibilityState === 'visible') void refresh(); }
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) selectedId.value = '';
}
watch(() => props.enabled, enabled => { reset(); if (enabled) void refresh(); });
onMounted(() => {
  void refresh();
  window.addEventListener('focus', visible);
  window.addEventListener('online', visible);
  window.addEventListener('pointerdown', outside);
  document.addEventListener('visibilitychange', visible);
  interval = setInterval(visible, 15_000);
});
onUnmounted(() => {
  disposed = true; reset(); clearInterval(interval);
  window.removeEventListener('focus', visible);
  window.removeEventListener('online', visible);
  window.removeEventListener('pointerdown', outside);
  document.removeEventListener('visibilitychange', visible);
});
// 宿主应按 session.user.id 设置组件 key；账号变化时销毁旧实例，禁止跨账号复用文件状态。
defineExpose({ refresh });
</script>

<template>
  <ul v-if="enabled && (items.length || shortcuts?.length)" ref="root" class="desktop-files" aria-label="桌面文件与快捷方式">
    <li v-for="app in shortcuts || []" :key="`shortcut-${app.id}`">
      <button type="button" class="desktop-file desktop-app-shortcut" :class="{ selected: selectedId === `app:${app.id}` }" :aria-label="`${app.name}快捷方式`" :title="app.name" @click.stop="selectedId = `app:${app.id}`" @dblclick.stop="emit('launch', app)" @keydown.enter.prevent.stop="emit('launch', app)" @contextmenu.prevent.stop="emit('shortcutContext', $event, app)"><span class="shortcut-art"><AppIcon :app="app"/><span class="shortcut-arrow" aria-hidden="true">↗</span></span><span class="desktop-file-name">{{ app.name }}</span></button>
    </li>
    <li v-for="item in items" :key="item.id">
      <button type="button" class="desktop-file" :class="{ selected: selectedId === item.id }"
        :aria-label="`${item.name}（${item.kind === 'folder' ? '文件夹' : '文件'}）`"
        :aria-pressed="selectedId === item.id" :title="`${item.name}\n双击或按 Enter 打开`"
        @click.stop="selectedId = item.id" @dblclick.stop="open(item)" @keydown.enter.prevent.stop="open(item)" @contextmenu.prevent.stop="selectedId = item.id; emit('context', $event, item)">
        <svg v-if="item.kind === 'folder'" class="desktop-file-icon folder" viewBox="0 0 64 64" aria-hidden="true">
          <path d="M6 16a5 5 0 0 1 5-5h15l7 7h20a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5Z" fill="#428bd0" />
          <path d="M6 24h52v25a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5Z" fill="#78baf0" />
        </svg>
        <svg v-else class="desktop-file-icon" viewBox="0 0 64 64" aria-hidden="true">
          <path d="M16 6h22l12 12v36a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" fill="#fafcff" stroke="#9cacbf" stroke-width="1.5" />
          <path d="M38 6v12h12" fill="#dde6f0" stroke="#9cacbf" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M22 31h18M22 38h18M22 45h12" fill="none" stroke="#839ab3" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        <span class="desktop-file-name">{{ item.name }}</span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.desktop-files{position:absolute;inset:18px 18px 12px;z-index:0;display:grid;grid-template-rows:repeat(auto-fill,120px);grid-auto-columns:104px;grid-auto-flow:column;align-content:start;justify-content:start;gap:14px 12px;margin:0;padding:4px;list-style:none;overflow:auto;pointer-events:none}
.desktop-files>li{min-width:0;align-self:start;pointer-events:auto}
.desktop-file{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:5px;width:100%;min-height:108px;margin:0;padding:7px 5px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ink,#203149);font:inherit;cursor:default;user-select:none}
.desktop-file:hover{background:#ffffff24}.desktop-file.selected{background:#a8ccff5c;border-color:#6c9fd16b}.desktop-file:focus-visible{outline:2px solid var(--accent,#0052d9);outline-offset:2px}
.desktop-file-icon{width:56px;height:56px;flex-shrink:0}.desktop-file-name{max-width:100%;font-size:12px;line-height:1.55;text-align:center;white-space:normal;overflow-wrap:anywhere;text-shadow:0 1px 2px #ffffff80}
.shortcut-art{width:56px;height:56px;position:relative;display:grid;place-items:center}.shortcut-arrow{position:absolute;left:0;bottom:0;background:#f8fbff;border:1px solid #adbdd0;color:#315a8a;width:16px;height:16px;border-radius:3px;font-size:13px;line-height:14px}
:global(.desktop.dark) .desktop-file-name{text-shadow:0 1px 2px #0009}:global(.desktop.dark) .desktop-file.selected{background:#21518c70;border-color:#84b4eb80}
@media(max-width:640px){.desktop-files{inset:12px 8px;grid-auto-columns:92px;grid-template-rows:repeat(auto-fill,120px);gap:10px 5px}.desktop-file{padding-inline:3px}}
</style>
