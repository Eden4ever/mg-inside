<script setup lang="ts">
import { desktop } from '../desktop';
import { identityPresentation } from '../presentation';
const reload = () => window.location.reload();
const back = () => window.location.assign(desktop.origin);
</script>
<template><div class="primary-page"><div class="primary-page-heading"><h1>管理访问受限</h1></div><el-result icon="info" :title="`当前账号没有${identityPresentation.name}管理权限`" :sub-title="`此应用需要${identityPresentation.name}应用授权及平台管理员角色。请联系管理员分配权限。`"><template #extra><el-button type="primary" @click="back">返回桌面</el-button><el-button @click="reload">重新检查授权</el-button></template></el-result></div></template>
