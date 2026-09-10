import type {ServiceContract,ServiceManifest,ServiceOperation} from '@mg-inside/frontend';
export interface ParameterDraft {name:string;in:string;required:boolean;description:string;schema:string;original?:Record<string,any>}
export interface OperationDraft extends ServiceOperation {parameters:ParameterDraft[];requestBody:string;responses:string;original:Record<string,any>}
export interface RegistrationDraft {serviceId:string;appId:string;name:string;version:string;description:string;operations:OperationDraft[];base?:ServiceContract}
export function newOperation():OperationDraft{return {operationId:'',method:'GET',path:'',summary:'',effect:'read',parameters:[],requestBody:'',responses:JSON.stringify({'200':{description:'成功',content:{'application/json':{schema:{type:'object'}}}}},null,2),original:{}};}
export function emptyRegistration():RegistrationDraft{return {serviceId:'',appId:'',name:'',version:'1.0.0',description:'',operations:[newOperation()]};}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function fromPublication(manifest:ServiceManifest,contract?:ServiceContract):RegistrationDraft {
 return {...clone(manifest),base:contract?clone(contract):undefined,operations:manifest.operations.map(op=>{const path=contract?.paths[op.path]||{},doc=path[op.method.toLowerCase()]||{};return {...clone(op),original:clone(doc),parameters:(doc.parameters||[]).map((p:any)=>({name:p.name||'',in:p.in||'query',required:!!p.required,description:p.description||'',schema:JSON.stringify(p.schema||{},null,2),original:clone(p)})),requestBody:doc.requestBody?JSON.stringify(doc.requestBody,null,2):'',responses:JSON.stringify(doc.responses||{'200':{description:'成功'}},null,2)};})};
}
export function buildRegistration(draft:RegistrationDraft){
 const manifest:ServiceManifest={schemaVersion:1,serviceId:draft.serviceId.trim(),appId:draft.appId,name:draft.name.trim(),version:draft.version.trim(),description:draft.description,operations:draft.operations.map(op=>({operationId:op.operationId.trim(),method:op.method,path:op.path.trim(),summary:op.summary.trim(),effect:op.method==='GET'?'read':'write'}))};
 if(!manifest.name||!manifest.appId||!manifest.serviceId.startsWith(manifest.appId+'.')||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(manifest.version))throw Error('请填写服务名称、提供应用、有效服务标识和版本号');
 if(!draft.operations.length||draft.operations.some(op=>!op.operationId.trim()||!op.path.startsWith('/')||!op.summary.trim()))throw Error('请完整填写至少一个 API 的名称、标识和路径');
 const contract:ServiceContract={...(draft.base?clone(draft.base):{}),openapi:draft.base?.openapi||'3.1.1',info:{...draft.base?.info,title:manifest.name,version:manifest.version,description:manifest.description},paths:{}};
 const ids=new Set<string>();
 for(const op of draft.operations){
  if(ids.has(op.operationId))throw Error('API 操作标识不能重复');ids.add(op.operationId);
  const parameters=op.parameters.map(p=>{
   if(p.original?.$ref)return clone(p.original);
   if(!p.name.trim())throw Error('参数名称不能为空');
   const schema=JSON.parse(p.schema||'{}');if(!schema||typeof schema!=='object'||Array.isArray(schema))throw Error('参数 Schema 必须为 JSON 对象');
   const result:Record<string,any>={...p.original,name:p.name.trim(),in:p.in,required:p.in==='path'||p.required,description:p.description};
   if(!p.original?.content)result.schema=schema;
   return result;
  });
  const inherited=draft.base?.paths[op.path]?.parameters||[];
  const resolveParameter=(p:any)=>p.$ref?.startsWith('#/components/parameters/')?draft.base?.components?.parameters?.[p.$ref.split('/').at(-1)]:p;
  for(const match of op.path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g))if(![...parameters,...inherited].map(resolveParameter).some(p=>p?.in==='path'&&p.name===match[1]))parameters.push({name:match[1],in:'path',required:true,description:'',schema:{type:'string'}});
  const doc:Record<string,any>={...clone(op.original),operationId:op.operationId.trim(),summary:op.summary.trim(),responses:JSON.parse(op.responses)};
  if(parameters.length||op.original.parameters)doc.parameters=parameters;
  if(op.requestBody.trim())doc.requestBody=JSON.parse(op.requestBody);else delete doc.requestBody;
  const path=op.path.trim();
  // 保留路径级参数和扩展，方法定义由当前草稿逐项生成。
  contract.paths[path]||=Object.fromEntries(Object.entries(draft.base?.paths[path]||{}).filter(([key])=>!['get','post','put','patch','delete','head','options','trace'].includes(key)).map(([key,value])=>[key,clone(value)]));
  if(contract.paths[path][op.method.toLowerCase()])throw Error('同一路径和方法不能重复');contract.paths[path][op.method.toLowerCase()]=doc;
 }
 return {manifest,contract};
}
