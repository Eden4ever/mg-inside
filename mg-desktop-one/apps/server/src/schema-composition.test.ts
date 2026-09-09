import {it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {proveSchemaInclusion,expandComparisonSchema} from '../../../../mg-platform/packages/frontend/services/schema-compatibility';
const compatible=(a:any,b:any)=>proveSchemaInclusion(a,b).compatible;
const variant=(kind:string,maxLength=10)=>({type:'object',properties:{kind:{const:kind},value:{type:'string',maxLength}},required:['kind']});

it('allOf 保留兄弟约束，并能组合独立上下界证明包含关系',()=>{
 const a={type:'string',allOf:[{minLength:2},{maxLength:8}]},b={type:'string',minLength:1,maxLength:10};
 expect(compatible(a,b)).toBe(true);expect(compatible(b,a)).toBe(false);
 expect(compatible({allOf:[{type:'number',minimum:3},{maximum:2}]},false)).toBe(true);
 expect(compatible({allOf:[{minimum:3},{maximum:2}]},false)).toBe(false); // 仍允许非数值。
});

it('对象 allOf 不能把各分支 additionalProperties 的作用域合并放宽',()=>{
 const a={allOf:[{type:'object',properties:{a:{type:'string'}},additionalProperties:false},{properties:{b:{type:'string'}}}]};
 const b={type:'object',properties:{a:{type:'string'},b:{type:'string'}},additionalProperties:false};
 expect(compatible(a,b)).toBe(true);expect(compatible(b,a)).toBe(false);
 const document={components:{schemas:{A:{type:'object',properties:{a:{type:'string'}}}}}};
 const withSibling=expandComparisonSchema(document,{$ref:'#/components/schemas/A',additionalProperties:false});
 expect(compatible(document.components.schemas.A,withSibling)).toBe(false);
});

it('anyOf 增加可接受分支兼容，移除分支需要审阅',()=>{
 const a={anyOf:[{type:'string'},{type:'integer'}]},b={anyOf:[{type:'number'},{type:'string'},{type:'null'}]};
 expect(compatible(a,b)).toBe(true);expect(compatible(b,a)).toBe(false);
 expect(compatible({type:'array',items:a},{type:'array',items:b})).toBe(true);
});

it('oneOf 保留恰好一个分支的含义，新增重叠分支不能放行',()=>{
 const a={anyOf:[{type:'number'},{type:'integer'}]},b={oneOf:[{type:'number'},{type:'integer'}]};
 expect(compatible(a,b)).toBe(false);expect(compatible(b,a)).toBe(true);
 expect(compatible(b,{type:'number',not:{type:'integer'}})).toBe(true);
 const single={oneOf:[variant('a')]},overlap={oneOf:[variant('a'),{type:'object'}]};
 expect(compatible(single,overlap)).toBe(false);
});

it('oneOf 不相交标签分支可放宽，重排与相同排他条件保持兼容',()=>{
 const a={oneOf:[variant('a'),variant('b')]},b={oneOf:[variant('b',20),variant('a',20),variant('c')]};
 expect(compatible(a,b)).toBe(true);expect(compatible(b,a)).toBe(false);
 const overlap={oneOf:[{type:'number'},{type:'integer'}]},reordered={oneOf:[{type:'integer'},{type:'number'}]};
 expect(compatible(overlap,reordered)).toBe(true);expect(compatible(reordered,overlap)).toBe(true);
});

it('空集证明不忽略 prefixItems 和 patternProperties 的局部作用域',()=>{
 expect(compatible({allOf:[{type:'array',prefixItems:[{type:'integer'}],items:false,minItems:1}]},false)).toBe(false);
 expect(compatible({allOf:[{type:'object',patternProperties:{'^x':{type:'string'}},additionalProperties:false,required:['x']}]},false)).toBe(false);
});

it('展开预算不足必须给出未证明结论',()=>{
 const result=proveSchemaInclusion({type:'number'},{oneOf:Array.from({length:80},(_,i)=>({type:'number',minimum:i}))});
 expect(result.compatible).toBe(false);expect(result.issues.some(i=>i.reason.includes('上限'))).toBe(true);
});

it('组合逻辑所有已证明关系用独立 Ajv 和交叉边界样本核对',()=>{
 const base:any[]=[true,false,{}, {type:'integer'}, {type:'number'}, {type:'string'}, {const:'a'}, {enum:['a','b']}, {type:'number',minimum:0}, {type:'number',maximum:2},variant('a'),variant('b')];
 const schemas:any[]=[...base,
  ...base.slice(3,9).flatMap((a,i)=>[{allOf:[a,base[(i+4)%base.length]]},{anyOf:[a,base[(i+4)%base.length]]},{oneOf:[a,base[(i+4)%base.length]]},{not:a}]),
  {type:'number',allOf:[{minimum:0},{maximum:2}]},{type:'object',allOf:[{properties:{x:{type:'string'}}},{required:['x']}]},
  {type:'array',items:{anyOf:[{type:'string'},{type:'integer'}]}},
  {oneOf:[variant('a'),variant('b')]},{anyOf:[variant('a',20),variant('b',20)]},
  {allOf:[{type:'array',prefixItems:[{type:'integer'}],items:false,minItems:1}]},
  {allOf:[{type:'object',patternProperties:{'^x':{type:'string'}},additionalProperties:false,required:['x']}]},
 ];
 const values:any[]=[null,true,false,-1,0,0.5,1,1.5,2,3,'','a','b','c','long text',[],[1],[1,'a'],['a'],{}, {x:''},{x:1},{a:''},{kind:'a'},{kind:'b'},{kind:'c'},{kind:'a',value:'a'.repeat(15)},{kind:'a',value:1}];
 const ajv=new Ajv2020({strict:false}),validators=schemas.map(schema=>ajv.compile(schema));let proven=0;
 for(let a=0;a<schemas.length;a++)for(let b=0;b<schemas.length;b++)if(compatible(schemas[a],schemas[b])){
  proven++;for(const value of values)if(validators[a]!(value))expect(validators[b]!(value),JSON.stringify({a:schemas[a],b:schemas[b],value})).toBe(true);
 }
 expect(proven).toBeGreaterThan(100);
});
