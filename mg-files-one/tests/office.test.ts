import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { FilesStore, FilesError } from '../server/store.ts';
import { OfficeService, signOffice, verifyOffice, officeFormat } from '../server/office.ts';
const secret='office-test-secret-'.repeat(3);
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as any).port}`}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
test('签名固定算法、有效期与篡改检查',()=>{const token=signOffice({exp:Date.now()/1000+60,scope:'document-read'},secret);assert.equal(verifyOffice(token,secret).scope,'document-read');assert.throws(()=>verifyOffice(token+'x',secret),/签名/);assert.throws(()=>verifyOffice(signOffice({exp:1},secret),secret),/过期/);assert.throws(()=>verifyOffice('eyJhbGciOiJub25lIn0.e30.',secret));assert.equal(officeFormat('report.XLSX')?.editable,true);assert.equal(officeFormat('old.ppt')?.editable,false);assert.equal(officeFormat('script.html'),undefined)});
test('编辑文件原子保存、旧版本保护、配额和身份隔离',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'office-store-'));try{
 const store=new FilesStore(dir,64,100);await store.initialize();await store.ensureOwner('a');await store.ensureOwner('b');
 const file=await store.upload('a',store.root('a').id,'test.docx',4,Readable.from(Buffer.from('PK\x03\x04')));
 await assert.rejects(store.replaceContent('b',file.id,1,Buffer.from('different')),/不存在/);
 const saved=await store.replaceContent('a',file.id,1,Buffer.from('updated'));assert.equal(saved.version,2);assert.equal(saved.size,7);
 await assert.rejects(store.replaceContent('a',file.id,1,Buffer.from('stale')),/已更新/);
 await assert.rejects(store.replaceContent('a',file.id,2,Buffer.alloc(65)),/超过/);
 assert.equal((await readFile(join(dir,'objects',store.get('a',file.id).storageKey!))).toString(),'updated');
 await store.remove('a',file.id,2);await assert.rejects(store.replaceContent('a',file.id,3,Buffer.from('resurrect')),/不存在/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('签名回调完成持久保存，拒绝伪造、外部来源、只读与其他用户',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'office-integration-'));let service:OfficeService;
 const content=Buffer.from('PK\x03\x04saved-office-test');
 const engine=createServer((req,res)=>{if(req.url?.startsWith('/cache/files/')){res.end(content);return}res.setHeader('Content-Type','application/json');res.end('{"error":0}')});
 const endpoint=createServer(async(req,res)=>{try{if(!await service.integration(req,res,new URL(req.url||'/','http://localhost')))res.writeHead(404).end()}catch(e){res.writeHead(e instanceof FilesError?e.status:500).end()}});
 try{
 const engineUrl=await listen(engine),base=await listen(endpoint),store=new FilesStore(dir,100,1000);await store.initialize();await store.ensureOwner('a');
 const file=await store.upload('a',store.root('a').id,'demo.docx',4,Readable.from(Buffer.from('PK\x03\x04')));
 service=new OfficeService(store,{secret,publicUrl:'https://office.example/office-engine',internalUrl:engineUrl,callbackBase:base});await service.initialize();
 const opened=await service.open('a',file.id,'甲','edit');const cfg=opened.config;
 assert(store.get('a',file.id).officeAccessedAt);assert.equal(store.get('a',file.id).version,file.version);assert.equal(store.get('a',file.id).updatedAt,file.updatedAt);
 await assert.rejects(service.open('b',file.id,'乙','view'),/不存在/);
 const persisted=new FilesStore(dir,100,1000);await persisted.initialize();assert.equal(persisted.get('a',file.id).officeAccessedAt,store.get('a',file.id).officeAccessedAt);
 assert.equal((await fetch(cfg.document.url)).status,200);assert.throws(()=>service.status('b',opened.sessionId),/不存在/);
 const again=await service.open('a',file.id,'甲','edit');assert.equal(again.config.document.key,cfg.document.key);
 async function callback(payload:object,token=signOffice(payload,secret)){return fetch(cfg.editorConfig.callbackUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,token})})}
 const valid={key:cfg.document.key,status:6,url:`${engineUrl}/cache/files/${cfg.document.key}/output.docx`};
 const saving=await service.save('a',opened.sessionId);assert.equal(saving.queued,true);assert(!service.status('a',opened.sessionId).savedRequests.includes(saving.requestId));
 assert.equal((await callback(valid,'invalid')).status,403);
 assert.equal((await callback({...valid,url:'http://evil.invalid/cache/files/abc'})).status,403);
 assert.equal((await callback({...valid,key:'different'})).status,403);
 assert.equal((await callback(valid)).status,200);assert.equal(store.get('a',file.id).version,2);assert.equal((await readFile(join(dir,'objects',store.get('a',file.id).storageKey!))).toString(),content.toString());
 assert.equal((await callback(valid)).status,200);assert.equal(store.get('a',file.id).version,2,'重复强制保存不增加版本');
 assert.equal((await callback({...valid,url:`https://office.example/office-engine/cache/files/${cfg.document.key}/output.docx`,userdata:saving.requestId})).status,200);
 assert(service.status('a',opened.sessionId).savedRequests.includes(saving.requestId));
 assert.equal((await callback({...valid,url:'https://office.example/office-engine-extra/cache/files/output.docx'})).status,403);
 const fresh=new OfficeService(store,{secret,publicUrl:engineUrl,internalUrl:engineUrl,callbackBase:base});await fresh.initialize();assert.equal(fresh.status('a',opened.sessionId).version,2);
 await store.patch('a',file.id,{name:'renamed.docx',version:2});
 const changed={...valid,url:`${engineUrl}/cache/files/${cfg.document.key}/other.docx`};
 // 相同字节的重复回调不会覆盖名称，也不会回退版本。
 assert.equal((await callback(changed)).status,200);assert.equal(store.get('a',file.id).name,'renamed.docx');
 const readOnly=await service.open('a',file.id,'甲','view');const ro={key:readOnly.config.document.key,status:6,url:valid.url};
 assert.equal((await fetch(readOnly.config.editorConfig.callbackUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:signOffice(ro,secret)})})).status,409);
 }finally{await close(endpoint);await close(engine);await rm(dir,{recursive:true,force:true})}
});
