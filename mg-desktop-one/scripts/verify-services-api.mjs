import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const issuer='http://127.0.0.1:14200',origin='http://127.0.0.1:4301';
const login=await fetch(issuer+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:issuer},body:JSON.stringify(account)});
const c=login.headers.getSetCookie().find(v=>v.startsWith('mg_identity_session='));assert(c,'本地身份登录失败');
const cookie=c.split(';')[0],token=cookie.split('=')[1],profile=await login.json();
const headers={cookie:'mg_desktop_token='+token};
try{
 const desktopSession=await (await fetch(origin+'/api/session',{headers})).json();
 const preferenceHeaders={...headers,'x-desktop-account':desktopSession.user.id};
 const before=await (await fetch(origin+'/api/preferences',{headers:preferenceHeaders})).json();
 const staleHeaders={...headers,origin,'content-type':'application/json','x-csrf-token':desktopSession.csrfToken,'x-desktop-account':'another-account'};
 for(const method of ['GET','PUT']){
  const denied=await fetch(origin+'/api/preferences',{method,headers:staleHeaders,...(method==='PUT'?{body:JSON.stringify({applicationOrder:['office-one']})}:{})});
  assert.equal(denied.status,409);assert.equal((await denied.json()).code,'ACCOUNT_CHANGED');
 }
 assert.deepEqual(await (await fetch(origin+'/api/preferences',{headers:preferenceHeaders})).json(),before);
 const fileBase=origin+'/api/services/apps/files';
 const fileRoot=await (await fetch(fileBase+'/entries',{headers})).json();
 const fileHeaders={...headers,origin,'x-csrf-token':desktopSession.csrfToken};
 const marker='MG-SERVICE-FILES-'+Date.now();let fileId;
 try{
  const uploaded=await fetch(fileBase+'/uploads?parentId='+fileRoot.rootId+'&name='+marker+'.txt',{method:'POST',headers:fileHeaders,body:marker});assert.equal(uploaded.status,201);fileId=(await uploaded.json()).id;
  const download=await fetch(fileBase+'/entries/'+fileId+'/content',{headers});assert.equal(download.status,200);assert.equal(download.headers.get('x-service-id'),'files.api');assert.equal(await download.text(),marker);
  assert.equal((await fetch(fileBase+'/entries/'+fileId+'/access',{method:'POST',headers:{...fileHeaders,'content-type':'application/json'},body:'{}'})).status,200);
  const recent=await (await fetch(fileBase+'/entries?view=recent',{headers})).json();assert(recent.items.some(item=>item.id===fileId));
 }finally{
  if(fileId){for(const suffix of ['', '/permanent'])assert.equal((await fetch(fileBase+'/entries/'+fileId+suffix,{method:'DELETE',headers:{...fileHeaders,'content-type':'application/json'},body:'{}'})).status,200)}
 }
 let officeId;
 try{
  const officeBase=origin+'/api/services/apps/office-one';
  const created=await fetch(officeBase+'/documents',{method:'POST',headers:{...fileHeaders,'content-type':'application/json'},body:JSON.stringify({format:'docx'})});assert.equal(created.status,201);const file=await created.json();officeId=file.id;
  const opened=await fetch(officeBase+'/documents/'+officeId+'/open',{method:'POST',headers:{...fileHeaders,'content-type':'application/json'},body:JSON.stringify({mode:'view'})});assert.equal(opened.status,200);
  const recent=await (await fetch(officeBase+'/documents?view=recent',{headers})).json();const item=recent.items.find(item=>item.id===officeId);assert(item?.officeAccessedAt);assert.equal(item.updatedAt,file.updatedAt);assert.equal(item.version,file.version);
 }finally{if(officeId){for(const suffix of ['', '/permanent'])assert.equal((await fetch(fileBase+'/entries/'+officeId+suffix,{method:'DELETE',headers:{...fileHeaders,'content-type':'application/json'},body:'{}'})).status,200)}}
 assert.equal((await fetch(origin+'/api/service-registry')).status,401);
 const catalog=await fetch(origin+'/api/service-registry',{headers});assert.equal(catalog.status,200);const catalogData=await catalog.json();assert.equal(new Set(catalogData.items.map(item=>item.manifest.serviceId)).size,6);
 const activeService=catalogData.items.find(item=>item.active);
 const activationHeaders={...headers,origin,'content-type':'application/json','x-csrf-token':desktopSession.csrfToken};
 const activation={serviceId:activeService.manifest.serviceId,version:activeService.manifest.version,expectedRevision:activeService.activeRevision};
 assert.equal((await fetch(origin+'/api/service-registry/activation',{method:'POST',headers:activationHeaders,body:JSON.stringify({...activation,expectedRevision:activation.expectedRevision+1})})).status,409);
 const unchanged=await fetch(origin+'/api/service-registry/activation',{method:'POST',headers:activationHeaders,body:JSON.stringify(activation)});assert.equal(unchanged.status,200);assert.equal((await unchanged.json()).duplicate,true);
 const r=await fetch(origin+'/api/services/invoke/resource-manager.api/overview',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('x-service-id'),'resource-manager.api');assert.equal((await r.json()).resources.length,2);
 assert.equal((await fetch(origin+'/api/services/apps/files/not-registered',{headers})).status,404);
 assert.equal((await fetch(origin+'/api/services/invoke/files.api/get?path.id=..%2Fsecret',{headers})).status,400);
 assert.equal((await fetch(origin+'/api/services/invoke/files.api/get?path.id=test',{headers,method:'POST'})).status,405);
 assert.equal((await fetch(origin+'/api/service-registry/publications',{headers:{...headers,origin,'content-type':'application/json'},method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(origin+'/api/services/apps/office-one/documents',{headers:{...headers,origin,'content-type':'application/json'},method:'POST',body:'{}'})).status,401);
 console.log('账户切换偏好读写拒绝且原数据不变；真实登录、目录、真实上游、匿名拒绝、路径拒绝、方法约束与 CSRF 均通过');
}finally{await fetch(issuer+'/api/auth/logout',{method:'POST',headers:{cookie,origin:issuer,'x-csrf-token':profile.csrfToken,'content-type':'application/json'},body:'{}'})}
