<script setup lang="ts">
import { computed, watch } from 'vue';
import { ConfiguredApplicationShell, applyApplicationDocument } from '@mg-inside/frontend';
import enterpriseLogo from '../../../../logo.svg?url';
import { applicationForRole } from '@/application';
import type { SessionUser } from '@/types/domain';
const props = defineProps<{ activeView: 'systems' | 'semantic' | 'models' | 'mail' | 'users' | 'profile'; user: SessionUser }>();
const emit = defineEmits<{ systems: []; semantic: []; users: []; models: []; mail: []; profile: []; logout: [] }>();
const config = computed(() => applicationForRole(props.user.role));
const activePage = computed(() => config.value.pages.find(page => page.id === props.activeView));
watch([config,activePage],()=>applyApplicationDocument(config.value,{enterpriseLogo},activePage.value?.title || '个人中心'),{immediate:true});
function navigate(path: string) {
  const id = config.value.pages.find(page => page.path === path)?.id;
  if (id === 'systems') emit('systems'); else if (id === 'semantic') emit('semantic'); else if (id === 'users') emit('users'); else if (id === 'models') emit('models'); else if (id === 'mail') emit('mail');
}
</script>
<template>
  <ConfiguredApplicationShell :config="config" :assets="{ enterpriseLogo }" :active-path="activePage?.path || '/profile'" :title="activePage?.title || '个人中心'" @navigate="navigate">
    
    <slot />
  </ConfiguredApplicationShell>
</template>

