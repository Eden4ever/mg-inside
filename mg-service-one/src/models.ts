import type {ServiceContract,ServiceManifest} from '@mg-inside/frontend';
export interface Binding {environment:string;endpointRef:string;deploymentId:string;deploymentDigest:string;manifestDigest:string;contractDigest:string}
export interface Lifecycle {status:'draft'|'published'|'deprecated'|'retired';revision:number;reason:string;at:string;actor:string;retireAfter?:string}
export interface Deployment {endpointRef:string;name:string;appId:string;providerAppId:string;environment:string;baseUrl:string;deploymentId:string;artifactDigest:string;resourceRef:string;deployedAt:string;digest:string;services:Array<{serviceId:string;version:string;manifestDigest:string;contractDigest:string}>}
export interface Publication {contract?:ServiceContract;contractDigest?:string;manifest:ServiceManifest;digest:string;at:string;actor:string;active:boolean;activeRevision:number;activeVersion:string|null;binding?:Binding;lifecycle?:Lifecycle}
export interface Catalog {items:Publication[];canManage:boolean;storage?:{backend:string;environment:string};runningEnvironment?:string;bindingRequired?:boolean;environments?:Array<{id:string;name:string}>;deployments?:Deployment[];providers?:Array<{id:string;name:string}>;activity:any[];audit:any[]}
export interface ApiReference {serviceId:string;operationId:string}
export interface ApiTag {id:string;name:string;color:'primary'|'success'|'warning'|'danger'|'info';enabled:boolean;references:ApiReference[]}
export interface Workspace {revision:number;services:Record<string,{category:string;owner:string}>;tags:ApiTag[];events?:Array<{at:string;serviceId?:string;before?:{category?:string;owner?:string};after?:{category?:string;owner?:string}}> ;updatedAt?:string;updatedBy?:string}
export const categories=[{id:'system',name:'系统服务'},{id:'application',name:'应用服务'},{id:'data',name:'数据服务'},{id:'component',name:'组件服务'},{id:'engine',name:'引擎服务'},{id:'uncategorized',name:'未分类'}];
export const categoryName=(id?:string)=>categories.find(c=>c.id===id)?.name||'未分类';
export function serviceRows(items:Publication[]){const result=new Map<string,Publication>();for(const p of items){const previous=result.get(p.manifest.serviceId);if(!previous||p.active||!previous.active&&Date.parse(p.at)>=Date.parse(previous.at))result.set(p.manifest.serviceId,p);}return [...result.values()];}
export const statusName=(p:Publication)=>p.manifest.exposure==='catalog'?'目录登记':p.active?'已启用':p.activeRevision>0?'已停用':'未发布';
export const dateTime=(value?:string)=>value?new Date(value).toLocaleString('zh-CN'):'--';
export const bytes=(value?:number|null)=>value==null?'--':value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(2)+' MB';
