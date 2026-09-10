import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
const identity=parseEnv(await readFile('.runtime/local/identity.env','utf8'));
const desktop=parseEnv(await readFile('.runtime/local/desktop-runtime.env','utf8'));
const identityUrl=new URL(identity.DATABASE_URL),kernelUrl=new URL(desktop.SERVICE_DATABASE_URL);
assert.equal(identityUrl.hostname,'127.0.0.1');assert.equal(kernelUrl.hostname,'127.0.0.1');
assert.equal(identityUrl.searchParams.get('schema'),'mg_desktop_local_identity');
identityUrl.search='';
const auth=new pg.Client({connectionString:identityUrl.href}),core=new pg.Client({connectionString:kernelUrl.href});
await auth.connect();await core.connect();
try {
 await auth.query('SET search_path TO mg_desktop_local_identity');
 const migrated=(await auth.query("SELECT to_regclass('\"ApplicationReference\"') AS name")).rows[0].name;
 if(migrated){console.log('应用引用已迁移。');process.exitCode=0;}
 else {
  const apps=(await auth.query('SELECT * FROM "Application" ORDER BY "clientId"')).rows;
  await mkdir('.runtime/kernel-catalog',{recursive:true});
  await writeFile('.runtime/kernel-catalog/identity-applications-before.json',JSON.stringify(apps,null,2),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  await core.query('BEGIN');
  try {
   for(const app of apps) {
    const existing=(await core.query('SELECT * FROM desktop_applications WHERE id=$1',[app.clientId])).rows[0];
    if(!existing) {
     const after=(await core.query(`INSERT INTO desktop_applications(id,name,description,developer,entry_url,upstream_url,default_path,allowed_paths,allowed_api_paths,icon,kind,runtime_ready,enabled)
      VALUES($1,$2,'','郑州元引信息科技有限公司','','','/','["/"]','[]','knowledge','internal',false,$3) RETURNING *`,[app.clientId,app.name,app.enabled])).rows[0];
     await core.query("INSERT INTO desktop_application_audit(application_id,action,after_config,actor) VALUES($1,'create',$2::jsonb,'migration:kernel-catalog')",[app.clientId,JSON.stringify(after)]);
    }else if(existing.enabled && !app.enabled) {
     const after=(await core.query('UPDATE desktop_applications SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[app.clientId])).rows[0];
     await core.query("INSERT INTO desktop_application_audit(application_id,action,before_config,after_config,actor) VALUES($1,'disable',$2::jsonb,$3::jsonb,'migration:kernel-catalog')",[app.clientId,JSON.stringify(existing),JSON.stringify(after)]);
    }
   }
   await core.query('COMMIT');
  }catch(e){await core.query('ROLLBACK');throw e;}
  console.log('内核已包含原身份目录的 '+apps.length+' 个应用，未增加任何用户授权。');
  if(process.argv.includes('--finalize')) {
   const all=new Set((await core.query('SELECT id FROM desktop_applications')).rows.map(a=>a.id));assert(apps.every(a=>all.has(a.clientId)));
   const snapshot=async()=>{
    const result={};for(const table of ['ApplicationUser','RoleApplication','ScopeApplication','ScopeGrant'])result[table]=(await auth.query('SELECT to_jsonb(t) AS row FROM "'+table+'" t ORDER BY to_jsonb(t)::text')).rows;
    return result;
   };
   await auth.query('BEGIN');
   try {
    await auth.query('SELECT pg_advisory_xact_lock(741028)');const before=await snapshot();
    await auth.query(await readFile('../mg-auth-one-identity/prisma/migrations/20260910100000_kernel_application_reference/migration.sql','utf8'));
    assert.deepEqual(await snapshot(),before);await auth.query('COMMIT');console.log('本地应用定义已移除，全部授权关系逐项校验一致。');
   }catch(e){await auth.query('ROLLBACK');throw e;}
  }
 }
 const path='.runtime/local/kernel-catalog.env';
 let key;try{key=parseEnv(await readFile(path,'utf8')).APPLICATION_REGISTRY_KEY;}catch{}
 key ||= randomBytes(32).toString('hex');
 await writeFile(path,'APPLICATION_REGISTRY_KEY='+key+'\nAPPLICATION_REGISTRY_URL=http://127.0.0.1:4300/internal/applications\n');
}finally{await auth.end();await core.end();}
