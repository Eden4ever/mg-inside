import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalJson} from '../../../../mg-platform/packages/frontend/services/openapi';
import type {RegistryPersistence,RegistryState} from './service-storage';
import {validateServiceEnvironment,ServiceStorageUnavailable} from './service-postgres';

export function withServiceSnapshot(database:RegistryPersistence,dir:string,environment:string,validate:(state:RegistryState)=>RegistryState){
 validateServiceEnvironment(environment);
 const filename=join(dir,`postgres-snapshot-${environment}.json`);
 let current:RegistryState|undefined,lastAttempt=0,checkedAt:string|null=null,persistedAt:string|null=null,stale=false,lastDigest='';
 const digest=(state:RegistryState)=>createHash('sha256').update(canonicalJson(state)).digest('hex');
 async function remember(state:RegistryState){
  current=structuredClone(state);stale=false;checkedAt=new Date().toISOString();lastAttempt=Date.now();
  const hash=digest(state);if(hash===lastDigest)return;
  const temp=filename+'.'+randomUUID()+'.tmp';
  try{await mkdir(dir,{recursive:true});await writeFile(temp,JSON.stringify({schemaVersion:1,environment,digest:hash,at:checkedAt,state}),{flag:'wx',mode:0o600});await rename(temp,filename);persistedAt=checkedAt;lastDigest=hash;}
  catch{await rm(temp,{force:true}).catch(()=>{});console.error('服务路由快照持久化失败；数据库提交仍有效');}
 }
 const storage:RegistryPersistence={
  async read(options){
   if(options?.allowCache&&current&&Date.now()-lastAttempt<1000)return structuredClone(current);
   lastAttempt=Date.now();
   try{const state=validate(await database.read());await remember(state);return state;}
   catch(error){
    stale=true;if(!options?.allowCache)throw error;
    if(current)return structuredClone(current);
    try{const saved=JSON.parse(await readFile(filename,'utf8'));if(saved.schemaVersion!==1||saved.environment!==environment||digest(saved.state)!==saved.digest)throw Error('快照校验失败');current=validate(saved.state);persistedAt=saved.at;checkedAt=saved.at;lastDigest=saved.digest;return structuredClone(current!);}
    catch{throw error;}
   }
  },
  async transaction(change){try{const result=await database.transaction(change);await remember(result.state);return result;}catch(error){if(error instanceof ServiceStorageUnavailable){stale=true;lastAttempt=Date.now();}throw error;}},
  close:()=>database.close(),
 };
 return {storage,status:()=>({backend:'postgresql' as const,environment,stale,checkedAt,snapshotPersistedAt:persistedAt})};
}
