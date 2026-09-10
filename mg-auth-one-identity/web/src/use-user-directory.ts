import { computed, ref, watch, type Ref } from 'vue';
import type { ManagedUser } from './api/client';

export function useUserDirectory(users: Ref<ManagedUser[]>) {
  // null 表示全部部门，空字符串表示未设置；保留真实部门名称（包括 all）。
  const department = ref<string | null>(null);
  const query = ref(''), status = ref('all'), role = ref(''), source = ref('all'), organization = ref('');
  const page = ref(1), pageSize = ref(12);
  const departments = computed(() => {
    const counts = new Map<string, number>();
    for (const user of users.value) {
      const name = user.departmentName?.trim() || '';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name === '' ? 1 : b.name === '' ? -1 : a.name.localeCompare(b.name, 'zh-CN'));
  });
  const filtered = computed(() => {
    const term = query.value.trim().toLocaleLowerCase();
    return users.value.filter(user => {
      const wecom = user.wecomBound, zentao = Boolean(user.zentaoIdentities?.length);
      return (department.value === null || (user.departmentName?.trim() || '') === department.value)
        && (status.value === 'all' || user.status === status.value)
        && (!organization.value || user.organizations?.some(item => item.id === organization.value))
        && (!role.value || user.roles?.some(item => item.id === role.value))
        && (source.value === 'all' || (source.value === 'wecom' ? wecom : source.value === 'zentao' ? zentao : !wecom && !zentao))
        && `${user.displayName} ${user.username || ''} ${user.departmentName || ''} ${user.organizations?.map(o => o.name).join(' ') || ''}`.toLocaleLowerCase().includes(term);
    });
  });
  const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
  const hasFilters = computed(() => Boolean(organization.value || query.value || department.value !== null || status.value !== 'all' || role.value || source.value !== 'all'));
  watch([organization, query, department, status, role, source, pageSize], () => { page.value = 1; }, { flush: 'sync' });
  watch(() => filtered.value.length, total => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(total / pageSize.value)));
  }, { flush: 'sync' });
  function clearFilters() {
    organization.value = ''; query.value = ''; department.value = null; status.value = 'all'; role.value = ''; source.value = 'all';
  }
  return { organization, query, department, status, role, source, page, pageSize, departments, filtered, rows, hasFilters, clearFilters };
}
