<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { User, Connection, Lock, Setting, ArrowRight } from '@element-plus/icons-vue';
import { api, type Application, type ManagedRole, type ManagedUser } from '../api/client';
const users = ref<ManagedUser[]>([]), apps = ref<Application[]>([]), roles = ref<ManagedRole[]>([]), error = ref(''), loading = ref(true);
const businessApps = computed(() => apps.value.filter(a => !a.foundation));
const grantedPairs = computed(() => {
  const active = new Set(users.value.filter(u => u.status === 'active').map(u => u.id));
  return businessApps.value.filter(a => a.enabled).reduce((total, app) => {
    const subjects = new Set(app.memberships.filter(m => m.enabled && active.has(m.userId)).map(m => m.userId));
    roles.value.filter(r => r.applications.some(a => a.clientId === app.clientId && a.enabled)).forEach(r => r.members.forEach(m => { if (active.has(m.userId)) subjects.add(m.userId); }));
    return total + subjects.size;
  }, 0);
});
onMounted(async () => { try { [users.value, apps.value, roles.value] = await Promise.all([api.users(), api.applications(), api.roles()]); } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; } });
</script>
<template><div class="primary-page overview-page" v-loading="loading"><div class="primary-page-heading"><div><h1>管理概览</h1><p>统一管理员工身份、授权角色、应用访问和认证配置。</p></div></div><el-alert v-if="error" :title="error" type="error" :closable="false" />
  <div class="primary-page-scroll" tabindex="0" aria-label="管理概览内容"><div class="overview-body">
    <div class="stats-grid"><div class="stat-card"><el-icon><User /></el-icon><div><span>员工身份</span><strong>{{ users.length }}</strong><small>{{ users.filter(u=>u.status==='active').length }} 位启用成员</small></div></div><div class="stat-card"><el-icon><Lock /></el-icon><div><span>授权角色</span><strong>{{ roles.length }}</strong><small>支持用户同时加入多个角色</small></div></div><div class="stat-card"><el-icon><Connection /></el-icon><div><span>有效应用授权</span><strong>{{ grantedPairs }}</strong><small>用户与应用去重，合并全部来源</small></div></div></div>
    <section class="panel"><div class="section-title"><h2>管理入口</h2><span>{{ businessApps.length }} 个登记业务应用</span></div><div class="management-links">
      <router-link to="/admin" class="quick-link"><el-icon><User /></el-icon><div><h3>员工身份</h3><p>创建账号、维护用户资料和登录身份</p></div><el-icon><ArrowRight /></el-icon></router-link>
      <router-link to="/roles" class="quick-link"><el-icon><Lock /></el-icon><div><h3>角色管理</h3><p>管理授权角色及其成员</p></div><el-icon><ArrowRight /></el-icon></router-link>
      <router-link to="/applications" class="quick-link"><el-icon><Connection /></el-icon><div><h3>应用授权</h3><p>按用户、角色分配授权并核对来源</p></div><el-icon><ArrowRight /></el-icon></router-link>
      <router-link to="/settings" class="quick-link"><el-icon><Setting /></el-icon><div><h3>认证配置</h3><p>管理身份提供方及认证基础服务</p></div><el-icon><ArrowRight /></el-icon></router-link>
    </div></section>
  </div></div>
</div></template>
<style scoped>.management-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}@media(max-width:720px){.management-links{grid-template-columns:1fr}}</style>
