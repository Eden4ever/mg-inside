import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const execute = promisify(execFile);
export class ResourceError extends Error { constructor(public status:number, message:string){super(message)} }
export interface Snapshot {schemaVersion:number;collectedAt:string;hostname:string;system:string;cpuCount:number;loadAverage:number[];memoryTotal:number;memoryAvailable:number;diskTotal:number;diskFree:number;dockerAvailable:boolean;containers:Array<{Names:string;Image:string;State:string;Status:string}>;services:Array<{name:string;state:string}>;desktopRelease:string|null;expertRelease:string|null}
export interface Resource {id:string;name:string;host:string;poolId:string;credential:string;provider:string;cloudProduct:null;region:null;instanceId:null;deployments:Array<{appId:string;name:string;domain:string;runtime:string;service:string}>}
interface Metadata {owner:string;notes:string;tags:string[];poolId:string}
interface State {metadata:Record<string,Metadata>;observations:Record<string,{snapshot?:Snapshot;attemptedAt:string;error:string|null}>;audit:Array<{id:string;at:string;actor:string;action:string;resourceId:string;success:boolean}>}
export function parseSnapshot(raw:string):Snapshot {
  let x:any;try{x=JSON.parse(raw)}catch{throw new ResourceError(502,'采集器响应格式无效')}
  const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  if(x?.schemaVersion!==1||typeof x.hostname!=='string'||typeof x.system!=='string'||!Number.isFinite(Date.parse(x.collectedAt))||Math.abs(Date.now()-Date.parse(x.collectedAt))>300000||!['cpuCount','memoryTotal','memoryAvailable','diskTotal','diskFree'].every(k=>number(x[k]))||!Array.isArray(x.loadAverage)||x.loadAverage.length!==3||!x.loadAverage.every(number)||!Array.isArray(x.containers)||x.containers.length>500||!x.containers.every((c:any)=>['Names','Image','State','Status'].every(k=>typeof c[k]==='string'&&c[k].length<1024))||!Array.isArray(x.services)||!x.services.every((s:any)=>typeof s.name==='string'&&typeof s.state==='string'))throw new ResourceError(502,'采集器指标校验失败');
  return x;
}
export class ResourceStore {
  state:State={metadata:{},observations:{},audit:[]}; resources:Resource[]=[]; pools:Array<{id:string;name:string;environment:string;description:string}>=[];
  private queue=Promise.resolve(); private running=new Map<string,Promise<void>>();
  constructor(public dir:string,public credentials:string,private collect?:(r:Resource)=>Promise<Snapshot>){}
  async initialize(configPath:string){const input=JSON.parse(await readFile(configPath,'utf8'));this.resources=input.resources;this.pools=input.pools;await mkdir(this.dir,{recursive:true,mode:0o700});try{this.state=JSON.parse(await readFile(join(this.dir,'state.json'),'utf8'))}catch(e:any){if(e.code!=='ENOENT')throw e}}
  private async transaction(fn:()=>void){const job=this.queue.then(async()=>{const before=structuredClone(this.state);try{fn();const temp=join(this.dir,`state-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(this.state),{mode:0o600});await rename(temp,join(this.dir,'state.json'))}catch(e){this.state=before;throw e}});this.queue=job.catch(()=>{});return job}
  get(id:string){const r=this.resources.find(r=>r.id===id);if(!r)throw new ResourceError(404,'资源不存在');return r}
  overview(){return {pools:this.pools,resources:this.resources.map(({credential,...r})=>{const o=this.state.observations[r.id];return {...r,...this.state.metadata[r.id],observation:o||null,collecting:this.running.has(r.id),stale:!o?.snapshot||Date.now()-Date.parse(o.snapshot.collectedAt)>300000}}),audit:this.state.audit.slice(-100).reverse(),cloudApiConfigured:false}}
  async update(id:string,input:any,actor:string){this.get(id);if(!input||typeof input!=='object'||typeof input.owner!=='string'||input.owner.length>100||typeof input.notes!=='string'||input.notes.length>2000||!Array.isArray(input.tags)||input.tags.length>10||!input.tags.every((t:any)=>typeof t==='string'&&t.length<=30)||!this.pools.some(p=>p.id===input.poolId))throw new ResourceError(400,'资源备注或资源池配置无效');await this.transaction(()=>{this.state.metadata[id]={owner:input.owner.trim(),notes:input.notes.trim(),tags:[...new Set(input.tags.map((t:string)=>t.trim()).filter(Boolean))] as string[],poolId:input.poolId};this.audit(actor,'metadata.update',id,true)})}
  private audit(actor:string,action:string,resourceId:string,success:boolean){this.state.audit.push({id:randomUUID(),at:new Date().toISOString(),actor,action,resourceId,success});this.state.audit=this.state.audit.slice(-1000)}
  async refresh(id:string,actor:string){this.get(id);if(this.running.has(id))return this.running.get(id)!;const job=this.doRefresh(id,actor).finally(()=>this.running.delete(id));this.running.set(id,job);return job}
  private async doRefresh(id:string,actor:string){const resource=this.get(id);let snapshot:Snapshot|undefined,error:string|null=null;try{snapshot=this.collect?await this.collect(resource):await this.ssh(resource)}catch(e:any){error=e instanceof ResourceError?e.message:'SSH 采集失败：请检查连接凭据、主机指纹和服务器可达性'}await this.transaction(()=>{this.state.observations[id]={snapshot:snapshot||this.state.observations[id]?.snapshot,attemptedAt:new Date().toISOString(),error};this.audit(actor,'resource.collect',id,!error)})}
  private async ssh(resource:Resource){if(!/^[a-z]+$/.test(resource.credential)||!/^\d{1,3}(\.\d{1,3}){3}$/.test(resource.host))throw new ResourceError(500,'采集目标配置无效');const {stdout}=await execute(process.env.RESOURCE_SSH_BINARY||'ssh',['-F','none','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${join(this.credentials,'known_hosts')}`,'-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','ClearAllForwardings=yes','-i',join(this.credentials,resource.credential),`mg-resource@${resource.host}`,'collect'],{timeout:25000,maxBuffer:1024*1024,windowsHide:true});return parseSnapshot(stdout)}
}
