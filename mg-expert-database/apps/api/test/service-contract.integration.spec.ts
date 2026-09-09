import 'reflect-metadata';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {expect,it,vi} from 'vitest';
import type {NestFastifyApplication} from '@nestjs/platform-fastify';
import {createApiApplication} from '../src/main';
import {PrismaService} from '../src/prisma.service';
import {hashPassword} from '../src/auth';

it('公共查询契约通过真实 PostgreSQL、登录和 HTTP 验证，保留体系授权及管理员范围',async()=>{
 const source=process.env.DATABASE_URL||parseEnv(readFileSync(resolve('../../.env'),'utf8')).DATABASE_URL!;
 const url=new URL(source);
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='5437'||url.pathname!=='/mg_expert')throw Error('契约测试仅允许本项目本地数据库。');
 const schema=`mg_expert_test_contract_${process.pid}_${Date.now()}`;
 if(!/^mg_expert_test_contract_\d+_\d+$/.test(schema))throw Error('独立测试 Schema 无效。');
 url.searchParams.set('schema',schema);
 vi.stubEnv('DATABASE_URL',url.href);vi.stubEnv('NODE_ENV','test');vi.stubEnv('IDENTITY_ENABLED','false');vi.stubEnv('ZHIPU_API_KEY','');
 const require=createRequire(resolve('package.json')),cli=require.resolve('prisma/build/index.js'),prismaSchema=resolve('prisma/schema.prisma');
 const validationRequire=createRequire(resolve('../../../mg-desktop-one/package.json'));
 const Ajv=validationRequire('ajv/dist/2020').default,addFormats=validationRequire('ajv-formats').default;
 const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
 const contract=JSON.parse(readFileSync(resolve('../../services/openapi.json'),'utf8'));
 const validators=new Map<string,any>();
 for(const path of Object.values(contract.paths) as any[])for(const operation of Object.values(path) as any[])for(const [status,response] of Object.entries(operation.responses) as any){
  validators.set(`${operation.operationId}:${status}`,ajv.compile({...response.content['application/json'].schema,components:contract.components}));
 }
 let app:NestFastifyApplication|undefined,created=false;
 try{
  execFileSync(process.execPath,[cli,'db','push','--skip-generate','--schema',prismaSchema],{env:process.env,stdio:'pipe',windowsHide:true});created=true;
  app=await createApiApplication();app.useLogger(false);await app.listen(0,'127.0.0.1');const origin=await app.getUrl();const db=app.get<PrismaService>(PrismaService);
  const password='ContractOnly!2026',passwordHash=await hashPassword(password);
  const admin=await db.user.create({data:{username:'contract-admin',displayName:'契约管理员',role:'system_admin',passwordHash}});
  const reader=await db.user.create({data:{username:'contract-reader',displayName:'契约查看者',role:'reader',passwordHash}});
  const other=await db.user.create({data:{username:'contract-other',displayName:'另一账户',role:'researcher',passwordHash}});
  const sessions:Record<string,{cookie:string;csrf:string}>={};
  for(const user of [admin,reader,other]){
   const response=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user.username,password})});
   expect(response.status).toBe(200);const data=await response.json();sessions[user.id]={cookie:response.headers.getSetCookie()[0]!.split(';')[0]!,csrf:data.csrfToken};
  }
  async function call(op:string,path:string,owner=admin.id,status=200){
   const response=await fetch(origin+'/api'+path,{headers:owner?{cookie:sessions[owner]!.cookie}:{}});expect(response.status).toBe(status);
   const data=await response.json(),validate=validators.get(`${op}:${status}`);expect(validate,`${op}:${status} 缺少契约`).toBeTruthy();expect(validate(data),JSON.stringify(validate.errors)).toBe(true);return data;
  }
  const create=await fetch(origin+'/api/systems',{method:'POST',headers:{cookie:sessions[admin.id]!.cookie,'x-csrf-token':sessions[admin.id]!.csrf,'content-type':'application/json'},body:JSON.stringify({name:'契约共享体系',code:'CONTRACT-SHARED',region:'测试区',year:2026,versionCode:'V2'})});
  expect(create.status).toBe(201);const system=await create.json(),version=system.version;
  const empty=await db.indicatorSystem.create({data:{name:'空版本体系',code:'CONTRACT-EMPTY',region:''}});
  await db.indicatorVersion.create({data:{systemId:system.id,year:2025,versionCode:'V1'}});
  await db.indicatorSystemAccess.create({data:{systemId:system.id,userId:reader.id,canView:true,systemRole:'viewer'}});
  await db.indicatorSystemAccess.create({data:{systemId:empty.id,userId:other.id,canView:true,canResearch:true}});
  const library=await db.semanticLibrary.create({data:{versionId:version.id,name:'共享语义库'}});
  const oldVersion=await db.indicatorVersion.findFirstOrThrow({where:{systemId:system.id,year:2025}});
  await db.semanticLibrary.create({data:{versionId:oldVersion.id,name:'尚未构建语义库'}});
  const completed=await db.semanticBuild.create({data:{libraryId:library.id,actorUserId:admin.id,fingerprint:'contract-completed',snapshot:[],total:2,completed:2,reused:1,tokens:12,status:'completed',finishedAt:new Date(),createdAt:new Date('2026-01-01T00:00:00Z')}});
  await db.semanticLibrary.update({where:{id:library.id},data:{activeBuildId:completed.id}});
  const pending=await db.semanticBuild.create({data:{libraryId:library.id,actorUserId:admin.id,fingerprint:'contract-pending',snapshot:[],total:3,status:'queued',createdAt:new Date('2026-01-02T00:00:00Z')}});
  const all=await call('systems','/systems');expect(all).toHaveLength(2);
  expect(all.find((s:any)=>s.id===empty.id)).toMatchObject({year:null,version:null,versionId:null,indicatorCount:0,progress:0,status:'draft'});
  const visible=await call('systems','/systems',reader.id);expect(visible.map((s:any)=>s.id)).toEqual([system.id]);expect(visible[0].access).toMatchObject({canView:true,canManageCatalog:false,canResearch:false,systemRole:'viewer'});
  expect((await call('systems','/systems',other.id)).map((s:any)=>s.id)).toEqual([empty.id]);
  const detail=await call('system',`/systems/${system.id}`,reader.id);expect(detail.versions.map((v:any)=>v.year)).toEqual([2026,2025]);expect(detail).not.toHaveProperty('nodes');
  expect((await call('system',`/systems/${empty.id}`)).versions).toEqual([]);
  await call('system',`/systems/${system.id}`,other.id,403);await call('system','/systems/not-present',admin.id,404);await call('system','/systems/not-present',reader.id,403);
  for(const [op,path] of [['systems','/systems'],['system',`/systems/${system.id}`],['libraries','/semantic-libraries']])await call(op!,path!,'',401);
  const libraries=await call('libraries','/semantic-libraries',reader.id);expect(libraries.configured).toBe(false);expect(libraries.libraries).toHaveLength(2);
  expect(libraries.libraries.every((l:any)=>l.canManage===false)).toBe(true);
  expect(libraries.libraries.find((l:any)=>l.id===library.id)).toMatchObject({activeBuildId:completed.id,build:{id:pending.id,status:'queued',finishedAt:null,error:null}});
  expect(libraries.libraries.find((l:any)=>l.name==='尚未构建语义库')).toMatchObject({activeBuildId:null,build:null});
  expect((await call('libraries','/semantic-libraries')).libraries.every((l:any)=>l.canManage)).toBe(true);
  expect((await call('libraries','/semantic-libraries',other.id)).libraries).toEqual([]);
  // 撤销后沿同一有效登录会话再次查询，避免缓存继续暴露旧授权内容。
  await db.indicatorSystemAccess.deleteMany({where:{userId:reader.id,systemId:system.id}});
  expect(await call('systems','/systems',reader.id)).toEqual([]);expect((await call('libraries','/semantic-libraries',reader.id)).libraries).toEqual([]);
  await call('system',`/systems/${system.id}`,reader.id,403);
  expect(validators.get('system:200')({...detail,passwordHash:'不应出现'})).toBe(false);
 }finally{
  await app?.close();
  if(created)execFileSync(process.execPath,[cli,'db','execute','--stdin','--schema',prismaSchema],{env:process.env,input:`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`,stdio:'pipe',windowsHide:true});
  vi.unstubAllEnvs();
 }
},60_000);
