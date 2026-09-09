import type {ServiceManifest} from './contracts';
export interface ServiceContract {openapi:string;info:{title:string;version:string;description?:string};paths:Record<string,Record<string,any>>;components?:Record<string,Record<string,any>>;[key:string]:any}
export function canonicalJson(value:any):string {
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function contractOperation(doc:ServiceContract|undefined,operation:ServiceManifest['operations'][number]){
  const item=doc?.paths[operation.path],op=item?.[operation.method.toLowerCase()];
  return op?{...op,parameters:[...(item?.parameters||[]),...(op.parameters||[])]}:undefined;
}
export function contractReference(doc:ServiceContract,value:any){
  const visited=new Set<string>();
  while(value?.$ref){const ref=value.$ref;if(visited.has(ref))return value;visited.add(ref);value=ref.slice(2).split('/').reduce((node:any,key:string)=>node?.[key],doc);}
  return value;
}
export interface ContractChange {operationId:string;description:string;requiresReview:boolean;path?:string;assessment?:'compatible'|'review'|'baseline'}
export {compareContractVersions} from './contract-comparison';
