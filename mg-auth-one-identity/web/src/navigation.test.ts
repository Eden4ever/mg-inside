import { describe, expect, it } from 'vitest';
import { identityAuthorizePath, managementReturnPath } from './navigation';

describe('管理页与认证域名的返回路径边界', () => {
  it('仅允许已知管理页并保留用户和角色筛选', () => {
    expect(managementReturnPath('/roles')).toBe('/roles');
    expect(managementReturnPath('/applications?role=role-1&token=secret')).toBe('/applications?role=role-1');
    for (const path of ['//evil.invalid', '/\\evil.invalid', 'https://evil.invalid', '/apps/identity/roles', '/api/unified/authorize?client_id=x']) expect(managementReturnPath(path)).toBe('/');
  });
  it('PKCE返回只能进入当前认证域名的固定端点，不能被挂载路径或外部地址替代', () => {
    const path = '/api/unified/authorize?client_id=desktop-one&state=abc';
    expect(identityAuthorizePath(path, 'https://identity.example')).toBe(path);
    for (const value of ['https://evil.invalid/api/unified/authorize?a=1', '//evil.invalid/api/unified/authorize?a=1', '/apps/identity/api/unified/authorize?a=1', '/api/unified/authorize?x=1\n', '/api/unified/authorize?x=\\evil']) expect(identityAuthorizePath(value, 'https://identity.example')).toBeNull();
  });
});
