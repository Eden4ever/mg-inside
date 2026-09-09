<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {ConfiguredApplicationShell,PageFrame,PageHeading,PlatformIcon,ApplicationIcon} from '@mg-inside/frontend';
import {ElMessage} from 'element-plus';
import {application} from './main';
import {api,desktop} from './api';
interface Snapshot{collectedAt:string;hostname:string;system:string;cpuCount:number;loadAverage:number[];memoryTotal:number;memoryAvailable:number;diskTotal:number;diskFree:number;dockerAvailable:boolean;containers:Array<{Names:string;Image:string;State:string;Status:string}>;services:Array<{name:string;state:string}>;desktopRelease:string|null;expertRelease:string|null}
interface Resource{id:string;name:string;host:string;poolId:string;provider:string;region:string|null;cloudProduct:string|null;instanceId:string|null;owner?:string;notes?:string;tags?:string[];collecting:boolean;stale:boolean;observation:{snapshot?:Snapshot;attemptedAt:string;error:string|null}|null;deployments:Array<{appId:string;name:string;domain:string;runtime:string;service:string}>}
interface Data{pools:Array<{id:string;name:string;environment:string;description:string}>;resources:Resource[];audit:Array<{id:string;at:string;actor:string;action:string;resourceId:string;success:boolean}>;cloudApiConfigured:boolean}
const route=useRoute(),router=useRouter(),data=ref<Data|null>(null),error=ref(''),loading=ref(false),refreshing=ref(new Set<string>()),selected=ref(''),editor=ref(''),saving=ref(false);
const draft=ref({owner:'',notes:'',tags:'',poolId:''});
const originalDraft=ref('');
const dirty=computed(()=>!!editor.value&&JSON.stringify(draft.value)!==originalDraft.value);
function canLeave(){if(saving.value)return false;if(dirty.value&&!window.confirm('资源资料尚未保存，是否放弃修改？'))return false;editor.value='';return true}
desktop.configure({onClose:canLeave});
watch([dirty,saving],([dirty,busy])=>desktop.setState({dirty,busy}));
const removeGuard=router.beforeEach(()=>canLeave());
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||saving.value){event.preventDefault();event.returnValue=''}}
window.addEventListener('beforeunload',beforeUnload);
function select(r:Resource){if(editor.value&& !canLeave())return;selected.value=selected.value===r.id?'':r.id}
const page=computed(()=>application.pages.find(p=>p.path===route.path)||application.pages[0]);
const resources=computed(()=>data.value?.resources||[]);
const detail=computed(()=>resources.value.find(r=>r.id===selected.value));
const deployments=computed(()=>resources.value.flatMap(r=>r.deployments.map(d=>({...d,resource:r}))));
function bytes(n?:number){if(n===undefined)return '待采集';return `${(n/1024**3).toFixed(1)} GiB`}
function when(v?:string){return v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'尚未采集'}
function status(r:Resource){return !r.observation?'待连接':r.observation.error?'采集失败':r.stale?'数据过期':'已连接'}
function serviceState(r:Resource,name:string){const s=r.observation?.snapshot;if(!s)return '待采集';const c=s.containers.find(c=>c.Names===name);return c?.Status||s.services.find(s=>s.name===name)?.state||'未发现服务'}
let loadController:AbortController|undefined,loadRun=0;
async function load(){const run=++loadRun;loadController?.abort();loadController=new AbortController();loading.value=true;error.value='';try{const value=await api<Data>('/overview',undefined,loadController.signal);if(run===loadRun)data.value=value}catch(e){if(run===loadRun&&!loadController?.signal.aborted)error.value=(e as Error).message}finally{if(run===loadRun)loading.value=false}}
async function refresh(r:Resource){refreshing.value.add(r.id);try{data.value=await api<Data>(`/resources/${r.id}/refresh`,{});const updated=data.value.resources.find(v=>v.id===r.id);if(updated?.observation?.error)ElMessage.warning(updated.observation.error);else ElMessage.success('采集已更新')}catch(e){ElMessage.error((e as Error).message)}finally{refreshing.value.delete(r.id)}}
function edit(r:Resource){if(editor.value&&!canLeave())return;selected.value=r.id;draft.value={owner:r.owner||'',notes:r.notes||'',tags:(r.tags||[]).join('，'),poolId:r.poolId};originalDraft.value=JSON.stringify(draft.value);editor.value=r.id}
async function save(){saving.value=true;try{data.value=await api<Data>(`/resources/${editor.value}/metadata`,{...draft.value,tags:draft.value.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});editor.value='';ElMessage.success('资源资料已保存')}catch(e){ElMessage.error((e as Error).message)}finally{saving.value=false}}
let timer:ReturnType<typeof setInterval>;onMounted(()=>{void load();timer=setInterval(()=>{if(!loading.value&&!editor.value)void load()},60000)});onUnmounted(()=>{loadRun++;loadController?.abort();clearInterval(timer);removeGuard();window.removeEventListener('beforeunload',beforeUnload)});
</script>
<template>
 <ConfiguredApplicationShell :config="application" :assets="{}" :active-path="route.path" :title="page.title" @navigate="router.push($event)">
  <PageFrame><template #header><PageHeading :title="page.title" :description="page.description"><template #actions><el-button :loading="loading" @click="load">刷新视图</el-button></template></PageHeading></template>
  <div class="resource-page">
   <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
   <div v-if="!data && loading" class="empty">正在读取资源…</div>
   <template v-if="data">
    <template v-if="route.path==='/pools'">
     <div class="summary"><div><span>已纳管服务器</span><strong>{{resources.length}}</strong></div><div><span>资源池</span><strong>{{data.pools.length}}</strong></div><div><span>连接正常</span><strong>{{resources.filter(r=>r.observation&&!r.observation.error&&!r.stale).length}}</strong></div><div><span>云账户连接</span><strong class="small">待配置</strong></div></div>
     <div class="pool-grid"><article v-for="pool in data.pools" :key="pool.id" class="pool-card"><div class="pool-heading"><div class="pool-icon"><PlatformIcon name="layout-grid" :size="25"/></div><div><h2>{{pool.name}}</h2><span>生产环境 · {{resources.filter(r=>r.poolId===pool.id).length}} 台服务器</span></div></div><p>{{pool.description}}</p><button v-for="r in resources.filter(r=>r.poolId===pool.id)" :key="r.id" class="pool-server" @click="selected=r.id;router.push('/servers')"><PlatformIcon name="server" :size="21"/><span><b>{{r.name}}</b><small>{{r.host}}</small></span><el-tag :type="status(r)==='已连接'?'success':'info'" size="small">{{status(r)}}</el-tag></button></article></div>
     <div class="notice">SSH 指标来自服务器实时采集。云产品、地域、实例 ID 与到期信息将在腾讯云只读账户接入后补齐。资源池当前用于归属与容量管理，尚未开放应用自动部署。</div>
    </template>
    <template v-else-if="route.path==='/servers'">
     <div class="server-grid"><article v-for="r in resources" :key="r.id" class="server-card" :class="{'is-selected':selected===r.id}"><div class="card-heading"><div><h2>{{r.name}}</h2><span class="muted">{{r.host}} · {{r.provider}}</span></div><el-tag :type="status(r)==='已连接'?'success':r.observation?.error?'warning':'info'">{{status(r)}}</el-tag></div><div class="metrics"><div><small>CPU</small><b>{{r.observation?.snapshot?.cpuCount??'—'}} 核</b></div><div><small>可用内存 / 总内存</small><b>{{bytes(r.observation?.snapshot?.memoryAvailable)}} / {{bytes(r.observation?.snapshot?.memoryTotal)}}</b></div><div><small>可用磁盘 / 总磁盘</small><b>{{bytes(r.observation?.snapshot?.diskFree)}} / {{bytes(r.observation?.snapshot?.diskTotal)}}</b></div></div><p class="muted timestamp">最近成功采集：{{when(r.observation?.snapshot?.collectedAt)}}</p><p v-if="r.observation?.error" class="warning">{{r.observation.error}}，保留最近成功数据。</p><div class="card-actions"><el-button :loading="refreshing.has(r.id)" @click="refresh(r)">立即采集</el-button><el-button @click="select(r)">{{selected===r.id?'收起详情':'查看详情'}}</el-button><el-button text @click="edit(r)">编辑资料</el-button></div></article></div>
     <article v-if="detail" class="detail-card"><h2>{{detail.name}} · 资源详情</h2><dl class="detail-grid"><div><dt>资源池</dt><dd>{{data.pools.find(p=>p.id===detail?.poolId)?.name}}</dd></div><div><dt>负责人</dt><dd>{{detail.owner||'未设置'}}</dd></div><div><dt>标签</dt><dd>{{detail.tags?.join('、')||'未设置'}}</dd></div><div><dt>主机名称</dt><dd>{{detail.observation?.snapshot?.hostname||'待采集'}}</dd></div><div><dt>云产品 / 地域 / 实例 ID</dt><dd>待接入腾讯云只读账户</dd></div><div><dt>系统</dt><dd>{{detail.observation?.snapshot?.system||'待采集'}}</dd></div><div><dt>1 / 5 / 15 分钟负载</dt><dd>{{detail.observation?.snapshot?.loadAverage.map(n=>n.toFixed(2)).join(' / ')||'待采集'}}</dd></div><div><dt>当前发布版本</dt><dd>{{detail.observation?.snapshot?.desktopRelease||detail.observation?.snapshot?.expertRelease||'待采集'}}</dd></div><div><dt>备注</dt><dd>{{detail.notes||'未填写'}}</dd></div></dl><div v-if="editor===detail.id" class="metadata-form"><el-form label-position="top"><el-form-item label="资源池"><el-select v-model="draft.poolId"><el-option v-for="p in data.pools" :key="p.id" :value="p.id" :label="p.name"/></el-select></el-form-item><el-form-item label="负责人"><el-input v-model="draft.owner" maxlength="100"/></el-form-item><el-form-item label="标签（逗号分隔，最多 10 个）"><el-input v-model="draft.tags"/></el-form-item><el-form-item label="备注"><el-input v-model="draft.notes" type="textarea" maxlength="2000" :rows="3"/></el-form-item><el-button type="primary" :loading="saving" @click="save">保存</el-button><el-button @click="canLeave">取消</el-button></el-form></div><div class="runtime-list"><h3>运行服务</h3><div v-for="d in detail.deployments.filter((d,index,items)=>items.findIndex(v=>v.service===d.service)===index)" :key="d.service"><code>{{d.service}}</code><span>{{serviceState(detail,d.service)}}</span></div></div></article>
    </template>
    <div v-else-if="route.path==='/deployments'" class="deployment-list"><article v-for="d in deployments" :key="d.appId" class="deployment-row"><ApplicationIcon :app="{id:d.appId}" style="width:42px;height:42px"/><div class="deployment-name"><h3>{{d.name}}</h3><small>{{d.appId}}</small></div><div><span>{{d.resource.name}}</span><small>{{d.domain}}</small></div><div><span>{{d.runtime}} · {{d.service}}</span><small>{{serviceState(d.resource,d.service)}}</small></div></article><p class="notice">部署关系依据现有生产发布记录登记；运行状态由 SSH 采集核对。关联展示不授予对应业务应用的访问权限。</p></div>
    <div v-else class="audit-list"><div v-if="!data.audit.length" class="empty">暂无采集记录</div><div v-for="event in data.audit" :key="event.id" class="audit-row"><span>{{when(event.at)}}</span><b>{{resources.find(r=>r.id===event.resourceId)?.name}}</b><span>{{event.action==='resource.collect'?'采集指标':'修改资源资料'}}</span><el-tag :type="event.success?'success':'warning'" size="small">{{event.success?'成功':'失败'}}</el-tag><small>{{event.actor==='system'?'系统定时采集':event.actor}}</small></div></div>
   </template>
  </div></PageFrame>
 </ConfiguredApplicationShell>
</template>


