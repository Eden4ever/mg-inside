<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { applicationIcons, type ApplicationIconId } from './assets';
const props = defineProps<{ app: { id: string; icon?: string } }>();
const failed = ref<string[]>([]);
const badgeFailed = ref(false);
const asset = computed(() => {
  // 兼容旧目录的四类图标标记；新的注册项直接指定公共图标资源键。
  const key = props.app.icon && Object.hasOwn(applicationIcons, props.app.icon) ? props.app.icon
    : !props.app.icon || ['knowledge', 'token', 'identity', 'personal'].includes(props.app.icon) ? props.app.id : props.app.icon;
  return Object.hasOwn(applicationIcons, key) ? applicationIcons[key as ApplicationIconId] : undefined;
});
const source = computed(() => [asset.value?.image, asset.value?.src, applicationIcons.placeholder.src].find((src): src is string => !!src && !failed.value.includes(src)));
const imageStyle = computed(() => {
  const box = source.value === asset.value?.image ? asset.value?.imageViewport : undefined;
  if (!box) return undefined;
  const [x = 0, y = 0, width = 100, height = 100] = box; const scale = 100 / Math.max(width, height);
  return { width: `${scale * 100}%`, height: `${scale * 100}%`, left: `${50 - (x + width / 2) * scale}%`, top: `${50 - (y + height / 2) * scale}%` };
});
const isPlaceholder = computed(() => !source.value || source.value === applicationIcons.placeholder.src);
function imageFailed() { if (source.value) failed.value.push(source.value); }
watch([() => props.app.id, () => asset.value?.image, () => asset.value?.src], () => { failed.value = []; badgeFailed.value = false; });
</script>
<template>
  <span class="app-icon mg-application-icon image-icon" :data-placeholder="isPlaceholder ? 'true' : undefined" aria-hidden="true">
    <img v-if="source" :src="source" alt="" draggable="false" :style="imageStyle" @error="imageFailed" />
    <span v-else class="empty-icon" />
    <img v-if="asset?.badge && !isPlaceholder && !badgeFailed" class="application-badge" :src="asset.badge" alt="" draggable="false" @error="badgeFailed = true" />
  </span>
</template>
<style scoped>
.app-icon { width:52px; height:52px; position:relative; display:grid; place-items:center; background:transparent; box-shadow:none; border-radius:0; transition:transform .18s ease; flex-shrink:0; }
.app-icon img { position:absolute; left:0; top:0; max-width:none; width:100%; height:100%; object-fit:contain; pointer-events:none; user-select:none; }
.app-icon img.application-badge { width:42%; height:42%; left:auto; top:auto; right:0; bottom:0; filter:drop-shadow(0 1px 1px #12375124); }
.empty-icon { width:100%; height:100%; border-radius:23.4375%; background:#b5bfcd; box-shadow:inset 0 1px 1px #ffffff40; }
</style>
