import { defaultPlatformOrigin, createDesktopApplication, createPlatformSession,createApplicationClient } from '@mg-inside/frontend';
export const desktop = createDesktopApplication({ appId:'office-one', origin:import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin(), formProtection:false });
export const session = createPlatformSession({origin:desktop.origin,onExpired:()=>desktop.login()});
const client=createApplicationClient({origin:desktop.origin,appId:'office-one',session,onExpired:()=>desktop.login(),beginRequest:()=>desktop.beginRequest()});
export function api<T>(path:string, body?:unknown):Promise<T>{return client.request<T>(path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})})}
export interface OfficeFile {id:string;name:string;size:number;version:number;updatedAt:string;officeAccessedAt?:string;}
export interface OfficeDocument extends OfficeFile {editable:boolean;}
export interface EditorSession { sessionId:string; file:OfficeFile; mode:'edit'|'view'; documentServerUrl:string; config:Record<string,unknown>; }
