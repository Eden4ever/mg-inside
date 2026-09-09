import type { PrismaClient } from '@prisma/client';
import { weComAvatar } from './profile-avatar';

/** 发布时补齐既有绑定账号头像；不导入通讯录，也不修改身份、权限或其他资料。 */
export async function syncWeComAvatars(prisma: PrismaClient, config: { corpId: string; secret: string }, apply = false, request: typeof fetch = fetch) {
  const counts = { total: 0, updated: 0, unchanged: 0, unavailable: 0, failed: 0, skipped: 0, dryRun: !apply };
  const bindings = await prisma.weComIdentity.findMany({ where: { corpId: config.corpId, user: { status: 'active' } }, select: { id: true, userId: true, externalUserId: true, user: { select: { avatarUrl: true } } } });
  counts.total = bindings.length;
  if (!bindings.length) return counts;
  const json = async (url: string) => { const response = await request(url, { signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error('企业微信头像服务暂不可用'); return await response.json() as Record<string, unknown>; };
  let token: Record<string, unknown>;
  try { token = await json(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`); }
  catch { throw new Error('企业微信凭据暂不可用，未修改任何头像'); }
  if (token.errcode !== 0 || typeof token.access_token !== 'string') throw new Error('企业微信凭据暂不可用，未修改任何头像');
  for (const binding of bindings) {
    if (await prisma.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: { corpId: config.corpId, externalUserId: binding.externalUserId } } })) { counts.skipped++; continue; }
    try {
      const profile = await json(`https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(token.access_token as string)}&userid=${encodeURIComponent(binding.externalUserId)}`);
      if (profile.errcode !== 0) { counts.failed++; continue; }
      const avatarUrl = weComAvatar(profile);
      if (avatarUrl === undefined) { counts.unavailable++; continue; }
      if (avatarUrl === binding.user.avatarUrl) { counts.unchanged++; continue; }
      if (!apply) { counts.updated++; continue; }
      const changed = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(741027)::text`;
        if (await tx.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: { corpId: config.corpId, externalUserId: binding.externalUserId } } })) return 0;
        // 同步期间解绑、停用或另一流程更新头像时，不覆盖较新的结果。
        return (await tx.user.updateMany({ where: { id: binding.userId, status: 'active', avatarUrl: binding.user.avatarUrl, wecomIdentities: { some: { id: binding.id, corpId: config.corpId, externalUserId: binding.externalUserId } } }, data: { avatarUrl } })).count;
      });
      if (changed) counts.updated++; else counts.skipped++;
    } catch { counts.failed++; }
  }
  return counts;
}
