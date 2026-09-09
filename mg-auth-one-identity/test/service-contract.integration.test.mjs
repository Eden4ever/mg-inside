import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {NestFactory} from '@nestjs/core';
import {FastifyAdapter} from '@nestjs/platform-fastify';

// 使用真实 Nest 控制器、会话 Guard、密码登录与 PostgreSQL。
// 不启动 main.js 的 OIDC/第三方登录服务，不读取或修改现有业务 Schema。
test('本人资料契约：真实登录、双账户、动态角色授权、会话失效和字段边界',async t=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const settings=parseEnv(await readFile(new URL('../../mg-desktop-one/.runtime/local/identity.env',import.meta.url),'utf8'));
 const database=new URL(settings.DATABASE_URL);
 assert(['127.0.0.1','localhost'].includes(database.hostname));
 assert.equal(database.port,'15439');assert.equal(database.pathname,'/identity_test');
 const schema=`identity_contract_${process.pid}_${Date.now()}`;
 assert.match(schema,/^identity_contract_\d+_\d+$/);
 database.searchParams.set('schema',schema);
 const before=process.env.DATABASE_URL;process.env.DATABASE_URL=database.href;
 const cleanup=new PrismaClient({datasources:{db:{url:database.href}}});
 let app;
 t.after(async()=>{
  try { if(app)await app.close(); await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  finally {await cleanup.$disconnect();if(before===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=before;}
 });
 try {execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate','--schema','prisma/schema.prisma'],{cwd:root,env:{...process.env,DATABASE_URL:database.href},stdio:'pipe'});}
 catch {throw Error('独立本地身份测试 Schema 初始化失败；未输出数据库连接配置。');}
 const [{AppModule},{PrismaService},{hashPassword}]=await Promise.all([import('../dist/app.module.js'),import('../dist/prisma.service.js'),import('../dist/password.js')]);
 app=await NestFactory.create(AppModule,new FastifyAdapter(),{logger:false});app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');
 const base=await app.getUrl(),db=app.get(PrismaService);
 const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password);
 const a=await db.user.create({data:{username:'contract-admin',displayName:'契约管理员',passwordHash,role:'member'}});
 const b=await db.user.create({data:{username:'contract-member',displayName:'契约成员',passwordHash,role:'system_admin'}});
 const role=await db.role.create({data:{key:'platform-admin',name:'平台管理员'}});
 await db.userRole.create({data:{userId:a.id,roleId:role.id}});
 await db.application.create({data:{clientId:'identity',name:'统一身份'}});
 await db.applicationUser.create({data:{clientId:'identity',userId:a.id,enabled:true}});
 const require=createRequire(new URL('../../mg-desktop-one/package.json',import.meta.url));
 const Ajv=require('ajv/dist/2020.js').default,addFormats=require('ajv-formats');
 const doc=JSON.parse(await readFile(new URL('../services/openapi.json',import.meta.url),'utf8'));
 const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
 function validator(name){return ajv.compile({...doc.components.schemas[name],components:doc.components});}
 const success=validator('CurrentIdentity'),failure=validator('Error');
 async function login(username){
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie')?.split(';')[0];assert(cookie?.startsWith('mg_identity_session='));
  return {cookie,token:decodeURIComponent(cookie.slice(cookie.indexOf('=')+1))};
 }
 async function me(headers={},status=200,query=''){
  const response=await fetch(base+'/api/auth/me'+query,{headers});assert.equal(response.status,status);
  const value=await response.json();assert((status===200?success:failure)(value),'实际身份响应须符合契约');return value;
 }
 const first=await login(a.username),second=await login(b.username);
 const admin=await me({cookie:first.cookie}),member=await me({cookie:second.cookie});
 assert.equal(admin.user.userId,a.id);assert.equal(admin.user.role,'system_admin');assert.equal(admin.user.identityAuthorized,true);
 assert.equal(member.user.userId,b.id);assert.equal(member.user.role,'member');assert.equal(member.user.identityAuthorized,false);
 assert.notEqual(admin.csrfToken,member.csrfToken);
 assert.deepEqual(await me({authorization:'Bearer '+first.token}),admin);
 assert.equal((await me({cookie:first.cookie},200,'?userId='+b.id)).user.userId,a.id);
 await me({},401);await me({cookie:first.cookie,authorization:'Bearer invalid'},401);
 await me({authorization:'Bearer '+randomBytes(32).toString('base64url')},401);
 for(const field of ['passwordHash','rawToken','sessionId','tokenHash','securityVersion','mfaMethods']){
  assert.equal(success({...admin,user:{...admin.user,[field]:'不可出现在资料中'}}),false);
  assert.equal(success({...admin,[field]:'不可出现在资料中'}),false);
 }
 await db.applicationUser.update({where:{clientId_userId:{clientId:'identity',userId:a.id}},data:{enabled:false}});
 assert.equal((await me({cookie:first.cookie})).user.identityAuthorized,false);
 assert.equal((await fetch(base+'/api/users',{headers:{cookie:first.cookie}})).status,403);
 await db.userRole.deleteMany({where:{userId:a.id}});
 const changed=await me({cookie:first.cookie});assert.equal(changed.user.role,'member');assert.deepEqual(changed.user.roles,[]);
 for(const data of [{revokedAt:new Date()},{expiresAt:new Date(0)}]){
  const fresh=await login(b.username);
  const {createHash}=await import('node:crypto');const tokenHash=createHash('sha256').update(fresh.token).digest('hex');
  await db.authSession.update({where:{tokenHash},data});await me({cookie:fresh.cookie},401);
 }
 const stale=await login(b.username);await db.user.update({where:{id:b.id},data:{securityVersion:{increment:1}}});await me({cookie:stale.cookie},401);
 const disabled=await login(b.username);await db.user.update({where:{id:b.id},data:{status:'disabled'}});await me({cookie:disabled.cookie},401);
});
