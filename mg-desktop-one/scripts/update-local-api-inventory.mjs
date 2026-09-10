import {readFile,writeFile,readdir} from 'node:fs/promises';
import {openSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawn,execFileSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),kernel=resolve(root,'../mg-platform-kernel'),work=join(root,'.runtime/service-workspace-local');
const jar=resolve(process.argv[2]||'');assert(jar.startsWith(join(root,'.runtime')+sep),'只使用本任务验证过的本地构建');
const processes=JSON.parse(await readFile(join(work,'processes.json'),'utf8'));
assert(Number.isSafeInteger(processes.javaPid));
const running=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${processes.javaPid}"; $port=Get-NetTCPConnection -LocalPort 14380 -State Listen; [pscustomobject]@{name=$p.Name;command=$p.CommandLine;owner=$port.OwningProcess}|ConvertTo-Json -Compress`],{encoding:'utf8'}));
assert.equal(running.name,'java.exe');assert.equal(running.owner,processes.javaPid);assert(running.command.includes('mg-platform-kernel-0.1.0-SNAPSHOT.jar'));
const oldJar=/^-jar /.test(running.command)?running.command.slice(5):running.command.match(/-jar\s+"?([^"\r\n]+\.jar)"?/)?.[1];assert(oldJar,'无法确认原启动包');
const identity=parseEnv(await readFile(join(root,'.runtime/local/identity.env'),'utf8')),desktop=parseEnv(await readFile(join(root,'.runtime/local/desktop.env'),'utf8'));
const database=new URL(identity.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'15439');database.search='';database.pathname='/mg_service_workspace_local';
const jdk=(await readdir(join(kernel,'.runtime/java-tools'))).find(n=>n.startsWith('jdk-25')),java=join(kernel,'.runtime/java-tools',jdk,'bin/java.exe');
const env={...process.env,...desktop,PORT:'14380',HOST:'127.0.0.1',SERVICE_ENVIRONMENT:'local',SERVICE_DATABASE_URL:database.href,DESKTOP_RUNTIME_DIR:join(work,'runtime'),DESKTOP_WEB_DIR:join(root,'dist/web'),SERVICE_DEPLOYMENTS_FILE:''};
async function run(args){const child=spawn(java,['-jar',jar,...args],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',()=>{});const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(code,0,'本地台账迁移失败，未输出连接信息');return output;}
await run(['desktop-applications','schema']);await run(['service-storage','api-inventory-schema']);await run(['service-storage','workspace-schema']);
const registrations=await run(['service-storage','publications-import',join(root,'registrations/api-publications.json')]);
const publicationSummary=registrations.split('\n').map(s=>{try{return JSON.parse(s);}catch{return null;}}).find(s=>s?.services);assert(publicationSummary);
const output=await run(['service-storage','api-inventory-import',join(root,'registrations/api-inventory.json')]);
const summary=output.split('\n').map(s=>{try{return JSON.parse(s);}catch{return null;}}).find(s=>s?.entries);assert(summary);
function start(bundle){const out=openSync(join(work,'java.stdout.log'),'a'),err=openSync(join(work,'java.stderr.log'),'a');const child=spawn(java,['-jar',bundle],{cwd:root,env,detached:true,windowsHide:true,stdio:['ignore',out,err]});child.unref();return child.pid;}
execFileSync('powershell.exe',['-NoProfile','-Command',`Stop-Process -Id ${processes.javaPid} -ErrorAction Stop`]);
const javaPid=start(jar);let ready=false;
for(let i=0;i<200;i++){try{ready=(await fetch('http://127.0.0.1:14380/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}
if(!ready){try{process.kill(javaPid);}catch{}const restored=start(oldJar);await writeFile(join(work,'processes.json'),JSON.stringify({...processes,javaPid:restored},null,2));throw Error('新后端未就绪，已恢复原启动包');}
await writeFile(join(work,'processes.json'),JSON.stringify({...processes,javaPid,jar},null,2));
const result={...summary,publications:publicationSummary,ready:true,url:'http://127.0.0.1:14381/services',backend:'http://127.0.0.1:14380',javaPid,scope:'本地服务中心数据库；未修改生产'};
await writeFile(join(work,'api-inventory-import.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
