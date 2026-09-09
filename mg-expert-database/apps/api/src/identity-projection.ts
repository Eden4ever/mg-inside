import type { Prisma } from '@prisma/client';
import type { DirectoryUser } from './identity-client';

export async function applyIdentityUser(tx: Prisma.TransactionClient, p: DirectoryUser) {
  if(!p.subject||!p.name.trim())throw new Error('中心身份数据无效');
  const issuer=process.env.IDENTITY_ISSUER || 'https://identity.meta-gravity.com';
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('identity-user-projection'))::text`;
  let user=await tx.user.findUnique({where:{identitySubject:p.subject}});
  if(user&&(user.identityIssuer!==issuer||(p.localUserId!==null&&user.id!==p.localUserId)))throw new Error('中心身份与历史账号冲突');
  if(!user&&p.localUserId!==null){
    user=await tx.user.findUnique({where:{id:p.localUserId}});
    if(!user||(user.identitySubject&&user.identitySubject!==p.subject)||(user.identityIssuer&&user.identityIssuer!==issuer))throw new Error('禁止覆盖原账号绑定');
  }
  if(!user&&!p.active)return null;
  if(await tx.user.findFirst({where:{displayName:p.name,...(user?{id:{not:user.id}}:{})}}))throw new Error('存在同名历史账号，请在中心关联原 ID');
  const data={identityIssuer:issuer,identitySubject:p.subject,identityEnabled:p.active,displayName:p.name,departmentName:p.department,status:p.active?'active':'disabled',...(p.username?{username:p.username}:{})};
  if(user)return tx.user.update({where:{id:user.id},data});
  return tx.user.create({data:{...data,username:p.username||null,passwordHash:null,role:'reader',authSource:'sso'}});
}
