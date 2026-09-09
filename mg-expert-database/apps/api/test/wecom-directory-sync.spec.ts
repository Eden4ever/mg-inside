import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../src/auth';
import type { PrismaService } from '../src/prisma.service';
import { WeComAuthService } from '../src/wecom-auth';

describe('WeComAuthService directory sync', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WECOM_LOGIN_ENABLED = 'true';
    process.env.WECOM_CORP_ID = 'ww-test';
    process.env.WECOM_AGENT_ID = '1000007';
    process.env.WECOM_APP_SECRET = 'test-secret';
    process.env.WECOM_REDIRECT_URI = 'https://example.test/api/auth/wecom/callback';
    process.env.WECOM_DIRECTORY_SYNC_ENABLED = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('新增用户默认只读，同名本地账户不自动绑定，已撤销身份不恢复', async () => {
    const users = [
      { id: 'u-bound', username: null, displayName: '旧姓名', departmentName: null, role: 'researcher', status: 'disabled', authSource: 'wecom' },
      { id: 'u-admin', username: 'leader', displayName: '本地管理员', departmentName: '旧部门', role: 'system_admin', status: 'active', authSource: 'local' },
    ];
    const identities = [{ id: 'identity-1', userId: 'u-bound', corpId: 'ww-test', externalUserId: 'bound-user' }];
    const auditCreate = vi.fn();
    const transaction = {
      $queryRaw: vi.fn(),
      weComIdentityRevocation: {
        findUnique: vi.fn(async ({ where }: { where: { corpId_externalUserId: { externalUserId: string } } }) => where.corpId_externalUserId.externalUserId === 'revoked-member' ? { revokedAt: new Date() } : null),
      },
      weComIdentity: {
        findUnique: vi.fn(async ({ where }: { where: Record<string, Record<string, string>> }) => {
          if (where.corpId_externalUserId) {
            const key = where.corpId_externalUserId;
            const identity = identities.find((item) => item.corpId === key.corpId && item.externalUserId === key.externalUserId);
            if (!identity) return null;
            return { ...identity, user: users.find((user) => user.id === identity.userId)! };
          }
          const key = where.userId_corpId!;
          return identities.find((item) => item.userId === key.userId && item.corpId === key.corpId) ?? null;
        }),
        create: vi.fn(async ({ data }: { data: { userId: string; corpId: string; externalUserId: string } }) => {
          const identity = { id: `identity-${identities.length + 1}`, ...data };
          identities.push(identity);
          return identity;
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { username: string } }) => users.find((user) => user.username === where.username) ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { displayName?: string; departmentName?: string | null } }) => {
          const user = users.find((item) => item.id === where.id)!;
          Object.assign(user, data);
          return user;
        }),
        create: vi.fn(async ({ data }: { data: typeof users[number] & { passwordHash: null } }) => {
          const user = { ...data, id: `u-${users.length + 1}` };
          users.push(user);
          return user;
        }),
      },
      auditLog: { create: auditCreate },
    };
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)) } as unknown as PrismaService;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', access_token: 'token', expires_in: 7200 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', department: [{ id: 1, name: '总部' }, { id: 2, name: '研究部' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', userlist: [
        { userid: 'bound-user', name: '同步姓名', department: [2] },
        { userid: 'leader', name: '企业管理员', department: [1] },
        { userid: 'new-member', name: '新增成员', department: [2] },
        { userid: 'revoked-member', name: '已解绑成员', department: [2] },
      ] })));
    vi.stubGlobal('fetch', fetchMock);
    const service = new WeComAuthService(prisma, {} as AuthService);

    const result = await service.syncDirectory({ userId: 'u-admin', name: '管理员', role: 'system_admin' });

    expect(result).toMatchObject({ total: 4, created: 1, updated: 1, bound: 0, conflicts: 2 });
    expect(users.find((user) => user.id === 'u-bound')).toMatchObject({ displayName: '同步姓名', departmentName: '研究部', role: 'researcher', status: 'disabled' });
    expect(users.find((user) => user.id === 'u-admin')).toMatchObject({ displayName: '本地管理员', departmentName: '旧部门', role: 'system_admin', status: 'active' });
    expect(users.find((user) => user.displayName === '新增成员')).toMatchObject({ username: null, role: 'reader', status: 'active', authSource: 'wecom' });
    expect(identities.some(identity => identity.externalUserId === 'leader' || identity.externalUserId === 'revoked-member')).toBe(false);
    expect(identities).toEqual(expect.arrayContaining([expect.objectContaining({ externalUserId: 'new-member' })]));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'user.wecom_directory_synced', detail: expect.objectContaining({ total: 4, created: 1 }) }) }));
  });
});
