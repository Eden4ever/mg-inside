<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ApplicationHeader from './ApplicationHeader.vue';
import ApplicationIcon from './ApplicationIcon.vue';
import PlatformAccount from './PlatformAccount.vue';
import type { ApplicationConfig } from './config/application';
const props = defineProps<{ config: ApplicationConfig; assets?: Record<string, string>; title?: string }>();
const emit = defineEmits<{ navigate: [path: string] }>();
const dark = ref(false), failed = ref(false);
let observer: MutationObserver | undefined, media: MediaQueryList | undefined;
function appearance() {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  const scheme = getComputedStyle(root).colorScheme;
  dark.value = root.classList.contains('dark') || theme === 'dark' ? true : root.classList.contains('light') || theme === 'light' ? false : scheme === 'dark' ? true : scheme === 'light' ? false : !!media?.matches;
}
const logo = computed(() => { const image = props.config.brand.logo; return image ? props.assets?.[dark.value && image.darkSrc ? image.darkSrc : image.src] : undefined; });
watch(logo, () => { failed.value = false; });
onMounted(() => { media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', appearance); observer = new MutationObserver(appearance); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }); appearance(); });
onUnmounted(() => { observer?.disconnect(); media?.removeEventListener('change', appearance); });
</script>
<template>
  <ApplicationHeader :brand-name="config.brand.name" :title="config.header.showTitle ? title : ''" :show-brand="config.header.showBrand !== false">
    <template #brand><button class="brand-lockup configured-brand" type="button" :aria-label="`${config.brand.name}首页`" @click="emit('navigate', config.brand.homePath || config.defaultPath)">
      <img v-if="logo && !failed" :key="logo" class="brand-logo" :src="logo" :alt="config.brand.logo?.alt || config.brand.name" @error="failed = true" />
      <ApplicationIcon v-else :app="{ id: config.appId }" class="brand-symbol" />
      <span class="brand-copy"><strong>{{ config.brand.name }}</strong><span v-if="config.brand.description">{{ config.brand.description }}</span></span>
    </button></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template v-if="config.header.showAccount !== false" #account><PlatformAccount /></template>
  </ApplicationHeader>
</template>
<style scoped>
.configured-brand { display:flex; align-items:center; gap:12px; border:0; background:transparent; padding:0; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.brand-logo,.brand-symbol { width:32px; height:32px; flex:none; object-fit:contain; }
.brand-copy { display:flex; flex-direction:column; min-width:0; }
.brand-copy > span { font-size:12px; color:var(--el-text-color-secondary); }
.configured-brand:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:4px; border-radius:4px; }
@media(max-width:640px) { .configured-brand { width:auto; flex-basis:auto; } .configured-brand:has(.brand-logo) .brand-copy { display:none; } }
</style>
