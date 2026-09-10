import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

export type KernelApplication = { id: string; name: string; enabled: boolean; description: string; developer: string; registeredVersion: string; runtimeReady: boolean; entryUrl: string; kind: string };

/** 应用定义只读内核；本地表仅保存授权外键，不保存名称或启用状态。 */
export async function kernelApplications(): Promise<KernelApplication[]> {
  try {
    const url=new URL(process.env.APPLICATION_REGISTRY_URL || '');
    if(url.username || url.password || url.search || url.hash || !(url.protocol==='https:' || url.protocol==='http:' && ['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname)))throw new Error();
    const key=process.env.APPLICATION_REGISTRY_KEY || '';
    if(key.length<32)throw new Error();
    const response=await fetch(url,{headers:{'X-Application-Registry-Key':key},signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)throw new Error();
    const data=await response.json() as {applications?: KernelApplication[]};
    if(!Array.isArray(data.applications) || data.applications.some(a=>!a || typeof a.id!=='string' || !/^[a-z][a-z0-9-]{1,63}$/.test(a.id) || typeof a.name!=='string' || typeof a.enabled!=='boolean') || new Set(data.applications.map(a=>a.id)).size!==data.applications.length)throw new Error();
    return data.applications;
  }catch{throw new ServiceUnavailableException('内核应用目录暂不可用');}
}
export async function kernelApplication(clientId: string) { return (await kernelApplications()).find(a=>a.id===clientId); }
export async function applicationReference(db: PrismaClient | Prisma.TransactionClient, clientId: string) {
  const app=await kernelApplication(clientId);
  if(!app)throw new ConflictException('应用未在内核注册');
  await db.application.upsert({where:{clientId},create:{clientId},update:{}});
  return app;
}
