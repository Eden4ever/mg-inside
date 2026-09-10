import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import openapiSchema from './schemas/openapi-3.1.json';
import type {ServiceManifest} from '../../../../mg-platform/packages/frontend/services/contracts';
import {canonicalJson, type ServiceContract} from '../../../../mg-platform/packages/frontend/services/openapi';

// 官方文档结构 Schema 固定在仓库；Schema Object 使用 JSON Schema 2020-12 单独编译。
// 不配置 loadSchema，不解析磁盘或网络引用。
const createValidator=()=>addFormats(new Ajv2020({strict:false,allErrors:false,validateFormats:true,inlineRefs:false})).addFormat('media-range',/^[^\s/;]+\/[^\s/;]+(?:\s*;.*)?$/).addFormat('binary',true);
// 此处不扩展官方 meta 动态锚点，显式绑定到同文档的 Schema Object 定义。
// Ajv 对嵌套动态锚点的解析会错误地回到参数/响应对象；静态绑定保留本配置的校验语义。
function bindSchema(value:any){if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(key==='$dynamicRef'&&child==='#meta'){delete value[key];value.$ref='#/$defs/schema';}else bindSchema(child);}}
const boundDocumentSchema=structuredClone(openapiSchema);bindSchema(boundDocumentSchema);
const structureValidator=createValidator().addSchema(boundDocumentSchema);
const documentValidator=structureValidator.getSchema(openapiSchema.$id)!;
const componentValidators=Object.fromEntries(Object.entries({parameters:'parameter',responses:'response',requestBodies:'request-body',headers:'header'}).map(([key,definition])=>[key,structureValidator.compile({$ref:`${openapiSchema.$id}#/$defs/${definition}`})]));
const methods=new Set(['get','post','put','patch','delete','head','options','trace']);
export class ContractError extends Error {status=400;}
export function validateContract(input:unknown,manifest:ServiceManifest):ServiceContract {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ContractError('OpenAPI 契约必须是 JSON 对象');
  if(Buffer.byteLength(JSON.stringify(input))>512*1024)throw new ContractError('OpenAPI 契约不能超过 512 KiB');
  let count=0;
  const providerBase=(input as any).servers?.[0]?.url ?? '/';
  if(typeof providerBase!=='string'||!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/.test(providerBase))throw new ContractError('契约服务器必须是安全的提供方相对路径');
  const schemas:unknown[]=[];
  function inspect(value:any,depth=0){
    if(++count>30000||depth>48)throw new ContractError('OpenAPI 契约结构过大或嵌套过深');
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      if(['__proto__','prototype','constructor','$id','$anchor','$dynamicAnchor','$dynamicRef','$async'].includes(key))throw new ContractError(`契约暂不支持 ${key}`);
      if(key==='$ref'){
        if(typeof child!=='string'||!/^#\/components\/(schemas|parameters|responses|requestBodies|headers)\/[A-Za-z0-9._-]+$/.test(child))throw new ContractError('契约仅支持文档内 components 引用，禁止网络和文件引用');
        let target:any=input;for(const part of child.slice(2).split('/'))target=target&&Object.hasOwn(target,part)?target[part]:undefined;
        if(target===undefined)throw new ContractError(`契约引用不存在：${child}`);
      }
      if((key==='$schema'||key==='jsonSchemaDialect')&&child!=='https://json-schema.org/draft/2020-12/schema')throw new ContractError('契约 Schema 使用 JSON Schema 2020-12');
      if(key==='servers'&&(!Array.isArray(child)||child.some((server:any)=>server?.url!==providerBase||server.variables)))throw new ContractError(`契约服务器只能声明提供方相对路径 ${providerBase}，实际调用由平台绑定`);
      if(key==='schema')schemas.push(child);
      inspect(child,depth+1);
    }
  }
  inspect(input);
  if(!documentValidator(input))throw new ContractError(`OpenAPI 结构无效：${documentValidator.errors?.map(e=>`${e.instancePath||'/'} ${e.message}`).join('；')}`);
  const doc=input as ServiceContract;
  if(doc.openapi!=='3.1.1'||doc.info.version!==manifest.version||doc['x-service-id']!==manifest.serviceId||doc['x-app-id']!==manifest.appId)throw new ContractError('契约须使用 OpenAPI 3.1.1，服务 ID、应用及版本须与清单一致');
  if(doc.webhooks)throw new ContractError('当前服务出口不支持 webhook 契约');
  function dereference(value:any,category:string):any{
    const seen=new Set<string>();
    while(value?.$ref){
      if(!value.$ref.startsWith(`#/components/${category}/`)||seen.has(value.$ref))throw new ContractError('OpenAPI 对象引用类型不符或形成循环');
      seen.add(value.$ref);value=doc.components?.[category]?.[value.$ref.split('/')[3]];
    }
    if(!componentValidators[category]?.(value))throw new ContractError(`引用的 ${category} 对象格式无效`);
    return value;
  }
  for(const category of Object.keys(componentValidators))for(const value of Object.values(doc.components?.[category]||{}))dereference(value,category);
  const actual:string[]=[];
  for(const [path,item] of Object.entries(doc.paths||{})){
    if(item.$ref)throw new ContractError('接口路径须在 paths 中直接声明');
    for(const [method,op] of Object.entries(item))if(methods.has(method)){
      if(op.callbacks)throw new ContractError('当前服务出口不支持 callback 契约');
      const expected=manifest.operations.find(o=>o.operationId===op.operationId&&o.path===path&&o.method.toLowerCase()===method);
      if(!expected||actual.includes(op.operationId))throw new ContractError(`契约接口与清单不一致：${method.toUpperCase()} ${path}`);
      actual.push(op.operationId);
      const parameters=[...(item.parameters||[]),...(op.parameters||[])].map(v=>dereference(v,'parameters'));
      if(op.requestBody)dereference(op.requestBody,'requestBodies');
      for(const response of Object.values(op.responses||{})){
        const value=dereference(response,'responses');
        for(const header of Object.values(value.headers||{}))dereference(header,'headers');
      }
      const names=[...path.matchAll(/\{(\w+)\}/g)].map(m=>m[1]);
      if(names.some(name=>!parameters.some((p:any)=>p?.in==='path'&&p.name===name&&p.required===true))||parameters.some((p:any)=>p?.in==='path'&&!names.includes(p.name)))throw new ContractError(`路径参数声明不完整：${path}`);
    }
  }
  if(actual.length!==manifest.operations.length)throw new ContractError('契约必须覆盖清单中的全部接口');
  schemas.push(...Object.values(doc.components?.schemas||{}));
  const validator=createValidator();
  function schemaReferences(value:any){if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(key==='$ref'&&(typeof child!=='string'||!child.startsWith('#/components/schemas/')))throw new ContractError('数据 Schema 只能引用 components.schemas');schemaReferences(child);}}
  try {for(const schema of schemas){schemaReferences(schema);validator.compile({components:doc.components||{},allOf:[schema]});}}
  catch(error){throw new ContractError(`参数或响应 Schema 无效：${(error as Error).message}`);}
  return JSON.parse(canonicalJson(doc));
}

/** 验收工具校验真实响应；不改变统一出口现有传输语义。 */
export function responseValidator(doc:ServiceContract,operationId:string,status=200){
  for(const item of Object.values(doc.paths))for(const [method,op] of Object.entries(item))if(methods.has(method)&&op.operationId===operationId){
    let response=op.responses?.[String(status)]||op.responses?.default;
    if(response?.$ref)response=doc.components?.responses?.[response.$ref.split('/')[3]];
    const schema=response?.content?.['application/json']?.schema;
    if(schema===undefined)throw new ContractError('该响应没有 JSON Schema');
    return createValidator().compile({components:doc.components||{},allOf:[schema]});
  }
  throw new ContractError('契约操作不存在');
}
