import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {openSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import pg from 'pg';

const root=resolve(import.meta.dirname,'..'),kernel=resolve(root,'../mg-platform-kernel'),frontend=resolve(root,'../mg-service-one');
const work=join(root,'.runtime/service-workspace-local');await mkdir(work,{recursive:true});
const identity=parseEnv(await readFile(join(root,'.runtime/local/identity.env'),'utf8')),desktop=parseEnv(await readFile(join(root,'.runtime/local/desktop.env'),'utf8'));
const connection=new URL(identity.DATABASE_URL);
if(connection.hostname!=='127.0.0.1'||connection.port!=='15439'||connection.searchParams.get('schema')!=='mg_desktop_local_identity')throw Error('需要现有隔离本地身份数据库');
for(const port of [14380,14381]){try{await fetch('http://127.0.0.1:'+port,{signal:AbortSignal.timeout(500)});throw Error('端口已占用：'+port);}catch(error){if(error.message.startsWith('端口'))throw error;}}
connection.search='';connection.pathname='/postgres';const admin=new pg.Client({connectionString:connection.href});await admin.connect();
const database='mg_service_workspace_local';let created=false;
try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount){await admin.query('CREATE DATABASE '+database);created=true;}}finally{await admin.end();}
connection.pathname='/'+database;
const jar=process.env.SERVICE_KERNEL_JAR||join(kernel,'.runtime/service-workspace-target/mg-platform-kernel-0.1.0-SNAPSHOT.jar');
const jdk=(await readdir(join(kernel,'.runtime/java-tools'))).find(name=>name.startsWith('jdk-25'));const java=join(kernel,'.runtime/java-tools',jdk,'bin/java.exe');
const env={...process.env,...desktop,PORT:'14380',HOST:'127.0.0.1',SERVICE_ENVIRONMENT:'local',SERVICE_DATABASE_URL:connection.href,DESKTOP_RUNTIME_DIR:join(work,'runtime'),DESKTOP_WEB_DIR:join(root,'dist/web'),SERVICE_DEPLOYMENTS_FILE:''};
async function run(args){const p=spawn(java,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',d=>output=(output+d).slice(-6000));p.stderr.on('data',d=>output=(output+d).slice(-6000));const code=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});if(code!==0)throw Error('本地迁移失败：'+output);}
if(created){const applications=JSON.parse(await readFile(join(root,'.runtime/local/application-migration.json'),'utf8'));const file=join(work,'applications.json');await writeFile(file,JSON.stringify({schemaVersion:1,applications}));await run(['-jar',jar,'desktop-applications','migrate',file]);await run(['-jar',jar,'service-storage','migrate',join(root,'.runtime/services/registry.json')]);}
await run(['-jar',jar,'service-storage','workspace-schema']);
function background(command,args,cwd,environment,name){const out=openSync(join(work,name+'.stdout.log'),'a'),err=openSync(join(work,name+'.stderr.log'),'a');const p=spawn(command,args,{cwd,env:environment,detached:true,windowsHide:true,stdio:['ignore',out,err]});p.unref();return p.pid;}
const javaPid=background(java,['-jar',jar],root,env,'java');
const vitePid=background(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','14381','--strictPort'],frontend,{...process.env,VITE_SERVICE_API_ORIGIN:'http://127.0.0.1:14380'},'service');
await writeFile(join(work,'processes.json'),JSON.stringify({javaPid,vitePid,url:'http://127.0.0.1:14381/services',backend:'http://127.0.0.1:14380'},null,2));
let ready=false;for(let i=0;i<200;i++){try{ready=(await fetch('http://127.0.0.1:14380/api/health')).ok&&(await fetch('http://127.0.0.1:14381/services')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('服务尚未就绪，请检查 .runtime/service-workspace-local 日志');
console.log(JSON.stringify({ready:true,javaPid,vitePid,url:'http://127.0.0.1:14381/services',database:'独立本地数据库，复用现有本地身份登录'},null,2));
