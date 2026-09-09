import { ref } from 'vue';
import { request, send, setCsrf, type SessionUser, ApiError } from './api/client';
export const user=ref<SessionUser|null>(null);
let initialized=false;
export async function loadSession(force=false){
  if(initialized&&!force)return;
  try{const result=await request<{user:SessionUser;csrfToken:string}>('/auth/me');user.value=result.user;setCsrf(result.csrfToken);initialized=true}
  catch(error){if(error instanceof ApiError&&error.status===401){user.value=null;setCsrf('');initialized=true}else throw error}
}
export function acceptLogin(result:{user:SessionUser;csrfToken:string}){user.value=result.user;setCsrf(result.csrfToken);initialized=true}
export async function logout(){await send('/auth/logout',{});user.value=null;setCsrf('');initialized=false;sessionStorage.removeItem('identity-interaction')}
export function clearSession(){user.value=null;initialized=false;setCsrf('')}
