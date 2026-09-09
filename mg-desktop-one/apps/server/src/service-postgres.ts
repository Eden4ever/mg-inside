import {Pool,type PoolClient} from 'pg';
import {canonicalJson} from '../../../../mg-platform/packages/frontend/services/openapi';
import type {RegistryState,RegistryPersistence,RegistryTransactionContext} from './service-storage';

// 由迁移账号执行，运行账号只有这些表的数据权限，没有建表/建库权限。
export const serviceSchemaSql=`
CREATE TABLE IF NOT EXISTS service_schema (id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL CHECK(version=1));
INSERT INTO service_schema VALUES(1,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS service_environments (
 name text PRIMARY KEY CHECK(name ~ '^[a-z][a-z0-9-]{1,31}$'),
 generation bigint NOT NULL DEFAULT 0, imported_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_publications (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 service_id text NOT NULL, version text NOT NULL, app_id text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 contract_digest text CHECK(contract_digest ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL, contract jsonb, published_at text NOT NULL, actor text NOT NULL,
 PRIMARY KEY(service_id,version),
 CHECK(manifest->>'serviceId'=service_id AND manifest->>'version'=version AND manifest->>'appId'=app_id),
 CHECK((contract IS NULL)=(contract_digest IS NULL))
);
CREATE TABLE IF NOT EXISTS service_bindings (
 environment text NOT NULL REFERENCES service_environments(name),
 service_id text NOT NULL, version text, revision integer NOT NULL CHECK(revision>=0),
 PRIMARY KEY(environment,service_id),
 FOREIGN KEY(service_id,version) REFERENCES service_publications(service_id,version)
);
CREATE TABLE IF NOT EXISTS service_audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id text NOT NULL, environment text NOT NULL REFERENCES service_environments(name),
 event jsonb NOT NULL, PRIMARY KEY(environment,id)
);
CREATE INDEX IF NOT EXISTS service_audit_environment ON service_audit(environment,sequence DESC);
CREATE TABLE IF NOT EXISTS service_activity (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id text NOT NULL, environment text NOT NULL REFERENCES service_environments(name),
 event jsonb NOT NULL, PRIMARY KEY(environment,id)
);
CREATE INDEX IF NOT EXISTS service_activity_environment ON service_activity(environment,sequence DESC);
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS endpoint_ref text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS deployment_id text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS deployment_digest text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS manifest_digest text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS contract_digest text;
CREATE TABLE IF NOT EXISTS service_version_lifecycles (
 service_id text NOT NULL,version text NOT NULL,value jsonb NOT NULL,
 PRIMARY KEY(service_id,version),
 FOREIGN KEY(service_id,version) REFERENCES service_publications(service_id,version),
 CHECK(value->>'status' IN ('draft','published','deprecated','retired'))
);
`;

export function validateServiceEnvironment(environment:string){if(!/^[a-z][a-z0-9-]{1,31}$/.test(environment))throw Error('服务运行环境标识无效');return environment;}
export class ServiceStorageUnavailable extends Error {constructor(){super('服务目录数据库暂不可用，请稍后重试');}}

export function servicePool(connectionString:string) {
 const pool=new Pool({connectionString,max:4,connectionTimeoutMillis:2000,idleTimeoutMillis:10000,statement_timeout:5000,application_name:'mg-service-registry'});
 // 驱动错误可能包含连接细节，不向日志或调用方透传。
 pool.on('error',()=>{});pool.on('connect',client=>client.on('error',()=>{}));return pool;
}

async function readState(client:PoolClient,environment:string):Promise<RegistryState> {
 // 一个查询取得一致的 MVCC 快照，避免版本/绑定来自不同提交。
 const result=await client.query(`SELECT
  (SELECT jsonb_agg(jsonb_build_object('manifest',manifest,'digest',digest,'at',published_at,'actor',actor) || CASE WHEN contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('contract',contract,'contractDigest',contract_digest) END ORDER BY sequence) FROM service_publications) AS publications,
  (SELECT jsonb_object_agg(service_id,version) FROM service_bindings WHERE environment=$1) AS active,
  (SELECT jsonb_object_agg(service_id,revision) FROM service_bindings WHERE environment=$1 AND revision<>0) AS revisions,
  (SELECT jsonb_object_agg(service_id,jsonb_build_object('environment',environment,'endpointRef',endpoint_ref,'deploymentId',deployment_id,'deploymentDigest',deployment_digest,'manifestDigest',manifest_digest,'contractDigest',contract_digest)) FROM service_bindings WHERE environment=$1 AND endpoint_ref IS NOT NULL) AS bindings,
  (SELECT jsonb_object_agg(service_id||'@'||version,value) FROM service_version_lifecycles) AS lifecycles,
  (SELECT jsonb_agg(event ORDER BY sequence) FROM (SELECT event,sequence FROM service_audit WHERE environment=$1 OR event->>'action'='lifecycle' ORDER BY sequence DESC LIMIT 500) events) AS audit,
  (SELECT jsonb_agg(event ORDER BY sequence) FROM (SELECT event,sequence FROM service_activity WHERE environment=$1 ORDER BY sequence DESC LIMIT 300) events) AS activity
  FROM service_environments WHERE name=$1`,[environment]);
 if(!result.rowCount)throw Error('服务运行环境尚未迁移');
 const row=result.rows[0];return {schemaVersion:1,publications:row.publications||[],active:row.active||{},revisions:row.revisions||{},...(row.bindings?{bindings:row.bindings}:{}),...(row.lifecycles?{lifecycles:row.lifecycles}:{}),audit:row.audit||[],activity:row.activity||[]};
}

async function insertChanges(client:PoolClient,environment:string,before:RegistryState,after:RegistryState){
 const publications=new Map(before.publications.map(p=>[p.manifest.serviceId+'@'+p.manifest.version,p]));
 for(const p of after.publications){
  const old=publications.get(p.manifest.serviceId+'@'+p.manifest.version);
  if(old){if(old.digest!==p.digest||old.contractDigest!==p.contractDigest)throw Error('不可覆盖已登记版本');continue;}
  await client.query('INSERT INTO service_publications(service_id,version,app_id,digest,contract_digest,manifest,contract,published_at,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[p.manifest.serviceId,p.manifest.version,p.manifest.appId,p.digest,p.contractDigest||null,JSON.stringify(p.manifest),p.contract?JSON.stringify(p.contract):null,p.at,p.actor]);
 }
 for(const [serviceId,version] of Object.entries(after.active)){
  const revision=after.revisions?.[serviceId]||0;
  const binding=after.bindings?.[serviceId];
  if(Object.hasOwn(before.active,serviceId)&&before.active[serviceId]===version&&(before.revisions?.[serviceId]||0)===revision&&JSON.stringify(before.bindings?.[serviceId])===JSON.stringify(binding))continue;
  await client.query('INSERT INTO service_bindings(environment,service_id,version,revision,endpoint_ref,deployment_id,deployment_digest,manifest_digest,contract_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(environment,service_id) DO UPDATE SET version=EXCLUDED.version,revision=EXCLUDED.revision,endpoint_ref=EXCLUDED.endpoint_ref,deployment_id=EXCLUDED.deployment_id,deployment_digest=EXCLUDED.deployment_digest,manifest_digest=EXCLUDED.manifest_digest,contract_digest=EXCLUDED.contract_digest',[environment,serviceId,version,revision,binding?.endpointRef||null,binding?.deploymentId||null,binding?.deploymentDigest||null,binding?.manifestDigest||null,binding?.contractDigest||null]);
 }
 for(const [key,value] of Object.entries(after.lifecycles||{})){
  if(JSON.stringify(before.lifecycles?.[key])===JSON.stringify(value))continue;
  const split=key.lastIndexOf('@');
  await client.query('INSERT INTO service_version_lifecycles(service_id,version,value) VALUES($1,$2,$3) ON CONFLICT(service_id,version) DO UPDATE SET value=EXCLUDED.value',[key.slice(0,split),key.slice(split+1),JSON.stringify(value)]);
 }
 for(const [table,key] of [['service_audit','audit'],['service_activity','activity']] as const){
  const previous=new Set(before[key].map(event=>event.id));
  for(const event of after[key])if(!previous.has(event.id))await client.query(`INSERT INTO ${table}(id,environment,event) VALUES($1,$2,$3) ON CONFLICT(environment,id) DO NOTHING`,[event.id,environment,JSON.stringify(event)]);
 }
}

export function createPostgresServiceStorage(pool:Pool,environment:string):RegistryPersistence {
 validateServiceEnvironment(environment);
 return {
  async read(){const client=await pool.connect().catch(()=>{throw new ServiceStorageUnavailable();});try{return await readState(client,environment);}catch{throw new ServiceStorageUnavailable();}finally{client.release();}},
  async transaction<T>(change:(state:RegistryState,context?:RegistryTransactionContext)=>{state:RegistryState;value:T}|Promise<{state:RegistryState;value:T}>){
   const client=await pool.connect().catch(()=>{throw new ServiceStorageUnavailable();});let businessError=false;
   try {
    await client.query('BEGIN');
    // 锁覆盖跨环境共享的不可变版本和路由检查；所有语句使用同一连接。
    await client.query('SELECT pg_advisory_xact_lock(741029)');
    const before=await readState(client,environment);let result:{state:RegistryState;value:T};
    const usage=await client.query('SELECT environment,service_id AS "serviceId",version FROM service_bindings WHERE version IS NOT NULL');
    try{result=await change(structuredClone(before),{environment,activeBindings:usage.rows});}catch(error){businessError=true;throw error;}
    await insertChanges(client,environment,before,result.state);
    await client.query('UPDATE service_environments SET generation=generation+1 WHERE name=$1',[environment]);
    await client.query('COMMIT');return result;
   }catch(error){await client.query('ROLLBACK').catch(()=>{});if(businessError)throw error;throw new ServiceStorageUnavailable();}
   finally{client.release();}
  },
  async close(){await pool.end();},
 };
}

// 只导入空环境；已有数据必须先核对摘要。迁移不会覆盖目标库的新写入。
export async function importServiceState(pool:Pool,environment:string,state:RegistryState,digest:string){
 validateServiceEnvironment(environment);if(!/^[a-f0-9]{64}$/.test(digest))throw Error('迁移摘要无效');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(741029)');
  const existing=await client.query('SELECT imported_digest FROM service_environments WHERE name=$1',[environment]);
  if(existing.rowCount){if(existing.rows[0].imported_digest!==digest)throw Error('目标环境已有不同来源数据，拒绝覆盖');await client.query('COMMIT');return {duplicate:true};}
  await client.query('INSERT INTO service_environments(name,imported_digest) VALUES($1,$2)',[environment,digest]);
  // 公共版本可由另一环境先行导入；只有完全一致的不可变版本允许复用。
  const previous=await readState(client,environment);
  for(const [key,value] of Object.entries(state.lifecycles||{}))if(previous.lifecycles?.[key]&&canonicalJson(previous.lifecycles[key])!==canonicalJson(value))throw Error('其他环境已有不同生命周期，拒绝覆盖');
  for(const [serviceId,version] of Object.entries(state.active))if(version){
   const key=serviceId+'@'+version,existing=previous.lifecycles?.[key],status=state.lifecycles?.[key]?.status||existing?.status;
   if(status==='retired'||status==='draft'||existing?.status==='deprecated')throw Error('导入会重新绑定已弃用、退役或未发布版本，拒绝旧快照恢复');
  }
  await insertChanges(client,environment,previous,state);await client.query('COMMIT');return {duplicate:false};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
