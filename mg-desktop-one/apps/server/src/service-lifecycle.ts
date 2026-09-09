import type {Publication,VersionLifecycle} from './service-storage';

export const lifecycleKey=(serviceId:string,version:string)=>serviceId+'@'+version;
// 历史数据缺少生命周期元数据时保留已发布语义，不让升级撤销既有出口。
export const historicalLifecycle=(p:Publication):VersionLifecycle=>({status:'published',revision:0,reason:'历史登记版本',at:p.at,actor:p.actor});
export function validRetirementDate(value:unknown):value is string {
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function validateLifecycle(value:VersionLifecycle){
 if(!value||!['draft','published','deprecated','retired'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.reason!=='string'||value.reason.length>2000||typeof value.actor!=='string'||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at))||value.retireAfter!==undefined&&!validRetirementDate(value.retireAfter))throw Error('服务版本生命周期格式无效');
}
