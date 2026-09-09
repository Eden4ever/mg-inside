<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import PlatformIcon from './PlatformIcon.vue';
import type { ApplicationNavigationConfig, ApplicationPageConfig } from './config/application';
const props = withDefaults(defineProps<{ navigation: ApplicationNavigationConfig; pages: ApplicationPageConfig[]; activePath: string; collapsed?: boolean }>(), { collapsed: true });
const emit = defineEmits<{ navigate: [path: string]; expand: [] }>();
const opened = ref(new Set<string>());
const byId = computed(() => new Map(props.pages.map(page => [page.id, page])));
function page(id: string) { const result = byId.value.get(id); if (!result) throw new Error(`应用导航：页面 ${id} 未声明`); return result; }
function toggle(id: string) { if (props.collapsed) { emit('expand'); opened.value.add(id); } else if (opened.value.has(id)) opened.value.delete(id); else opened.value.add(id); }
watch(() => [props.activePath, props.navigation] as const, () => {
  if (props.navigation.mode === 'tree') for (const parent of props.navigation.parents) if (parent.children.some(id => page(id).path === props.activePath)) opened.value.add(parent.id);
}, { immediate: true });
</script>

<template>
  <nav class="global-nav mg-application-navigation" aria-label="全局导航">
    <template v-if="navigation.mode === 'flat'">
      <button v-for="id in navigation.pageIds" :key="id" type="button" class="nav-item" :class="{ active: activePath === page(id).path }" :title="page(id).title" :aria-label="page(id).title" :aria-current="activePath === page(id).path ? 'page' : undefined" @click="emit('navigate', page(id).path)"><i class="el-icon"><PlatformIcon :name="page(id).icon" /></i><span v-if="!collapsed">{{ page(id).title }}</span></button>
    </template>
    <template v-else-if="navigation.mode === 'grouped'">
      <section v-for="group in navigation.groups" :key="group.id" class="mg-navigation-group" :aria-label="group.label">
        <h2 v-if="!collapsed" class="mg-navigation-label">{{ group.label }}</h2>
        <button v-for="id in group.pageIds" :key="id" type="button" class="nav-item" :class="{ active: activePath === page(id).path }" :title="page(id).title" :aria-label="page(id).title" :aria-current="activePath === page(id).path ? 'page' : undefined" @click="emit('navigate', page(id).path)"><i class="el-icon"><PlatformIcon :name="page(id).icon" /></i><span v-if="!collapsed">{{ page(id).title }}</span></button>
      </section>
    </template>
    <template v-else>
      <section v-for="parent in navigation.parents" :key="parent.id" class="mg-navigation-parent" :aria-label="parent.label">
        <button type="button" class="nav-item" :class="{ active: collapsed && parent.children.some(id => page(id).path === activePath) }" :title="parent.label" :aria-label="parent.label" :aria-expanded="!collapsed && opened.has(parent.id)" @click="toggle(parent.id)"><i class="el-icon"><PlatformIcon :name="parent.icon" /></i><span v-if="!collapsed">{{ parent.label }}</span><svg v-if="!collapsed" class="mg-navigation-chevron" :class="{ open: opened.has(parent.id) }" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg></button>
        <div v-if="!collapsed && opened.has(parent.id)" class="mg-navigation-children">
          <button v-for="id in parent.children" :key="id" type="button" class="nav-item" :class="{ active: activePath === page(id).path }" :title="page(id).title" :aria-label="page(id).title" :aria-current="activePath === page(id).path ? 'page' : undefined" @click="emit('navigate', page(id).path)"><i class="el-icon"><PlatformIcon :name="page(id).icon" /></i><span>{{ page(id).title }}</span></button>
        </div>
      </section>
    </template>
  </nav>
</template>

<style scoped>
.nav-item { display:flex; align-items:center; font:inherit; cursor:pointer; }
.nav-item:focus-visible { outline:2px solid var(--el-color-primary,#0052d9); outline-offset:-2px; }
.el-icon { display:inline-flex; width:1em; height:1em; flex:none; align-items:center; justify-content:center; }
.el-icon svg { width:1em; height:1em; }
.mg-navigation-group,.mg-navigation-parent,.mg-navigation-children { display:flex; flex-direction:column; gap:4px; }
.mg-navigation-group + .mg-navigation-group { margin-top:8px; padding-top:8px; border-top:1px solid var(--el-border-color-lighter,#e5eaf0); }
.mg-navigation-label { margin:0; padding:8px 12px 4px; font-size:12px; font-weight:400; color:var(--el-text-color-secondary,#8792a2); }
.mg-navigation-children { margin-left:12px; }
.mg-navigation-chevron { margin-left:auto; width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:1.5; transition:transform .15s; }
.mg-navigation-chevron.open { transform:rotate(90deg); }
</style>
