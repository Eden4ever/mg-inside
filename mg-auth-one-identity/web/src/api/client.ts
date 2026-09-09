import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { desktop, usesDesktopAuthentication } from '../desktop';
import { applicationPresentation } from '@mg-inside/frontend';
export interface SessionUser {userId:string;username:string|null;name:string;departmentName:string|null;role:string;authSource:string;identityAuthorized?:boolean;roles?:Array<{id:string;key:string|null;name:string}>}
export interface ManagedUser {id:string;username:string|null;displayName:string;departmentName:string|null;role:string;roles?:Array<{id:string;key:string|null;name:string}>;status:string;lastLoginAt:string|null;createdAt:string;updatedAt:string;wecomBound:boolean;wecomIdentities:Array<{id:string;externalUserId:string}>;zentaoIdentities?:Array<{id:string;account:string;server:string}>}
export interface Application {clientId:string;name:string;enabled:boolean;foundation:boolean;memberships:Array<{userId:string;localUserId:string|null;enabled:boolean}>}
export interface MyApplication {clientId:string;name:string;url:string|null}
export interface ManagedRole {id:string;key:string|null;name:string;description:string;members:Array<{userId:string}>;applications:Array<{clientId:string;enabled:boolean}>}
export interface ApplicationAccess {clientId:string;name:string;enabled:boolean;direct:boolean;localUserId:string|null;effective:boolean;foundation:boolean;sources:Array<{type:'user'|'role';roleId?:string;name?:string}>}
export interface AccountSecurityState {recentRecovery?:boolean;mfaEnabled:boolean;methods:string[];email:string|null;totpBound:boolean;keys:Array<{id:string;name:string;createdAt:string;lastUsedAt:string|null}>}
export interface MailSettings {enabled:boolean;host:string;port:number;security:'tls'|'starttls';username:string;fromAddress:string;fromName:string;revision:number;hasPassword:boolean}
let csrfToken='';
export function setCsrf(token:string){csrfToken=token}
export class ApiError extends Error {constructor(message:string,public status:number){super(message)}}
export async function request<T=any>(path:string,options:RequestInit={}):Promise<T>{
  let response:Response;
  const end=options.method&&!['GET','HEAD'].includes(options.method)?desktop.beginRequest():()=>{};
  try{response=await fetch(`${usesDesktopAuthentication?desktop.apiBase:'/api'}${path}`,{...options,credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken,...options.headers}})}catch{throw new ApiError('无法连接统一认证服务，请稍后重试。',0)}finally{end()}
  const data=response.status===204?{}:await response.json();
  if(!response.ok){if(response.status===401&&!path.startsWith('/auth/'))window.dispatchEvent(new Event('identity-expired'));throw new ApiError(Array.isArray(data.message)?data.message.join('；'):data.message||'操作失败',response.status)}
  return data;
}
export const send=<T=any>(path:string,body:unknown,method='POST')=>request<T>(path,{method,body:JSON.stringify(body)});
export const api = {
  users:()=>request<ManagedUser[]>('/users'), applications:async()=> (await request<Application[]>('/applications')).map(app => ({ ...app, name: applicationPresentation(app.clientId)?.name || app.name })), myApplications:()=>request<MyApplication[]>('/applications/mine'),
  createUser:(body:unknown)=>send<ManagedUser>('/users',body), updateUser:(id:string,body:unknown)=>send<ManagedUser>(`/users/${encodeURIComponent(id)}`,body,'PATCH'),
  grant:(client:string,user:string,localUserId:string|null,enabled:boolean)=>send(`/applications/${encodeURIComponent(client)}/users/${encodeURIComponent(user)}`,{localUserId,enabled},'PUT'),
  userApplications:async(id:string)=>(await request<ApplicationAccess[]>(`/applications/users/${encodeURIComponent(id)}`)).map(app => ({ ...app, name: applicationPresentation(app.clientId)?.name || app.name })),
  roles:()=>request<ManagedRole[]>('/roles'),
  createRole:(body:{name:string;description:string})=>send<ManagedRole>('/roles',body),
  updateRole:(id:string,body:{name:string;description:string})=>send<ManagedRole>(`/roles/${encodeURIComponent(id)}`,body,'PATCH'),
  deleteRole:(id:string)=>send(`/roles/${encodeURIComponent(id)}`,{},'DELETE'),
  roleMember:(id:string,userId:string,enabled:boolean)=>send(`/roles/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,{enabled},'PUT'),
  roleGrant:(id:string,clientId:string,enabled:boolean)=>send(`/roles/${encodeURIComponent(id)}/applications/${encodeURIComponent(clientId)}`,{enabled},'PUT'),
  userRoles:(userId:string,roleIds:string[])=>send(`/roles/users/${encodeURIComponent(userId)}`,{roleIds},'PUT'),
  changePassword:(currentPassword:string,newPassword:string)=>send('/auth/change-password',{currentPassword,newPassword}),
  accountSecurity:()=>request<AccountSecurityState>('/account-security'),
  authorizeSecurity:(password:string,code?:unknown,method?:string)=>send<{token:string}>('/account-security/authorize',{password,code,method}),
  securityKeyOptions:()=>send<PublicKeyCredentialRequestOptionsJSON>('/account-security/authorize/key',{}),
  mfaKeyOptions:()=>send<PublicKeyCredentialRequestOptionsJSON>('/auth/mfa/key',{}),
  startKeyBinding:(token:string,name:string)=>send<{token:string;options:PublicKeyCredentialCreationOptionsJSON}>('/account-security/key/start',{token,name}),
  confirmKeyBinding:(token:string,response:unknown)=>send<{ok:boolean}>('/account-security/key/confirm',{token,response}),
  removeKeyBinding:(token:string,id:string)=>send('/account-security/key/remove',{token,id}),
  sendSecurityEmail:()=>send('/account-security/authorize/email',{}),
  startEmailBinding:(token:string,address:string)=>send<{token:string}>('/account-security/email/start',{token,address}),
  confirmEmailBinding:(token:string,code:string)=>send<{ok:boolean}>('/account-security/email/confirm',{token,code}),
  removeEmailBinding:(token:string)=>send('/account-security/email/remove',{token}),
  sendMfaEmail:()=>send('/auth/mfa/email',{}),
  startTotp:(token:string)=>send<{token:string;secret:string;uri:string}>('/account-security/totp/start',{token}),
  confirmTotp:(token:string,code:string)=>send<{ok:boolean}>('/account-security/totp/confirm',{token,code}),
  removeTotp:(token:string)=>send('/account-security/totp/remove',{token}),
  setMfa:(token:string,enabled:boolean,methods:string[])=>send<{enabled:boolean;recoveryCodes:string[]}>('/account-security/mfa',{token,enabled,methods}),
  mailSettings:()=>request<MailSettings>('/mail-settings'),
  saveMailSettings:(input:Omit<MailSettings,'hasPassword'>&{password?:string})=>send<MailSettings>('/mail-settings',input,'PUT'),
  testMailSettings:(to:string)=>send<{ok:boolean;message:string}>('/mail-settings/test',{to}),
};
