<script setup lang="ts">
import { getPlatformOrigin } from './auth/platform-origin';
const desktopUrl = `${getPlatformOrigin()}/`;
const embedded = document.documentElement.classList.contains('desktop-embedded');
withDefaults(defineProps<{
  brandName: string;
  logo?: string;
  logoAlt?: string;
  title?: string;
  description?: string;
  showBrand?: boolean;
}>(), { logoAlt: '', title: '', description: '', showBrand: true });
defineEmits<{ home: [] }>();
</script>

<template>
  <header class="app-header mg-application-header">
    <template v-if="showBrand"><slot name="brand">
      <button class="brand-lockup" type="button" :aria-label="`${brandName}首页`" @click="$emit('home')">
        <img v-if="logo" class="brand-logo" :src="logo" :alt="logoAlt" />
        <span class="brand-copy"><strong>{{ brandName }}</strong><span v-if="description">{{ description }}</span></span>
      </button>
    </slot></template>
    <div class="header-breadcrumb" aria-label="当前模块"><strong>{{ title }}</strong></div>
    <div class="header-right"><slot name="actions" />
      <a v-if="!embedded" class="desktop-return" :href="desktopUrl" aria-label="回到桌面" title="回到桌面">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>
        <span>回到桌面</span>
      </a>
      <slot name="account" />
    </div>
  </header>
</template>

<style scoped>
.mg-application-header { display:flex; align-items:center; min-width:0; gap:16px; }
.brand-lockup, :slotted(.brand-lockup) { display:flex; align-items:center; min-width:0; color:inherit; text-decoration:none; }
button.brand-lockup { padding:0; border:0; background:transparent; font:inherit; text-align:left; cursor:pointer; }
button.brand-lockup:focus-visible { outline:2px solid var(--el-color-primary,#0052d9); outline-offset:4px; border-radius:4px; }
.brand-copy { display:flex; flex-direction:column; min-width:0; }
.brand-logo { object-fit:contain; flex:none; }
.header-breadcrumb { flex:1; min-width:0; }
.header-right { display:flex; align-items:center; min-width:0; flex:none; }
.desktop-return { display:inline-flex; align-items:center; gap:6px; min-height:32px; margin-right:12px; padding:4px 8px; border-radius:6px; color:var(--el-text-color-regular); text-decoration:none; font-size:13px; white-space:nowrap; }
.desktop-return:hover { color:var(--el-color-primary); background:var(--el-color-primary-light-9); }
.desktop-return:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:2px; }
.desktop-return svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
@media(max-width:640px) { .brand-lockup:has(.brand-logo) .brand-copy { display:none; } }
@media(max-width:640px) {
  .app-header.mg-application-header .brand-lockup { width:auto; flex-basis:auto; }
  .app-header.mg-application-header .header-breadcrumb { display:none; }
  .app-header.mg-application-header .header-right { margin-left:auto; gap:8px; }
  .desktop-return { margin-right:0; }
  .desktop-return span { display:none; }
}
</style>
