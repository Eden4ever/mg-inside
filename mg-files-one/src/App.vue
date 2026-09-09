<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { ConfiguredApplicationShell, ApplicationDialogHost } from '@mg-inside/frontend';
import { application } from './application';
import { assets } from './registry';
import { dialogs } from './dialogs';
const route = useRoute(), router = useRouter();
</script>
<template><ConfiguredApplicationShell v-if="!dialogs.isDialogWindow" :config="application" :assets="assets" :active-path="route.path==='/my-files/desktop'?route.path:route.path.startsWith('/my-files') ? '/my-files' : route.path" :title="String(route.meta.title || '')" @navigate="router.push($event)"><RouterView/></ConfiguredApplicationShell><ApplicationDialogHost :service="dialogs"/></template>


