import type {ServiceManifest,ServiceOperation} from './contracts';
export interface ServiceChange {operationId:string;kind:'added'|'removed'|'changed';breaking:boolean;description:string}
/** 只比较当前清单声明的操作；参数和返回值契约另行校验。 */
export function compareServiceVersions(before:ServiceManifest|undefined,after:ServiceManifest):ServiceChange[]{
  const changes:ServiceChange[]=[];
  for(const operation of before?.operations||[]){
    const next=after.operations.find(value=>value.operationId===operation.operationId);
    if(!next)changes.push({operationId:operation.operationId,kind:'removed',breaking:true,description:`移除 ${operation.method} ${operation.path}`});
    else if(operation.method!==next.method||operation.path!==next.path||operation.effect!==next.effect)changes.push({operationId:operation.operationId,kind:'changed',breaking:true,description:`${operation.method} ${operation.path} → ${next.method} ${next.path}`});
    else if(operation.summary!==next.summary)changes.push({operationId:operation.operationId,kind:'changed',breaking:false,description:'更新接口说明'});
  }
  for(const operation of after.operations)if(!before?.operations.some(value=>value.operationId===operation.operationId))changes.push({operationId:operation.operationId,kind:'added',breaking:false,description:`新增 ${operation.method} ${operation.path}`});
  return changes;
}
export function operationRoutesOverlap(left:ServiceOperation,right:ServiceOperation){
  if(left.method!==right.method)return false;
  const a=left.path.split('/'),b=right.path.split('/');
  return a.length===b.length&&a.every((part,index)=>part===b[index]||/^\{\w+\}$/.test(part)||/^\{\w+\}$/.test(b[index]!));
}
