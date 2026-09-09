import type {ServiceManifest} from '../../../../mg-platform/packages/frontend/services/contracts';
import type {ServiceContract} from '../../../../mg-platform/packages/frontend/services/openapi';
import type {ServiceBinding} from './service-deployments';

export type Publication = {manifest:ServiceManifest;digest:string;at:string;actor:string;contract?:ServiceContract;contractDigest?:string};
export type VersionLifecycle = {status:'draft'|'published'|'deprecated'|'retired';revision:number;reason:string;at:string;actor:string;retireAfter?:string};
export type RegistryTransactionContext = {environment:string;activeBindings:Array<{environment:string;serviceId:string;version:string}>};
export type Activity = {id:string;at:string;serviceId:string;operationId:string;actor:string;status:number;durationMs:number};
export type RegistryState = {schemaVersion:1;revisions?:Record<string,number>;bindings?:Record<string,ServiceBinding>;lifecycles?:Record<string,VersionLifecycle>;publications:Publication[];active:Record<string,string|null>;audit:Array<{id:string;at:string;actor:string;action:string;serviceId:string;version:string;binding?:ServiceBinding;previousBinding?:ServiceBinding;lifecycle?:VersionLifecycle;previousLifecycle?:VersionLifecycle;environment?:string}>;activity:Activity[]};
export interface RegistryPersistence {
 read(options?:{allowCache?:boolean}):Promise<RegistryState>;
 transaction<T>(change:(state:RegistryState,context?:RegistryTransactionContext)=>{state:RegistryState;value:T}|Promise<{state:RegistryState;value:T}>):Promise<{state:RegistryState;value:T}>;
 close():Promise<void>;
}
