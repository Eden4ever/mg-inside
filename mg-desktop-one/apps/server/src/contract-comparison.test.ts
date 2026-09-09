import {it,expect} from 'vitest';
import {compareContractVersions,type ServiceContract} from '../../../../mg-platform/packages/frontend/services/openapi';
import type {ServiceManifest} from '../../../../mg-platform/packages/frontend/services/contracts';
const manifest:ServiceManifest={schemaVersion:1,serviceId:'test.api',appId:'files',name:'测试',version:'1.0.0',description:'',operations:[{operationId:'run',method:'POST',path:'/items',summary:'',effect:'write'}]};
function document():ServiceContract {
 const input={type:'object',properties:{name:{type:'string',maxLength:10}},required:['name'],additionalProperties:false};
 const output={type:'object',properties:{id:{type:'integer'}},required:['id'],additionalProperties:false};
 return {openapi:'3.1.1',info:{title:'测试',version:'1.0.0'},paths:{'/items':{post:{
  operationId:'run',parameters:[{in:'query',name:'limit',schema:{type:'integer',minimum:1,maximum:10}}],
  requestBody:{required:true,content:{'application/json':{schema:input}}},
  responses:{'200':{description:'结果',content:{'application/json':{schema:output}}}}
 }}}};
}
const op=(d:ServiceContract)=>d.paths['/items']!.post!;
const body=(d:ServiceContract)=>op(d).requestBody.content['application/json'].schema;
const result=(d:ServiceContract)=>op(d).responses['200'].content['application/json'].schema;
const changes=(a:ServiceContract,b:ServiceContract)=>compareContractVersions(a,b,manifest);
const review=(a:ServiceContract,b:ServiceContract)=>changes(a,b).filter(c=>c.requiresReview);

it('请求允许范围放宽及响应收窄可证明兼容，反方向必须审阅',()=>{
 const a=document(),b=document();body(b).properties.name.maxLength=20;op(b).parameters[0].schema.maximum=20;result(b).properties.id.minimum=1;
 expect(changes(a,b).length).toBeGreaterThanOrEqual(3);expect(review(a,b)).toEqual([]);
 expect(review(b,a).length).toBeGreaterThanOrEqual(3);
 expect(changes(a,b).every(c=>c.assessment==='compatible'&&c.path)).toBe(true);
});
it('请求新增必填项和响应删除必填字段分别定位，字段名 description 不能被忽略',()=>{
 const a=document(),b=document();body(b).properties.description={type:'string'};body(b).required.push('description');result(b).required=[];
 const found=review(a,b);expect(found.some(c=>c.path?.includes('/required/description')&&c.description.includes('请求正文'))).toBe(true);
 expect(found.some(c=>c.path?.includes('/required/id')&&c.description.includes('响应结构'))).toBe(true);
});
it('操作参数覆盖路径参数；参数顺序和显式默认序列化不构成结构差异',()=>{
 const a=document(),b=document();a.paths['/items']!.parameters=[{in:'query',name:'limit',schema:{type:'integer',maximum:2}}];
 b.paths['/items']!.parameters=[{in:'query',name:'limit',schema:{type:'string'}}];
 Object.assign(op(b).parameters[0],{style:'form',explode:true,required:false,allowReserved:false,allowEmptyValue:false});
 expect(changes(a,b)).toEqual([]);
 op(b).parameters[0].explode=false;expect(review(a,b).some(c=>c.description.includes('序列化'))).toBe(true);
});
it('参数删除、新必填参数和 schema/content 切换不会被放行',()=>{
 const a=document(),b=document();op(b).parameters=[];expect(review(a,b)).toHaveLength(1);
 op(b).parameters=[{in:'query',name:'new',required:true,schema:{type:'string'}}];expect(review(a,b)).toHaveLength(2);
 op(b).parameters=[{in:'query',name:'limit',content:{'application/json':{schema:{type:'integer'}}}}];expect(review(a,b).some(c=>c.description.includes('表示方式'))).toBe(true);
});
it('正文必填、响应正文删除、媒体类型及 multipart 编码变化必须审阅',()=>{
 const a=document(),b=document();op(a).requestBody.required=false;expect(review(a,b)).toHaveLength(1);
 op(b).requestBody.required=false;delete op(b).responses['200'].content;expect(review(a,b).some(c=>c.description.includes('响应正文'))).toBe(true);
 const c=document();op(c).requestBody.content={'application/xml':{schema:{type:'string'}}};expect(review(document(),c).some(c=>c.path?.includes('application~1json'))).toBe(true);
 const d=document();op(d).requestBody.content['application/json'].encoding={name:{style:'form'}};expect(review(document(),d).some(c=>c.description.includes('编码'))).toBe(true);
});
it('响应状态使用精确码、范围码和 default 的覆盖优先级，响应头不区分大小写',()=>{
 const a=document(),b=document();op(a).responses={'2XX':op(a).responses['200']};expect(changes(a,b).every(c=>!c.requiresReview)).toBe(true);
 const c=document();op(c).responses['201']=structuredClone(op(c).responses['200']);expect(review(document(),c).some(c=>c.description.includes('201'))).toBe(true);
 const d=document(),e=document();op(d).responses['200'].headers={'X-Count':{required:true,schema:{type:'integer'}}};op(e).responses['200'].headers={'x-count':{required:true,schema:{type:'integer',minimum:0}}};
 expect(review(d,e)).toEqual([]);expect(review(e,d).length).toBeGreaterThan(0);
 delete op(e).responses['200'].headers;expect(review(d,e).some(c=>c.description.includes('移除'))).toBe(true);
});
it('引用目标变更不能被相同 ref 掩盖，循环与未支持约束给出审阅位置',()=>{
 const a=document(),b=document();for(const d of [a,b]){d.components={schemas:{Input:body(d)}};op(d).requestBody.content['application/json'].schema={$ref:'#/components/schemas/Input'};}
 b.components!.schemas!.Input.required.push('code');b.components!.schemas!.Input.properties.code={type:'string'};
 expect(review(a,b).some(c=>c.path?.endsWith('/required/code'))).toBe(true);
 b.components!.schemas!.Input={$ref:'#/components/schemas/Input'};expect(review(a,b).some(c=>c.description.includes('循环'))).toBe(true);
});
it('认证替代方案顺序和无关方案不产生误报，有效认证变化必须确认',()=>{
 const a=document(),b=document();for(const d of [a,b]){d.security=[{session:[]},{bearer:['read','write']}];d.components={securitySchemes:{session:{type:'apiKey',in:'cookie',name:'session'},bearer:{type:'http',scheme:'bearer'}}};}
 b.security.reverse();b.security[0].bearer.reverse();b.components!.securitySchemes!.unused={type:'http',scheme:'basic'};expect(changes(a,b)).toEqual([]);
 b.components!.securitySchemes!.session.name='different';expect(review(a,b).some(c=>c.path==='/security')).toBe(true);
 op(b).security=[];expect(review(a,b).some(c=>c.path==='/security')).toBe(true);
});
it('有效认证方案缺失或间接引用不能因引用文本未变而放行',()=>{
 const a=document(),b=document();a.security=b.security=[{session:[]}];
 op(b).summary='更新说明';expect(review(a,b).some(c=>c.description.includes('认证方案'))).toBe(true);
 for(const d of [a,b])d.components={securitySchemes:{session:{$ref:'#/components/headers/Session'}}};
 expect(review(a,b).some(c=>c.description.includes('尚未解析'))).toBe(true);
});
it('组合结构在请求和响应中保持相反方向，并返回排他条件的具体位置',()=>{
 const a=document(),b=document();
 body(a).properties.name={type:'string',anyOf:[{maxLength:10},{maxLength:20}]};
 body(b).properties.name={type:'string',oneOf:[{maxLength:10},{maxLength:20}]};
 expect(review(a,b).some(c=>c.path?.includes('/properties/name/oneOf/')&&c.description.includes('排他'))).toBe(true);
 expect(review(b,a)).toEqual([]);
 const c=document(),d=document();result(c).properties.id={anyOf:[{type:'number'},{type:'integer'}]};result(d).properties.id={oneOf:[{type:'number'},{type:'integer'}]};
 expect(review(c,d)).toEqual([]);expect(review(d,c).some(c=>c.description.includes('响应结构'))).toBe(true);
});
