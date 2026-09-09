import {readFile} from 'node:fs/promises';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const login=await fetch('http://127.0.0.1:14200/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:14200'},body:JSON.stringify(account)});
const cookie=login.headers.getSetCookie().find(v=>v.startsWith('mg_identity_session='));
if(!cookie)throw new Error('本地测试认证未完成');
const token=cookie.split(';')[0].split('=')[1];
try {
  for(const path of ['/api/session','/api/apps/identity/auth/me','/api/apps/token-one/auth/me','/api/apps/expert-database/auth/me','/api/apps/expert-database/systems']){
    const response=await fetch('http://127.0.0.1:4301'+path,{headers:{cookie:`mg_desktop_token=${token}`}});
    const data=await response.json(); console.log(JSON.stringify({path,status:response.status,message:data.message,user: data.user?{name:data.user.name,role:data.user.role}:undefined}));
  }
}finally{
  const me=await login.json();await fetch('http://127.0.0.1:14200/api/auth/logout',{method:'POST',headers:{cookie:cookie.split(';')[0],origin:'http://127.0.0.1:14200','x-csrf-token':me.csrfToken,'content-type':'application/json'},body:'{}'});
}
