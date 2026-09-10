import { effectScope, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ManagedUser } from './api/client';
import { useUserDirectory } from './use-user-directory';

function employee(id: string, overrides: Partial<ManagedUser> = {}): ManagedUser {
  return { id, username: id, displayName: id, departmentName: null, role: 'member', roles: [], status: 'active', lastLoginAt: null, createdAt: '', updatedAt: '', wecomBound: false, wecomIdentities: [], ...overrides };
}

describe('员工目录筛选', () => {
  it('部门规范化、未设置部门和名为 all 的真实部门可以分别筛选', () => {
    const scope = effectScope();
    scope.run(() => {
      const directory = useUserDirectory(ref([
        employee('a', { departmentName: ' 研发部 ' }), employee('b', { departmentName: '研发部' }),
        employee('c'), employee('d', { departmentName: '  ' }), employee('e', { departmentName: 'all' }),
      ]));
      expect(directory.departments.value.find(d => d.name === '研发部')?.count).toBe(2);
      directory.department.value = '研发部'; expect(directory.filtered.value.map(u => u.id)).toEqual(['a', 'b']);
      directory.department.value = ''; expect(directory.filtered.value.map(u => u.id)).toEqual(['c', 'd']);
      directory.department.value = 'all'; expect(directory.filtered.value.map(u => u.id)).toEqual(['e']);
      directory.clearFilters(); expect(directory.filtered.value).toHaveLength(5);
    });
    scope.stop();
  });
  it('角色按 ID 区分同名角色，来源和状态与搜索取交集', () => {
    const scope = effectScope();
    scope.run(() => {
      const directory = useUserDirectory(ref([
        employee('ALICE', { departmentName: '研发部', roles: [{ id: 'r1', name: '成员', key: null }], wecomBound: true, status: 'disabled' }),
        employee('alice-2', { departmentName: '研发部', roles: [{ id: 'r2', name: '成员', key: null }], wecomBound: true }),
        employee('bob', { zentaoIdentities: [{ id: 'z', account: 'bob', server: 'test' }] }),
      ]));
      directory.query.value = ' alice '; directory.role.value = 'r1'; directory.status.value = 'disabled'; directory.source.value = 'wecom'; directory.department.value = '研发部';
      expect(directory.filtered.value.map(u => u.id)).toEqual(['ALICE']);
      directory.source.value = 'unbound'; expect(directory.filtered.value).toHaveLength(0);
      directory.clearFilters(); directory.source.value = 'zentao'; expect(directory.filtered.value.map(u => u.id)).toEqual(['bob']);
    });
    scope.stop();
  });
  it('筛选、每页数量调整和刷新缩减数据后不出现越界空页', () => {
    const scope = effectScope();
    scope.run(() => {
      const users = ref(Array.from({ length: 25 }, (_, i) => employee(`user-${i}`)));
      const directory = useUserDirectory(users);
      directory.page.value = 3; expect(directory.rows.value).toHaveLength(1);
      users.value = users.value.slice(0, 13); expect(directory.page.value).toBe(2);
      directory.query.value = 'user-0'; expect(directory.page.value).toBe(1); expect(directory.rows.value).toHaveLength(1);
      directory.clearFilters(); directory.page.value = 2; directory.pageSize.value = 24;
      expect(directory.page.value).toBe(1); expect(directory.rows.value).toHaveLength(13);
      users.value = []; expect(directory.page.value).toBe(1); expect(directory.rows.value).toEqual([]);
    });
    scope.stop();
  });
});
