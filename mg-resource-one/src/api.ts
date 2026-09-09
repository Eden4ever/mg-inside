import {createDesktopApplication,createPlatformSession,createApplicationClient,defaultPlatformOrigin} from '@mg-inside/frontend';
export const desktop=createDesktopApplication({appId:'resource-manager',origin:import.meta.env.VITE_DESKTOP_ORIGIN||defaultPlatformOrigin(),formProtection:false});
const session=createPlatformSession({origin:desktop.origin,onExpired:()=>desktop.login()});
const client=createApplicationClient({origin:desktop.origin,appId:'resource-manager',session,onExpired:()=>desktop.login(),beginRequest:()=>desktop.beginRequest()});
export function api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{return client.request<T>(path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)}),signal})}
