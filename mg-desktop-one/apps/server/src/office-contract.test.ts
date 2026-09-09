import {createServer,type Server} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {it,expect,vi} from 'vitest';
import {FilesStore} from '../../../../mg-files-one/server/store';
import {createFilesServer} from '../../../../mg-files-one/server/http';
import {signOffice,verifyOffice} from '../../../../mg-files-one/server/office';
import {validateContract,responseValidator} from './service-contracts';

async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as any).port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
it('Office 六个公共操作通过真实 HTTP 验证，保存以签名回调落盘为准并保持账户隔离',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'office-contract-'));let server:Server|undefined,engine:Server|undefined;
 try{
  const {manifest,contract}=JSON.parse(await readFile('../mg-office-one/services/registration.json','utf8'));
  const doc=validateContract(contract,manifest);expect(doc.servers[0].url).toBe('/api/office');
  expect(()=>validateContract({...contract,servers:[{url:'/api'}]},manifest)).toThrow('相对路径');
  expect(manifest.operations.some((op:any)=>op.path.includes('integrations'))).toBe(false);
  const secret='office-http-contract-test-secret-'.repeat(2),content=await readFile('../mg-files-one/server/office-templates/document.docx');let engineError=0,command:any;
  engine=createServer(async(req,res)=>{
   if(req.url?.startsWith('/cache/files/')){res.end(content);return;}
   let raw='';for await(const chunk of req)raw+=chunk;command=JSON.parse(raw);const signed=verifyOffice(command.token,secret);expect(signed.c).toBe('forcesave');expect(signed.userdata).toBe(command.userdata);
   res.setHeader('content-type','application/json');res.end(JSON.stringify({error:engineError}));
  });const engineUrl=await listen(engine);
  vi.stubEnv('OFFICE_DOCUMENT_SERVER_URL',engineUrl);vi.stubEnv('OFFICE_DOCUMENT_SERVER_INTERNAL_URL',engineUrl);vi.stubEnv('OFFICE_JWT_SECRET',secret);vi.stubEnv('OFFICE_CALLBACK_BASE','http://127.0.0.1');
  const audiences:string[]=[];const identity={introspect:async(token:string,app:string)=>{audiences.push(app);return {sub:token[0],name:'测试用户',csrfToken:'csrf'}}};
  const store=new FilesStore(dir);await store.initialize();server=createFilesServer(store,identity as any);let origin=await listen(server);
  async function call(op:string,path:string,method='GET',body?:unknown,status=200,owner='a'){
   const response=await fetch(origin+'/api/office'+path,{method,headers:{authorization:'Bearer '+owner.repeat(43),'x-csrf-token':'csrf','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   expect(response.status).toBe(status);const value=await response.json();const validate=responseValidator(doc,op,status);expect(validate(value),JSON.stringify(validate.errors)).toBe(true);return value;
  }
  expect((await call('status','/status')).configured).toBe(true);
  for(const format of ['docx','xlsx','pptx'])expect((await call('create','/documents','POST',{format},201)).name.endsWith(format)).toBe(true);
  const files=await call('documents','/documents');expect(files.items).toHaveLength(3);const file=files.items.find((f:any)=>f.name.endsWith('docx'));
  const initial=structuredClone(store.get('a',file.id));expect((await call('documents','/documents?view=recent')).items).toHaveLength(0);
  const opened=await call('open',`/documents/${file.id}/open`,'POST',{mode:'edit'});const again=await call('open',`/documents/${file.id}/open`,'POST',{mode:'edit'});expect(again.sessionId).toBe(opened.sessionId);
  expect(verifyOffice(opened.config.token,secret).document.key).toBe(opened.config.document.key);
  const recent=await call('documents','/documents?view=recent');expect(recent.items[0].officeAccessedAt).toBeTruthy();expect(recent.items[0].version).toBe(initial.version);expect(recent.items[0].updatedAt).toBe(initial.updatedAt);
  expect((await call('documents','/documents?view=recent','GET',undefined,200,'b')).items).toHaveLength(0);
  await call('open',`/documents/${file.id}/open`,'POST',{},404,'b');await call('session',`/sessions/${opened.sessionId}`,'GET',undefined,404,'b');await call('save',`/sessions/${opened.sessionId}/save`,'POST',{},404,'b');
  const saving=await call('save',`/sessions/${opened.sessionId}/save`,'POST',{});expect(saving.queued).toBe(true);expect(command.userdata).toBe(saving.requestId);
  expect((await call('session',`/sessions/${opened.sessionId}`)).savedRequests).not.toContain(saving.requestId);expect(store.get('a',file.id).version).toBe(initial.version);
  const callbackPath=origin+`/integrations/office/${opened.sessionId}/callback`;
  const payload={key:opened.config.document.key,status:6,url:engineUrl+'/cache/files/result.docx',userdata:saving.requestId};
  expect((await fetch(callbackPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'invalid'})})).status).toBe(403);
  expect((await call('session',`/sessions/${opened.sessionId}`)).savedRequests).not.toContain(saving.requestId);
  const callback=await fetch(callbackPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:signOffice(payload,secret)})});expect(callback.status).toBe(200);
  const saved=await call('session',`/sessions/${opened.sessionId}`);expect(saved.savedRequests).toContain(saving.requestId);expect(saved.savedAt).toBeTruthy();expect(saved.version).toBe(initial.version+1);expect(await readFile(join(dir,'objects',store.get('a',file.id).storageKey!))).toEqual(content);
  engineError=4;const unchanged=await call('save',`/sessions/${opened.sessionId}/save`,'POST',{});expect(unchanged.unchanged).toBe(true);expect((await call('session',`/sessions/${opened.sessionId}`)).savedRequests).not.toContain(unchanged.requestId);
  engineError=1;await call('save',`/sessions/${opened.sessionId}/save`,'POST',{},502);
  const view=await call('open',`/documents/${file.id}/open`,'POST',{mode:'view'});expect(view.mode).toBe('view');await call('save',`/sessions/${view.sessionId}/save`,'POST',{},409);
  const legacy=await store.upload('a',store.root('a').id,'legacy.doc',4,Readable.from('test'));expect((await call('open',`/documents/${legacy.id}/open`,'POST',{mode:'edit'})).mode).toBe('view');
  await call('documents','/documents?view=invalid','GET',undefined,400);await call('create','/documents','POST',{format:'pdf'},400);await call('open',`/documents/${file.id}/open`,'POST',{mode:'invalid'},400);
  const other=await store.upload('a',store.root('a').id,'unsupported.txt',4,Readable.from('test'));await call('open',`/documents/${other.id}/open`,'POST',{},415);
  await call('session','/sessions/11111111-1111-4111-8111-111111111111','GET',undefined,410);
  expect((await fetch(origin+'/api/office/documents',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(43),'content-type':'application/json'},body:'{"format":"docx"}'})).status).toBe(403);
  await store.remove('a',file.id);expect((await call('documents','/documents?view=recent')).items.some((f:any)=>f.id===file.id)).toBe(false);
  expect(audiences.every(app=>app==='office-one')).toBe(true);
  await close(server);server=undefined;vi.stubEnv('OFFICE_DOCUMENT_SERVER_URL','');server=createFilesServer(store,identity as any);origin=await listen(server);
  expect((await call('status','/status')).configured).toBe(false);await call('create','/documents','POST',{format:'docx'},503);
 }finally{vi.unstubAllEnvs();if(server)await close(server);if(engine)await close(engine);await rm(dir,{recursive:true,force:true});}
});
