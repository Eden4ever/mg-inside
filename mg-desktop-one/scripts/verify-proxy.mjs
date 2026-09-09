import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const env=parseEnv(await readFile('.runtime/local/desktop.env','utf8'));
const login=await fetch(`${env.IDENTITY_ISSUER}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:env.IDENTITY_ISSUER},body:JSON.stringify(account)});
assert.equal(login.status,200);
const identityCookie=login.headers.getSetCookie().find(v=>v.startsWith('mg_identity_session=')).split(';')[0];
const token=identityCookie.slice('mg_identity_session='.length), session=await login.json();
let cancelled=false, calls=0;
const upstream=createServer(async(req,res)=>{
  calls++; assert.equal(req.headers.authorization,`Bearer ${token}`);assert.equal(req.headers.cookie,undefined);assert.equal(req.headers['x-user-id'],undefined);
  if(req.url==='/api/stream'){
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"step":1}\n\n');
    const timer=setInterval(()=>res.write('data: {"step":2}\n\n'),25);
    res.on('close',()=>{cancelled=true;clearInterval(timer)});return;
  }
  if(req.url==='/api/download'){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="export.bin"','set-cookie':'business_session=forbidden'});res.end(Buffer.from([0,1,2,255]));return}
  let bytes=[];for await(const chunk of req)bytes.push(chunk);
  res.writeHead(200,{'content-type':req.headers['content-type']||'application/json'});
  res.end(bytes.length?Buffer.concat(bytes):'{}');
});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const temp=createServer();await new Promise(resolve=>temp.listen(0,'127.0.0.1',resolve));const port=temp.address().port;await new Promise(resolve=>temp.close(resolve));
const origin=`http://127.0.0.1:${port}`;
await mkdir('.runtime/proxy',{recursive:true}); const runtime=await mkdtemp('.runtime/proxy/run-');
const server=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/server/src/main.ts'],{env:{...process.env,...env,PORT:String(port),DESKTOP_RUNTIME_DIR:runtime,DESKTOP_ORIGIN:origin,TOKEN_API_URL:`http://127.0.0.1:${upstream.address().port}/api`},stdio:['ignore','pipe','pipe'],windowsHide:true});
const headers={cookie:`mg_desktop_token=${token}`,origin,'x-csrf-token':session.csrfToken};
try{
  let ready=false;for(let i=0;i<60;i++){try{ready=(await fetch(`${origin}/api/health`)).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
  assert.equal((await fetch(`${origin}/api/session`)).status,401);
  assert.equal((await fetch(`${origin}/api/session`,{headers:{...headers,origin:'https://untrusted.invalid'}})).status,403);
  const before=calls;
  assert.equal((await fetch(`${origin}/api/apps/token-one/upload`,{method:'POST',headers:{cookie:headers.cookie,origin},body:'denied'})).status,401);assert.equal(calls,before);
  const form=new FormData();form.append('file',new Blob([new Uint8Array([0,1,2,255])]),'材料.bin');
  const upload=await fetch(`${origin}/api/apps/token-one/upload`,{method:'POST',headers:{...headers,'x-user-id':'forged'},body:form});assert.equal(upload.status,200);
  const uploaded=Buffer.from(await upload.arrayBuffer());assert.ok(uploaded.includes(Buffer.from([0,1,2,255])));assert.ok(uploaded.toString().includes('filename='));
  const download=await fetch(`${origin}/api/apps/token-one/download`,{headers});assert.equal(download.status,200);assert.equal(download.headers.get('set-cookie'),null);assert.ok(download.headers.get('content-disposition').includes('export.bin'));assert.deepEqual([...new Uint8Array(await download.arrayBuffer())],[0,1,2,255]);
  const controller=new AbortController();const stream=await fetch(`${origin}/api/apps/token-one/stream`,{headers,signal:controller.signal});const reader=stream.body.getReader();
  assert.ok(new TextDecoder().decode((await reader.read()).value).includes('step'));controller.abort();
  for(let i=0;i<30&&!cancelled;i++)await new Promise(r=>setTimeout(r,20));assert.equal(cancelled,true);
  const put=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({theme:'dark',pinned:['token-one','unregistered'],restore:false})});assert.equal(put.status,200);assert.deepEqual((await put.json()).pinned,['token-one']);
  assert.equal((await fetch(`${origin}/api/session`,{headers})).status,200);
  // 仅撤销本脚本新建的测试会话，不影响内部浏览器。
  assert.equal((await fetch(`${origin}/auth/logout`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}'})).status,200);
  assert.equal((await fetch(`${origin}/api/apps/token-one/download`,{headers})).status,401);
  await mkdir('.runtime/proxy',{recursive:true});await writeFile('.runtime/proxy/verification.json',JSON.stringify({passed:true,checks:['精确来源校验','未登录拒绝','CSRF 拒绝','同令牌转发与身份头隔离','原始 multipart 上传','二进制下载','业务 Cookie 不透传','SSE 即时传送与断连取消','偏好白名单','退出后业务拒绝']},null,2));
  console.log('统一 API 代理：上传、下载、流式取消、来源/CSRF、同令牌与退出验证通过。');
}finally{
  server.kill();await once(server,'exit');upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
  await fetch(`${env.IDENTITY_ISSUER}/api/auth/logout`,{method:'POST',headers:{cookie:identityCookie,origin:env.IDENTITY_ISSUER,'x-csrf-token':session.csrfToken,'content-type':'application/json'},body:'{}'});
}
