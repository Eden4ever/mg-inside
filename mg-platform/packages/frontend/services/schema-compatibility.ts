/** JSON Schema 值集合包含关系。仅证明支持的规则；未证明包含不等于已证明不兼容。 */
import {hasComposition,proveComposition} from './schema-composition';
export type Inclusion = {compatible:boolean;issues:Array<{path:string;reason:string}>};
type Schema=boolean|Record<string,any>;
const annotations=new Set(['title','description','examples','example','deprecated','$comment','$schema']);
const supported=new Set(['type','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','minItems','maxItems','uniqueItems','items','properties','required','additionalProperties','minProperties','maxProperties']);
const stringify=(value:any):string=>Array.isArray(value)?'['+value.map(stringify).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stringify(value[k])).join(',')+'}':JSON.stringify(value);
const pointer=(value:string)=>value.replace(/~/g,'~0').replace(/\//g,'~1');
const atoms=['null','boolean','string','integer','fraction','array','object'];
function types(schema:any){const declared=schema.type===undefined?atoms:Array.isArray(schema.type)?schema.type:[schema.type];return new Set<string>(declared.flatMap((t:string)=>t==='number'?['integer','fraction']:[t]));}
function shape(schema:Schema):Schema {if(typeof schema==='boolean')return schema;return Object.fromEntries(Object.entries(schema).filter(([key])=>!annotations.has(key)));}
function equal(a:any,b:any){return stringify(a)===stringify(b);}
function lower(schema:any){let bound=[-Infinity,false] as [number,boolean];if(schema.minimum!==undefined)bound=[schema.minimum,false];if(schema.exclusiveMinimum!==undefined&&(schema.exclusiveMinimum>bound[0]||schema.exclusiveMinimum===bound[0]))bound=[schema.exclusiveMinimum,true];return bound;}
function upper(schema:any){let bound=[Infinity,false] as [number,boolean];if(schema.maximum!==undefined)bound=[schema.maximum,false];if(schema.exclusiveMaximum!==undefined&&(schema.exclusiveMaximum<bound[0]||schema.exclusiveMaximum===bound[0]))bound=[schema.exclusiveMaximum,true];return bound;}

/** 展开本平台允许的同文档引用；兄弟约束按交集保留，循环和体积超限交给人工审阅。 */
export function expandComparisonSchema(document:any,schema:Schema):Schema {
 let nodes=0;
 function visit(value:any,seen:Set<string>,depth:number):any{
  if(++nodes>12000||depth>64)throw Error('Schema 展开超过比较上限');
  if(typeof value==='boolean')return value;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Schema 格式无效');
  if(value.$ref){
   const ref=value.$ref;if(typeof ref!=='string'||!/^#\/components\/schemas\/[A-Za-z0-9._-]+$/.test(ref)||seen.has(ref))throw Error('Schema 引用循环或不受支持');
   const target=document?.components?.schemas?.[ref.split('/')[3]!];if(target===undefined)throw Error('Schema 引用不存在');
   const expanded=visit(target,new Set([...seen,ref]),depth+1);
   const siblings=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$ref'&&!annotations.has(key)));
   return Object.keys(siblings).length?{allOf:[expanded,visit(siblings,seen,depth+1)]}:expanded;
  }
  const result:any={};
  for(const [key,child] of Object.entries(value)){
   if(annotations.has(key))continue;
   if(['properties','patternProperties','$defs','dependentSchemas'].includes(key))result[key]=Object.fromEntries(Object.entries(child as any).map(([name,s])=>[name,visit(s,seen,depth+1)]));
   else if(['items','additionalProperties','contains','not','if','then','else','propertyNames','unevaluatedProperties','unevaluatedItems'].includes(key))result[key]=visit(child,seen,depth+1);
   else if(['allOf','anyOf','oneOf','prefixItems'].includes(key))result[key]=(child as any[]).map(s=>visit(s,seen,depth+1));
   else result[key]=child;
  }
  return result;
 }
 return visit(schema,new Set(),0);
}

/** 返回 source ⊆ target 的充分证明；issues 为尚未证明的位置，不伪造反例。 */
export function proveSchemaInclusion(source:Schema,target:Schema):Inclusion {
 const issues:Inclusion['issues']=[];let nodes=0;
 const fail=(path:string,reason:string)=>{if(issues.length<80)issues.push({path,reason});return false;};
 function visit(a:Schema,b:Schema,path:string,depth:number):boolean{
  if(++nodes>12000||depth>64)return fail(path,'结构超过自动比较上限');
  a=shape(a);b=shape(b);
  if(equal(a,b)||a===false||b===true||b!==false&&Object.keys(b).length===0)return true;
  if(a===true)a={};
  if(hasComposition(a)||hasComposition(b)){
   const result=proveComposition(a,b,{basicKeys:supported,same:equal,step:()=>{if(++nodes>12000)throw Error('组合结构超过自动比较上限');},includes:(left,right)=>{
    const at=issues.length;const ok=visit(left,right,path,depth+1);issues.splice(at);return ok;
   }});
   if(result.compatible)return true;
   for(const issue of result.issues)fail(path+issue.path,issue.reason);
   return false;
  }
  if(b===false)return fail(path,'目标不再接受任何值');
  const x=a as Record<string,any>,y=b as Record<string,any>;
  const unknown=[...new Set([...Object.keys(x),...Object.keys(y)])].filter(key=>!supported.has(key));
  if(unknown.length)return fail(path,'涉及需审阅的约束：'+unknown.join('、'));
  const tx=types(x),ty=types(y);let ok=true;
  for(const type of tx)if(!ty.has(type))ok=fail(path+'/type','允许的数据类型未能证明被目标完整接受');
  // 枚举和常量集合比较；不能忽略枚举以外的其他约束。
  const finite=(s:any)=>Object.hasOwn(s,'const')?(s.enum&&!s.enum.some((v:any)=>equal(v,s.const))?[]:[s.const]):s.enum;
  const valuesA=finite(x),valuesB=finite(y);
  if(valuesB&&(!valuesA||valuesA.some((v:any)=>!valuesB.some((w:any)=>equal(v,w)))))ok=fail(path+'/enum','目标枚举或常量可能排除了原有值');
  if(tx.has('integer')||tx.has('fraction')){
   const [amin,ae]=lower(x),[bmin,be]=lower(y),[amax,axe]=upper(x),[bmax,bxe]=upper(y);
   if(amin<bmin||amin===bmin&&!ae&&be)ok=fail(path+'/minimum','下界可能收紧');
   if(amax>bmax||amax===bmax&&!axe&&bxe)ok=fail(path+'/maximum','上界可能收紧');
   if(y.multipleOf!==undefined&&x.multipleOf!==y.multipleOf&&!(Number.isSafeInteger(x.multipleOf)&&Number.isSafeInteger(y.multipleOf)&&x.multipleOf>0&&y.multipleOf>0&&x.multipleOf%y.multipleOf===0))ok=fail(path+'/multipleOf','倍数约束未能证明兼容');
  }
  const length=(min:string,max:string)=>{if((x[min]??0)<(y[min]??0))ok=fail(path+'/'+min,'最小数量或长度可能增加');if((x[max]??Infinity)>(y[max]??Infinity))ok=fail(path+'/'+max,'最大数量或长度可能减少');};
  if(tx.has('string')){
   length('minLength','maxLength');if(y.pattern!==undefined&&x.pattern!==y.pattern)ok=fail(path+'/pattern','正则表达式的包含关系需审阅');
  }
  if(tx.has('array')){
   length('minItems','maxItems');if(y.uniqueItems===true&&x.uniqueItems!==true&&(x.maxItems??Infinity)>1)ok=fail(path+'/uniqueItems','目标要求元素唯一');
   if(x.maxItems!==0&&!visit(x.items??true,y.items??true,path+'/items',depth+1))ok=false;
  }
  if(tx.has('object')){
   length('minProperties','maxProperties');
   for(const key of y.required||[])if(!(x.required||[]).includes(key))ok=fail(path+'/required/'+pointer(key),'目标要求字段必填');
   const xp=x.properties||{},yp=y.properties||{};
   for(const key of new Set([...Object.keys(xp),...Object.keys(yp)])){
    const xs=Object.hasOwn(xp,key)?xp[key]:x.additionalProperties??true,ys=Object.hasOwn(yp,key)?yp[key]:y.additionalProperties??true;
    if(!visit(xs,ys,path+'/properties/'+pointer(key),depth+1))ok=false;
   }
   if(!visit(x.additionalProperties??true,y.additionalProperties??true,path+'/additionalProperties',depth+1))ok=false;
  }
  return ok;
 }
 try{return {compatible:visit(source,target,'',0),issues};}
 catch{return {compatible:false,issues:[{path:'',reason:'Schema 结构无法自动比较'}]};}
}
