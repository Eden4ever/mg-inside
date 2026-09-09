import {it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {proveSchemaInclusion,expandComparisonSchema} from '../../../../mg-platform/packages/frontend/services/schema-compatibility';

it('请求放宽与响应收窄遵循相反方向，类型和数值边界可证明包含',()=>{
 const old={type:'integer',minimum:1,maximum:10},wide={type:'number',minimum:0,maximum:20};
 expect(proveSchemaInclusion(old,wide).compatible).toBe(true);
 expect(proveSchemaInclusion(wide,old).compatible).toBe(false);
 expect(proveSchemaInclusion({type:'number',exclusiveMinimum:1},{type:'number',minimum:1}).compatible).toBe(true);
 expect(proveSchemaInclusion({type:'number',minimum:1},{type:'number',exclusiveMinimum:1}).compatible).toBe(false);
 expect(proveSchemaInclusion({type:'number',multipleOf:6},{type:'number',multipleOf:3}).compatible).toBe(true);
});

it('必填、对象额外字段与数组约束不能被忽略',()=>{
 const before={type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false};
 const after={type:'object',properties:{id:{type:'string'},label:{type:'string'}},required:['id']};
 expect(proveSchemaInclusion(before,after).compatible).toBe(true);
 expect(proveSchemaInclusion(after,before).compatible).toBe(false);
 expect(proveSchemaInclusion({type:'object'},{type:'object',properties:{id:{type:'string'}}}).compatible).toBe(false);
 expect(proveSchemaInclusion({type:'array',items:{type:'integer'},maxItems:1},{type:'array',items:{type:'number'},uniqueItems:true}).compatible).toBe(true);
 expect(proveSchemaInclusion({type:'array'},{type:'array',uniqueItems:true}).compatible).toBe(false);
});

it('展开引用保留名为 description 的业务字段，循环和兄弟约束不误报兼容',()=>{
 const document={components:{schemas:{Item:{type:'object',properties:{description:{type:'string',maxLength:10}}},Cycle:{$ref:'#/components/schemas/Cycle'}}}};
 const expanded=expandComparisonSchema(document,{$ref:'#/components/schemas/Item'});
 expect(expanded).toEqual(document.components.schemas.Item);
 expect(()=>expandComparisonSchema(document,{$ref:'#/components/schemas/Cycle'})).toThrow('循环');
 expect(()=>expandComparisonSchema(document,{$ref:'#/components/schemas/Item',additionalProperties:false})).toThrow('额外约束');
 expect(proveSchemaInclusion({type:'string',format:'email'},{type:'string',format:'uuid'}).compatible).toBe(false);
 expect(proveSchemaInclusion({type:'string',allOf:[{minLength:1}]},{type:'string',allOf:[{minLength:2}]}).compatible).toBe(false);
});

it('所有已证明的包含关系经独立 Ajv 和边界样本反向核查',()=>{
 const schemas:any[]=[true,false,{}, {type:'integer'}, {type:'number'}, {type:['string','null']}, {type:'string',minLength:1}, {type:'string',maxLength:2}, {type:'number',minimum:0}, {type:'integer',maximum:2}, {enum:[0,1]}, {type:'array',items:{type:'integer'}}, {type:'array',maxItems:1}, {type:'object',properties:{x:{type:'string'}}}, {type:'object',properties:{x:{type:'string'}},required:['x'],additionalProperties:false}];
 const values:any[]=[null,true,false,-1,0,0.5,1,2,3,'','x','xxx',[],[0],[0,1],['x'],{}, {x:''},{x:0},{y:1},{x:'',y:1}];
 const ajv=new Ajv2020({strict:false});let proven=0;
 for(const a of schemas)for(const b of schemas)if(proveSchemaInclusion(a,b).compatible){proven++;const acceptsA=ajv.compile(a),acceptsB=ajv.compile(b);for(const value of values)if(acceptsA(value))expect(acceptsB(value),JSON.stringify({a,b,value})).toBe(true);}
 expect(proven).toBeGreaterThan(30);
});

it('const 与 enum 同时声明时取交集，不能忽略目标的空集合',()=>{
 expect(proveSchemaInclusion({const:1},{const:1,enum:[2]}).compatible).toBe(false);
 expect(proveSchemaInclusion({enum:[1,2]},{const:1,enum:[1,2]}).compatible).toBe(false);
 expect(proveSchemaInclusion({const:1},{enum:[1,2]}).compatible).toBe(true);
});
