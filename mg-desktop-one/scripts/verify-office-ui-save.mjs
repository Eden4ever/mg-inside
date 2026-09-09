import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const [id,marker,cleanup]=process.argv.slice(2);
assert(/^[0-9a-f-]{36}$/.test(id||'')&&/^OFFICE-[A-Z0-9-]+$/.test(marker||''));
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const issuer='http://127.0.0.1:14200',origin='http://127.0.0.1:4301';
const login=await fetch(issuer+'/api/auth/login',{method:'POST',headers:{origin:issuer,'content-type':'application/json'},body:JSON.stringify(account)});
assert.equal(login.status,200);const cookie=login.headers.getSetCookie().find(v=>v.startsWith('mg_identity_session=')).split(';')[0];const profile=await login.json();
const headers={cookie:'mg_desktop_token='+cookie.slice(cookie.indexOf('=')+1)};
try{
 const entryPath=origin+'/api/services/apps/files/entries/'+id;
 const response=await fetch(entryPath,{headers});assert.equal(response.status,200);const file=await response.json();assert(file.name.startsWith('未命名文档'));assert(file.version>1);
 const download=await fetch(entryPath+'/content',{headers});assert.equal(download.status,200);const artifact=resolve(`.runtime/office-contract-ui-${id}.docx`);await writeFile(artifact,Buffer.from(await download.arrayBuffer()));
 const verified=spawnSync('python',['-c','import sys,zipfile; assert sys.argv[2] in zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode(); print("Office document marker verified")',artifact,marker],{encoding:'utf8',windowsHide:true});assert.equal(verified.status,0,verified.stderr);
 console.log(JSON.stringify({fileId:id,version:file.version,markerPersisted:true,artifact}));
 if(cleanup==='--cleanup'){
  const session=await (await fetch(origin+'/api/session',{headers})).json();
  for(const suffix of ['','/permanent'])assert.equal((await fetch(entryPath+suffix,{method:'DELETE',headers:{...headers,origin,'content-type':'application/json','x-csrf-token':session.csrfToken},body:'{}'})).status,200);
  console.log('已清理本轮创建的本地测试文档');
 }
}finally{await fetch(issuer+'/api/auth/logout',{method:'POST',headers:{cookie,origin:issuer,'x-csrf-token':profile.csrfToken,'content-type':'application/json'},body:'{}'});}
