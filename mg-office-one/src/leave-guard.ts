export interface OfficeLeaveState {dirty:boolean;busy:boolean}
/** 多个关闭/导航入口共用一次确认；保存期间不能销毁编辑器。 */
export function createOfficeLeaveGuard(state:()=>OfficeLeaveState,confirmDiscard:()=>Promise<boolean>){
  let pending:Promise<boolean>|undefined;
  return function canLeave():Promise<boolean>{
    if(state().busy)return Promise.resolve(false);
    if(!state().dirty)return Promise.resolve(true);
    if(!pending)pending=confirmDiscard().then(confirmed=>confirmed&&!state().busy).catch(()=>false).finally(()=>{pending=undefined});
    return pending;
  };
}
