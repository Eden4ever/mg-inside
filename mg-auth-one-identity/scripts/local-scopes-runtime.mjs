import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),desktop=resolve(root,'../mg-desktop-one'),kernel=resolve(root,'../mg-platform-kernel');
const require=createRequire(join(desktop,'package.json')), {Client}=require('pg');
const identity=parseEnv(await readFile(join(desktop,'.runtime/local/identity.env'),'utf8'));
const settings=parseEnv(await readFile(join(desktop,'.runtime/local/desktop.env'),'utf8'));
let catalogSettings={};try{catalogSettings=parseEnv(await readFile(join(desktop,'.runtime/local/kernel-catalog.env'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const url=new URL(identity.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15439');assert.equal(url.pathname,'/identity_test');
url.search='';url.pathname='/mg_service_workspace_local';
const work=join(desktop,'.runtime/scopes-runtime');await mkdir(work,{recursive:true});
const jdk=(await readdir(join(kernel,'.runtime/java-tools'))).find(n=>n.startsWith('jdk-25'));
const java=join(kernel,'.runtime/java-tools',jdk,'bin/java.exe'),jar=process.env.DESKTOP_JAR||join(kernel,'.runtime/identity-scopes-final-target/mg-platform-kernel-0.1.0-SNAPSHOT.jar');
const mode=process.argv[2]||'inspect';
const env={...process.env,...settings,...catalogSettings,HOST:'127.0.0.1',PORT:mode==='activate'?'4300':'4302',SERVICE_DATABASE_URL:url.href,SERVICE_ENVIRONMENT:'local',DESKTOP_RUNTIME_DIR:join(desktop,'.runtime'),DESKTOP_WEB_DIR:join(desktop,'dist/web'),SERVICE_DEPLOYMENTS_FILE:''};
function background(command,args,environment,name,cwd){const out=openSync(join(work,name+'.stdout.log'),'a'),err=openSync(join(work,name+'.stderr.log'),'a');try{const p=spawn(command,args,{cwd,env:environment,detached:true,windowsHide:true,stdio:['ignore',out,err]});p.unref();return p.pid;}finally{closeSync(out);closeSync(err);}}
if(mode==='identity') {const runtime=process.env.IDENTITY_RUNTIME_ROOT||root;console.log(JSON.stringify({identityPid:background(process.execPath,[join(runtime,'dist/main.js')],{...process.env,...identity,...catalogSettings},'identity',root)}));}
else if(mode==='configure') {
 const values={DESKTOP_JAR:jar,SERVICE_DATABASE_URL:url.href,SERVICE_ENVIRONMENT:'local',DESKTOP_RUNTIME_DIR:join(desktop,'.runtime'),DESKTOP_WEB_DIR:join(desktop,'dist/web'),SERVICE_DEPLOYMENTS_FILE:''};
 await writeFile(join(desktop,'.runtime/local/desktop-runtime.env'),Object.entries(values).map(([key,value])=>key+'='+JSON.stringify(value.replaceAll('\\','/'))).join('\n')+'\n');
 console.log('本机桌面运行配置已保存。');
}
else {
 if(['schema','stage'].includes(mode))execFileSync(java,['-jar',jar,'desktop-applications','schema'],{cwd:desktop,env,windowsHide:true,stdio:'pipe'});
 const db=new Client({connectionString:url.href});try{await db.connect();
  const before=(await db.query("SELECT * FROM desktop_applications WHERE id='identity'")).rows[0];assert(before);
  console.log(JSON.stringify({entry:before.entry_url,role:before.required_role,paths:before.allowed_paths,policy:before.runtime_policy}));
  if(mode==='inspect')console.log(JSON.stringify((await db.query("SELECT manifest FROM service_publications WHERE service_id LIKE 'identity.management%'")).rows.map(r=>r.manifest)));
  if(mode==='stage'){
   assert.equal(before.entry_url,'http://127.0.0.1:14200');assert.equal(before.upstream_url,'http://127.0.0.1:14200/api');
   const paths=[...new Set([...before.allowed_paths,'/divisions','/organizations','/scopes'])];
   const policy={...before.runtime_policy,rolePath:'/auth/me',rolePointer:'/user/managementRole'};
   if(before.required_role!=='identity-manager'||JSON.stringify(paths)!==JSON.stringify(before.allowed_paths)||JSON.stringify(policy)!==JSON.stringify(before.runtime_policy)) {
   await db.query('BEGIN');
   try{
    const after=(await db.query("UPDATE desktop_applications SET required_role='identity-manager',allowed_paths=$1::jsonb,runtime_policy=$2::jsonb,revision=revision+1,updated_at=now() WHERE id='identity' RETURNING *",[JSON.stringify(paths),JSON.stringify(policy)])).rows[0];
    await db.query("INSERT INTO desktop_application_audit(application_id,action,before_config,after_config,actor) VALUES('identity','update',$1::jsonb,$2::jsonb,'local:scoped-identity')",[JSON.stringify(before),JSON.stringify(after)]);
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK');throw e;}
   }
  }
 }finally{await db.end();}
 if(['stage','activate'].includes(mode))console.log(JSON.stringify({port:env.PORT,pid:background(java,['-jar',jar],env,'desktop-'+env.PORT,desktop)}));
}
