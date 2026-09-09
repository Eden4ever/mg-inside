<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConfiguredApplicationShell, PlatformIcon, PageFrame, PageHeading, ContentPanel, loadApplicationConfig, applyApplicationDocument } from '@mg-inside/frontend';
import input from '../application.json';
import { api, desktop, type OfficeFile, type OfficeDocument, type EditorSession } from './api';
import { SaveState } from './save-state';
import {ElMessageBox} from 'element-plus';
import {createOfficeLeaveGuard} from './leave-guard';
const config=loadApplicationConfig(input,{components:['documents']});
const route=useRoute(),router=useRouter();
const documents=ref<OfficeDocument[]>([]),search=ref(''),error=ref(''),loading=ref(false),ready=ref(false),saving=ref(false),savedAt=ref('');
const saveState=reactive(new SaveState()),dirty=computed(()=>saveState.dirty);
const current=ref<EditorSession>();
const creating=ref(false);
const documentView=ref<'all'|'recent'>('all');
async function create(format:string){if(creating.value)return;creating.value=true;error.value='';try{const file=await api<OfficeFile>('/documents',{format});creating.value=false;await router.push(`/documents/${file.id}`)}catch(e){error.value=(e as Error).message}finally{creating.value=false}}
let editor:any, generation=0, poll:ReturnType<typeof setInterval>|undefined;
type SaveStatus={savedAt?:string;error?:string;closed?:boolean;savedRequests:string[]};
const shown=computed(()=>documents.value.filter(d=>d.name.toLowerCase().includes(search.value.toLowerCase())));
const status=computed(()=>saving.value?'正在保存到文件…':dirty.value?'有未保存修改':savedAt.value?'已保存到文件':current.value?.mode==='view'?'只读预览':'文档已打开');
function format(name:string){const ext=name.split('.').at(-1)?.toLowerCase();return ext?.startsWith('xls')?'sheet':ext?.startsWith('ppt')?'slides':'word'}
const canLeave=createOfficeLeaveGuard(()=>({dirty:dirty.value,busy:saving.value||creating.value}),()=>ElMessageBox.confirm('修改尚未确认保存到文件。离开后，未保存的内容可能丢失。','未保存的文档',{confirmButtonText:'放弃修改并离开',cancelButtonText:'继续编辑',type:'warning',autofocus:false}).then(()=>true).catch(()=>false));
desktop.configure({onClose:canLeave,onNavigate:async path=>{await router.push(path)}});
watch(()=>route.fullPath,path=>desktop.routeChanged(path),{immediate:true});
watch(()=>[current.value?.file.name,route.params.id],()=>applyApplicationDocument(config,{},current.value?.file.name||(route.params.id?'打开文档':config.pages[0].title)),{immediate:true});
watch([dirty,saving,creating], ([dirty,saving,creating])=>desktop.setState({dirty,busy:saving||creating}));
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||saving.value||creating.value){event.preventDefault();event.returnValue=''}}
window.addEventListener('beforeunload',beforeUnload);
const removeGuard=router.beforeEach(()=>canLeave());
function dispose(){clearInterval(poll);poll=undefined;editor?.destroyEditor();editor=undefined;ready.value=false;current.value=undefined;}
async function loadApi(base:string){
  const url=new URL(base);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('编辑服务地址无效');
  const src=`${base.replace(/\/$/,'')}/web-apps/apps/api/documents/api.js`;
  if((window as any).DocsAPI)return;
  await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');const timer=setTimeout(()=>{script.remove();reject(Error('编辑器加载超时，请检查连接后重试'))},20000);script.src=src;script.onload=()=>{clearTimeout(timer);resolve()};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('无法加载 Office 编辑器'))};document.head.append(script)});
}
async function checkSave(){const session=current.value,run=generation;if(!session||saving.value)return;try{const result=await api<SaveStatus>(`/sessions/${session.sessionId}`);if(run!==generation)return;if(result.error)error.value=result.error;if(result.savedAt)savedAt.value=result.savedAt}catch{/* 手动保存会显示连接错误；后台检查保留当前编辑状态。 */}}
async function load(){
  const run=++generation;dispose();loading.value=true;error.value='';Object.assign(saveState,new SaveState());saving.value=false;savedAt.value='';
  try{
    if(!route.params.id){documents.value=[];const result=await api<{items:OfficeDocument[]}>(`/documents?view=${documentView.value}`);if(run===generation)documents.value=result.items;return}
    const id=String(route.params.id);if(!/^[0-9a-f-]{36}$/.test(id))throw Error('文件标识无效');
    const result=await api<EditorSession>(`/documents/${id}/open`,{mode:route.query.mode==='view'?'view':'edit'});if(run!==generation)return;
    current.value=result;await loadApi(result.documentServerUrl);await nextTick();if(run!==generation)return;
    editor=new (window as any).DocsAPI.DocEditor('office-editor',{...result.config,events:{
      onDocumentReady:()=>{if(run===generation)ready.value=true},
      onDocumentStateChange:(event:{data:boolean})=>{if(run!==generation)return;saveState.changed(event.data);if(event.data)savedAt.value=''},
      onError:()=>{if(run===generation)error.value='编辑服务发生错误，请保留窗口并重试保存'},
      onRequestClose:()=>{void router.push('/documents')},
    }});
    poll=setInterval(checkSave,3000);
  }catch(e){if(run===generation)error.value=(e as Error).message}finally{if(run===generation)loading.value=false}
}
async function save(){
  if(!current.value||saving.value)return;
  const run=generation,sessionId=current.value.sessionId,deadline=Date.now()+60000;
  saving.value=true;error.value='';
  const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,500));
  try{
    // true 表示输入还在编辑器；false 仅表示已送达编辑服务，并不代表已写回文件。
    while(saveState.pending&&run===generation&&Date.now()<deadline)await pause();
    if(run!==generation)return;
    if(saveState.pending)throw Error('编辑器尚未完成同步，请检查连接并重试保存');
    if(!dirty.value)return;
    const revision=saveState.revision;
    while(run===generation&&Date.now()<deadline){
      const result=await api<{queued:boolean;requestId:string}>(`/sessions/${sessionId}/save`,{});
      if(run!==generation)return;
      if(!result.queued){await pause();continue}
      while(run===generation&&Date.now()<deadline){
        await pause();if(run!==generation)return;
        const status=await api<SaveStatus>(`/sessions/${sessionId}`);if(run!==generation)return;
        if(saveState.confirm(revision,result.requestId,status.savedRequests||[])){savedAt.value=status.savedAt||'';return}
        if(status.error)throw Error(status.error);
        if(status.closed)throw Error('编辑会话已关闭，请重新打开文件');
      }
    }
    if(run===generation)throw Error('尚未收到保存完成确认，请保留窗口并重试');
  }catch(e){if(run===generation)error.value=(e as Error).message}finally{if(run===generation)saving.value=false}
}
async function go(path:string){await router.push(path)}
async function retry(){if(await canLeave())await load()}
function openFiles(){if(desktop.enabled)desktop.openApplication('files','/my-files');else location.assign(`${desktop.origin}/auth/start?app=files&path=%2Fmy-files&display=standalone`)}
watch(()=>[route.params.id,route.query.mode],load,{immediate:true});
watch(documentView,()=>{if(!route.params.id)void load()});
onBeforeUnmount(()=>{generation++;removeGuard();dispose();window.removeEventListener('beforeunload',beforeUnload)});
</script>
<template>
  <ConfiguredApplicationShell :config="config" :active-path="'/documents'" :title="config.pages[0].title" @navigate="go">
    <PageFrame v-if="!route.params.id">
      <template #header><PageHeading :title="config.pages[0].title" :description="config.pages[0].description"><template #actions>
        <el-button @click="openFiles">打开文件</el-button>
        <el-dropdown @command="create" :disabled="creating" trigger="click"><el-button type="primary" :loading="creating">新建文档</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="docx">文档 · Word</el-dropdown-item><el-dropdown-item command="xlsx">表格 · Excel</el-dropdown-item><el-dropdown-item command="pptx">演示文稿 · PowerPoint</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
      </template></PageHeading></template>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
      <ContentPanel><template #toolbar><el-radio-group v-model="documentView" aria-label="文档视图"><el-radio-button value="all">全部文档</el-radio-button><el-radio-button value="recent">最近打开</el-radio-button></el-radio-group><el-input v-model="search" placeholder="搜索文档名称" clearable class="document-search" aria-label="搜索文档"/><span class="document-total">共 {{shown.length}} 个文档</span><el-button text @click="load" :loading="loading">刷新</el-button></template>
        <el-table :data="shown" v-loading="loading" @row-dblclick="(item:OfficeDocument)=>go(`/documents/${item.id}`)" :empty-text="documentView==='recent'?'当前账户暂无打开记录，打开文档后会显示在这里':'还没有 Office 文件，可新建文档或在文件应用中上传'">
          <el-table-column label="名称" min-width="220"><template #default="{row}"><button class="document-name" @click="go(`/documents/${row.id}`)"><PlatformIcon :name="format(row.name)==='word'?'file-text':format(row.name)==='sheet'?'layout-grid':'monitor'"/><span>{{row.name}}</span></button></template></el-table-column>
          <el-table-column :label="documentView==='recent'?'最近打开时间':'修改时间'" width="180"><template #default="{row}">{{new Date(documentView==='recent'?row.officeAccessedAt:row.updatedAt).toLocaleString('zh-CN')}}</template></el-table-column>
          <el-table-column label="模式" width="100"><template #default="{row}"><el-tag :type="row.editable?'success':'info'" effect="plain" size="small">{{row.editable?'可编辑':'只读预览'}}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="100" align="right"><template #default="{row}"><el-button link type="primary" @click="go(`/documents/${row.id}`)">打开</el-button></template></el-table-column>
        </el-table>
      </ContentPanel>
    </PageFrame>
    <section v-else class="office-editing">
      <header class="office-toolbar"><button class="back" title="返回文档" aria-label="返回文档" @click="go('/documents')"><PlatformIcon name="chevron-left"/></button><strong>{{current?.file.name||'打开文档'}}</strong><span class="save-state" role="status">{{status}}</span><el-button v-if="current?.mode==='edit'" :disabled="!ready" :loading="saving" type="primary" @click="save">保存</el-button></header>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/><el-button v-if="error&&!ready" class="retry" @click="retry">重试</el-button>
      <div class="editor-area" v-loading="loading"><div id="office-editor"/></div>
    </section>
  </ConfiguredApplicationShell>
</template>
