import {canonicalJson,contractOperation,type ServiceContract,type ContractChange} from './openapi';
import type {ServiceManifest} from './contracts';
import {expandComparisonSchema,proveSchemaInclusion} from './schema-compatibility';

const same=(a:any,b:any)=>canonicalJson(a)===canonicalJson(b);
const pointer=(key:string)=>key.replace(/~/g,'~0').replace(/\//g,'~1');
const omit=(value:any,keys:string[])=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));
const notes=['description','summary','example','examples','title','externalDocs'];

/** 比较已校验的 OpenAPI 契约。结构包含证明与业务行为、实现正确性分别处理。 */
export function compareContractVersions(before:ServiceContract|undefined,after:ServiceContract|undefined,manifest:ServiceManifest):ContractChange[]{
 if(!before&&!after)return [];
 if(!before)return [{operationId:'全部接口',description:'首次提供参数和响应契约；旧版本没有结构基准',requiresReview:false,assessment:'baseline'}];
 if(!after)return [{operationId:'全部接口',description:'目标版本不再提供 OpenAPI 契约',requiresReview:true,assessment:'review'}];
 if(same(before,after))return [];
 const changes:ContractChange[]=[];let steps=0,opId='全部接口';
 function budget(){if(++steps>4000||changes.length>200)throw Error('契约差异超过自动比较上限');}
 function add(path:string,description:string,review:boolean){budget();changes.push({operationId:opId,path,description,requiresReview:review,assessment:review?'review':'compatible'});}
 function reference(doc:ServiceContract,value:any):any{
  const seen=new Set<string>();
  while(value?.$ref){budget();const ref=value.$ref;if(seen.has(ref)||!/^#\/components\/(parameters|responses|requestBodies|headers)\/[A-Za-z0-9._-]+$/.test(ref))throw Error('对象引用不受支持');seen.add(ref);value=doc.components?.[ref.split('/')[2]]?.[ref.split('/')[3]];if(!value)throw Error('对象引用不存在');}
  return value;
 }
 function schema(a:any,b:any,path:string,label:string,response=false){
  budget();
  try{
   const x=expandComparisonSchema(before,a??true),y=expandComparisonSchema(after,b??true);
   if(same(x,y))return;
   const proof=response?proveSchemaInclusion(y,x):proveSchemaInclusion(x,y);
   if(proof.compatible)add(path,label+(response?'：新版允许的值均符合旧版结构':'：新版结构仍接受旧版允许的值'),false);
   else for(const issue of proof.issues)add(path+issue.path,label+'：'+issue.reason,true);
  }catch(error){add(path,label+'：'+(error as Error).message+'，需人工审阅',true);}
 }
 function extras(a:any,b:any,excluded:string[],path:string,label:string){
  if(!same(omit(a,[...notes,...excluded]),omit(b,[...notes,...excluded])))add(path,label+'的编码或其他约束发生变化，需核对调用方',true);
 }
 function content(a:any,b:any,path:string,label:string,response=false){
  const left=a||{},right=b||{},source=response?right:left,target=response?left:right;
  if(response&&Object.keys(left).length&&!Object.keys(right).length){add(path,label+'移除了原有响应正文，旧调用方可能无法读取',true);return;}
  for(const media of Object.keys(source)){
   budget();const location=path+'/'+pointer(media);
   if(!Object.hasOwn(target,media)){add(location,label+(response?'新增了旧版未声明的媒体类型 ':'不再声明原媒体类型 ')+media+'，通配媒体类型需要审阅',true);continue;}
   schema(left[media].schema,right[media].schema,location+'/schema',label,response);
   extras(left[media],right[media],['schema'],location,label);
  }
  for(const media of Object.keys(target))if(!Object.hasOwn(source,media))add(path+'/'+pointer(media),label+(response?'移除可返回的媒体类型 ':'新增可接受的媒体类型 ')+media,false);
 }
 function parameters(doc:ServiceContract,values:any[]){
  const result=new Map<string,any>();
  // contractOperation 按路径级、操作级合并；同名同位置的操作参数覆盖路径参数。
  for(const raw of values){const p=reference(doc,raw);const name=p.in==='header'?p.name.toLowerCase():p.name;result.set(p.in+':'+name,p);}
  return result;
 }
 function parameter(a:any,b:any,path:string,label:string,response=false){
  if(!a){add(path,label+(b.required&&!response?'新增必填项':'新增可选声明'),!!b.required&&!response);return;}
  if(!b){add(path,label+'移除了已有声明，需核对调用方依赖',true);return;}
  if(!!a.required!==!!b.required)add(path+'/required',label+(b.required?'改为必填':'改为可选'),response?!!a.required:!!b.required);
  const wire=(p:any)=>{const style=p.style||(p.in==='query'||p.in==='cookie'?'form':'simple');return {style,explode:p.explode??style==='form',allowReserved:p.allowReserved??false,allowEmptyValue:p.allowEmptyValue??false};};
  if(!same(wire(a),wire(b)))add(path,label+'序列化方式或空值处理发生变化',true);
  if(!!a.content!==!!b.content)add(path,label+'在 schema 与 content 表示方式之间切换，需要审阅',true);
  else if(a.content||b.content)content(a.content,b.content,path+'/content',label,response);
  else schema(a.schema,b.schema,path+'/schema',label,response);
  extras(a,b,['name','in','required','style','explode','allowReserved','allowEmptyValue','schema','content'],path,label);
 }
 function headers(a:any,b:any,path:string){
  const normalize=(doc:ServiceContract,headers:any)=>Object.fromEntries(Object.entries(headers||{}).filter(([key])=>key.toLowerCase()!=='content-type').map(([key,value])=>[key.toLowerCase(),reference(doc,value)]));
  const left=normalize(before!,a),right=normalize(after!,b);
  for(const key of new Set([...Object.keys(left),...Object.keys(right)]))parameter(left[key],right[key],path+'/'+pointer(key),'响应头 '+key,true);
 }
 function responses(a:any,b:any){
  const responseKey=(responses:any,status:number)=>Object.hasOwn(responses,String(status))?String(status):Object.hasOwn(responses,String(status)[0]+'XX')?String(status)[0]+'XX':Object.hasOwn(responses,'default')?'default':undefined;
  const seen=new Set<string>();
  for(let status=100;status<=599;status++){
   const ak=responseKey(a,status),bk=responseKey(b,status),pair=String(ak)+'|'+String(bk);if(seen.has(pair))continue;seen.add(pair);
   if(!ak&&!bk)continue;
   const path='/responses/'+(bk||ak);
   if(!bk){add(path,'新版不再声明部分旧响应状态（例如 '+status+'）',false);continue;}
   if(!ak){add(path,'新增旧版未声明的响应状态（例如 '+status+'）',true);continue;}
   const left=reference(before!,a[ak]),right=reference(after!,b[bk]);
   content(left.content,right.content,path+'/content','响应结构',true);
   headers(left.headers,right.headers,path+'/headers');
   extras(left,right,['content','headers'],path,'响应结构');
  }
 }
 function security(doc:ServiceContract,op:any){
  const requirements=op.security??doc.security??[];
  const normalized=(requirements.length?requirements:[{}]).map((item:any)=>Object.fromEntries(Object.entries(item).map(([name,scopes])=>[name,[...scopes as string[]].sort()]))).sort((a:any,b:any)=>canonicalJson(a).localeCompare(canonicalJson(b)));
  const names=[...new Set<string>(normalized.flatMap((item:any)=>Object.keys(item)))];
  if(names.some(name=>!doc.components?.securitySchemes?.[name]||doc.components.securitySchemes[name].$ref))throw Error('有效认证方案缺失或使用尚未解析的引用');
  return {requirements:normalized,schemes:Object.fromEntries(names.map(name=>[name,omit(doc.components?.securitySchemes?.[name],notes)]))};
 }
 try{
  for(const operation of manifest.operations){
   budget();opId=operation.operationId;
   const left=contractOperation(before,operation),right=contractOperation(after,operation);if(!left||!right)continue;
   const lp=parameters(before,left.parameters),rp=parameters(after,right.parameters);
   for(const key of new Set([...lp.keys(),...rp.keys()]))parameter(lp.get(key),rp.get(key),'/parameters/'+pointer(key),'参数 '+key);
   const lb=reference(before,left.requestBody),rb=reference(after,right.requestBody);
   if(!lb&&rb)add('/requestBody','请求正文'+(rb.required?'新增必填正文':'新增可选正文'),!!rb.required);
   else if(lb&&!rb)add('/requestBody','请求正文声明已移除，需核对原有调用',true);
   else if(lb&&rb){
    if(!!lb.required!==!!rb.required)add('/requestBody/required','请求正文'+(rb.required?'改为必填':'改为可选'),!!rb.required);
    content(lb.content,rb.content,'/requestBody/content','请求正文');extras(lb,rb,['content','required'],'/requestBody','请求正文');
   }
   responses(left.responses||{},right.responses||{});
   if(!same(security(before,left),security(after,right)))add('/security','认证要求或其有效安全方案发生变化，需要审阅',true);
   extras(left,right,['operationId','parameters','requestBody','responses','security','tags','servers'],'/operation','操作行为');
  }
 }catch(error){changes.push({operationId:opId,description:(error as Error).message+'；比较未完成，请下载两份契约审阅',requiresReview:true,assessment:'review'});}
 return changes;
}
