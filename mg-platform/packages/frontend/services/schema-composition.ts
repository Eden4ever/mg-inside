/** 有界组合逻辑证明。展开为析取范式，保留 oneOf 的排他条件；预算不足不放行。 */
type Schema=boolean|Record<string,any>;
type Literal={schema:Schema;negative:boolean;path:string};
type Clause=Literal[];
type Options={basicKeys:Set<string>;same:(a:any,b:any)=>boolean;includes:(a:Schema,b:Schema)=>boolean;step:()=>void};
const operators=['allOf','anyOf','oneOf','not'];
const pointer=(s:string)=>s.replace(/~/g,'~0').replace(/\//g,'~1');
const allTypes=['null','boolean','string','integer','fraction','array','object'];
const valueType=(v:any)=>v===null?'null':Array.isArray(v)?'array':typeof v==='number'?(Number.isInteger(v)?'integer':'fraction'):typeof v;

export function hasComposition(schema:Schema){return typeof schema==='object'&&operators.some(key=>Object.hasOwn(schema,key));}

export function proveComposition(source:Schema,target:Schema,options:Options):{compatible:boolean;issues:Array<{path:string;reason:string}>}{
 const {same,includes,step,basicKeys}=options;
 function budget(depth=0){step();if(depth>64)throw Error('组合结构嵌套超过比较上限');}
 function bounded(clauses:Clause[]){budget();if(clauses.length>256||clauses.reduce((n,c)=>n+c.length,0)>8192)throw Error('组合分支超过比较上限');return clauses;}
 function and(a:Clause[],b:Clause[]):Clause[]{
  const result:Clause[]=[];
  for(const left of a)for(const right of b){budget();const clause=[...left];let contradictory=false;
   for(const item of right){const existing=clause.find(other=>same(other.schema,item.schema));if(existing){if(existing.negative!==item.negative){contradictory=true;break;}}else clause.push(item);}
   if(!contradictory)result.push(clause);bounded(result);
  }
  return result;
 }
 const every=(parts:Clause[][])=>parts.reduce(and,[[]] as Clause[]);
 const some=(parts:Clause[][])=>bounded(parts.flat());
 function atom(schema:Schema,negative:boolean,path:string):Clause[]{
  if(schema===true||schema!==false&&Object.keys(schema).length===0)return negative?[]:[[]];
  if(schema===false)return negative?[[]]:[];
  return [[{schema,negative,path}]];
 }
 // 基本断言按 JSON Schema 语义拆分。additionalProperties 保留其所在对象的属性名作用域。
 function assertions(base:Record<string,any>,path:string):Array<{schema:Schema;path:string}>{
  if(Object.keys(base).some(key=>!basicKeys.has(key)))return [{schema:base,path}];
  return Object.entries(base).flatMap(([key,value])=>{
   if(key==='properties')return Object.entries(value).map(([name,schema])=>({schema:{properties:{[name]:schema}},path:path+'/properties/'+pointer(name)}));
   if(key==='required')return value.map((name:string)=>({schema:{required:[name]},path:path+'/required/'+pointer(name)}));
   if(key==='additionalProperties')return [{schema:{properties:Object.fromEntries(Object.keys(base.properties||{}).map(name=>[name,true])),additionalProperties:value},path:path+'/'+key}];
   return [{schema:{[key]:value},path:path+'/'+key}];
  });
 }
 function normalize(schema:Schema,negative=false,path='',depth=0):Clause[]{
  budget(depth);
  if(typeof schema==='boolean')return atom(schema,negative,path);
  const base=Object.fromEntries(Object.entries(schema).filter(([key])=>!operators.includes(key)));
  const pieces:Clause[][]=assertions(base,path).map(item=>atom(item.schema,negative,item.path));
  for(const op of operators){
   if(!Object.hasOwn(schema,op))continue;
   const value=schema[op],location=path+'/'+op;
   if(op==='not'){pieces.push(normalize(value,!negative,location,depth+1));continue;}
   if(!Array.isArray(value)||!value.length)throw Error('组合分支格式无效');
   if(op==='allOf'||op==='anyOf'){
    const children=value.map((child:Schema,i:number)=>normalize(child,negative,location+'/'+i,depth+1));
    pieces.push((op==='allOf')!==negative?every(children):some(children));
   }else if(!negative){
    pieces.push(some(value.map((_:Schema,i:number)=>every(value.map((child:Schema,j:number)=>normalize(child,i!==j,location+'/'+j,depth+1))))));
   }else{
    // 非 oneOf：零个分支匹配，或至少两个分支匹配。
    const choices=[every(value.map((child:Schema,i:number)=>normalize(child,true,location+'/'+i,depth+1)))];
    for(let i=0;i<value.length;i++)for(let j=i+1;j<value.length;j++)choices.push(and(normalize(value[i],false,location+'/'+i,depth+1),normalize(value[j],false,location+'/'+j,depth+1)));
    pieces.push(some(choices));
   }
  }
  return negative?some(pieces):every(pieces);
 }
 function allowedTypes(s:any):Set<string>{
  if(s===false)return new Set();if(s===true)return new Set(allTypes);
  let result=new Set<string>((s.type===undefined?allTypes:Array.isArray(s.type)?s.type:[s.type]).flatMap((t:string)=>t==='number'?['integer','fraction']:[t]));
  const finite=Object.hasOwn(s,'const')?[s.const]:s.enum;
  if(finite)result=new Set([...result].filter(type=>finite.some((value:any)=>valueType(value)===type)));
  return result;
 }
 /** 对正断言交集证明为空；未知约束只会减少实际值，忽略它们不会伪造空集。 */
 function emptyPositive(schemas:Schema[],depth=0):boolean{
  budget(depth);if(schemas.some(s=>s===false))return true;
  const objects=schemas.filter(s=>s!==true) as Record<string,any>[];
  let types=new Set(allTypes);
  for(const s of objects){const accepted=allowedTypes(s);types=new Set([...types].filter(t=>accepted.has(t)));}
  if(!types.size)return true;
  let finite:any[]|undefined;
  for(const s of objects){
   for(const values of [Object.hasOwn(s,'const')?[s.const]:undefined,s.enum])if(values)finite=finite===undefined?values:finite.filter(v=>values.some((w:any)=>same(v,w)));
  }
  if(finite&&!finite.some(v=>types.has(valueType(v))))return true;
  const lower=(key:string)=>Math.max(0,...objects.map(s=>s[key]??0));
  const upper=(key:string)=>Math.min(Infinity,...objects.map(s=>s[key]??Infinity));
  for(const type of types){
   if(type==='integer'||type==='fraction'){
    const lows=objects.flatMap(s=>[['minimum',false],['exclusiveMinimum',true]].filter(([k])=>s[k as string]!==undefined).map(([k,e])=>[s[k as string],e] as [number,boolean]));
    const highs=objects.flatMap(s=>[['maximum',false],['exclusiveMaximum',true]].filter(([k])=>s[k as string]!==undefined).map(([k,e])=>[s[k as string],e] as [number,boolean]));
    const lo=Math.max(-Infinity,...lows.map(x=>x[0])),hi=Math.min(Infinity,...highs.map(x=>x[0]));
    const exclusive=lows.some(x=>x[0]===lo&&x[1])||highs.some(x=>x[0]===hi&&x[1]);
    if(lo>hi||lo===hi&&exclusive)continue;
   }else if(type==='string'){
    if(lower('minLength')>upper('maxLength'))continue;
   }else if(type==='array'){
    if(lower('minItems')>upper('maxItems'))continue;
    if(lower('minItems')>0&&!objects.some(s=>s.prefixItems?.length)&&emptyPositive(objects.map(s=>s.items??true),depth+1))continue;
   }else if(type==='object'){
    const required=new Set<string>(objects.flatMap(s=>s.required||[]));
    if(Math.max(lower('minProperties'),required.size)>upper('maxProperties'))continue;
    if([...required].some(name=>emptyPositive(objects.map(s=>Object.hasOwn(s.properties||{},name)?s.properties[name]:Object.keys(s.patternProperties||{}).length?true:s.additionalProperties??true),depth+1)))continue;
   }
   return false;
  }
  return true;
 }
 function dead(clause:Clause){
  const positive=clause.filter(l=>!l.negative).map(l=>l.schema),negative=clause.filter(l=>l.negative).map(l=>l.schema);
  return emptyPositive(positive)||positive.some(a=>negative.some(b=>includes(a,b)));
 }
 function entails(clause:Clause,literal:Literal):boolean{
  budget();
  if(clause.some(other=>other.negative===literal.negative&&same(other.schema,literal.schema)))return true;
  const positive=clause.filter(l=>!l.negative).map(l=>l.schema);
  if(!literal.negative)return positive.some(s=>includes(s,literal.schema));
  return clause.some(other=>other.negative&&includes(literal.schema,other.schema))||emptyPositive([...positive,literal.schema]);
 }
 try{
  const left=normalize(source),right=normalize(target);
  for(const clause of left){
   if(dead(clause))continue;
   let nearest:Literal[]|undefined;
   const found=right.some(candidate=>{
    const missing=candidate.filter(literal=>!entails(clause,literal));
    if(nearest===undefined||missing.length<nearest.length)nearest=missing;
    return missing.length===0;
   });
   if(!found)return {compatible:false,issues:(nearest?.length?nearest:[{path:'',negative:false}]).slice(0,8).map(item=>({path:item.path,reason:item.negative?'无法证明组合分支的排他或否定条件':'无法证明所有原有值均被目标组合结构接受'}))};
  }
  return {compatible:true,issues:[]};
 }catch(error){return {compatible:false,issues:[{path:'',reason:(error as Error).message}]};}
}
