import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {Module} from '@nestjs/common'
import {NestFactory} from '@nestjs/core'
import {getRepositoryToken} from '@nestjs/typeorm'
import {ModelPortalController,PublicModelController} from '../src/modules/model-config/model-config.module'
import {ModelGroupService} from '../src/modules/group/model-group.service'
import {JwtAuthGuard} from '../src/modules/auth/guards/jwt-auth.guard'
import {unifiedIdentity,UnifiedAuthError} from '../src/modules/auth/unified-client'
import {ModelConfig} from '../src/entities/model-config.entity'
import {User} from '../src/entities/user.entity'
import {HttpExceptionFilter} from '../src/common/filters/http-exception.filter'

test('模型目录契约：真实 HTTP、统一身份 Guard 与分组服务，公开字段脱敏及当前账户范围',async()=>{
 const oldEnv={...process.env},oldIntrospect=unifiedIdentity.introspect
 Object.assign(process.env,{IDENTITY_ENABLED:'true',IDENTITY_TOKEN_MODE:'unified',IDENTITY_ISSUER:'http://127.0.0.1:14200'})
 const requireValidation=createRequire(resolve('../../../../mg-desktop-one/package.json'))
 const Ajv=requireValidation('ajv/dist/2020').default
 const doc=JSON.parse(readFileSync(resolve('../../services/openapi.json'),'utf8'))
 const ajv=new Ajv({strict:false,allErrors:true}),validators=new Map<string,any>()
 for(const path of Object.values(doc.paths) as any[])for(const op of Object.values(path) as any[])for(const [status,response] of Object.entries(op.responses) as any){
  validators.set(`${op.operationId}:${status}`,ajv.compile({...response.content['application/json'].schema,components:doc.components}))
 }
 const users:any[]=[
  {id:1,username:'reader',displayName:'默认组用户',role:'user',groupNames:[],identitySubject:'reader'},
  {id:2,username:'premium',displayName:'授权组用户',role:'user',groupNames:['premium'],identitySubject:'premium'},
  {id:3,username:'admin',displayName:'管理员',role:'admin',groupNames:[],identitySubject:'admin'},
 ].map(u=>({...u,status:1,identityIssuer:process.env.IDENTITY_ISSUER}))
 const repo:any={findOne:async({where}:any)=>where.identitySubject?users.find(u=>u.identitySubject===where.identitySubject):typeof where.id==='number'?users.find(u=>u.id===where.id):null,save:async(user:any)=>user}
 repo.manager={transaction:async(fn:any)=>fn({getRepository:()=>repo})}
 const model=(id:number,name:string,groupTag:string,status=1)=>({id,name,groupTag,status,remark:null,contextLength:0,maxOutputTokens:0,supportsVision:0,supportsTools:1,supportsReasoning:0,supportsResponses:1,supportsAnthropic:0,reasoningEfforts:null,inputModalities:null,outputModalities:null,visionNotes:null,inputPrice:99,bindings:[{channelId:1,upstreamModel:'private-upstream'}],keysEncrypted:'private-key'} as any)
 const models=[model(1,'default-model','default'),model(2,'premium-model','legacy'),model(3,'disabled-model','default',0),model(4,'unassigned-model','unknown')]
 Object.assign(models[1],{supportsVision:1,supportsReasoning:1,contextLength:128000,maxOutputTokens:8000,reasoningEfforts:'low,high',inputModalities:['text','image'],remark:'内部备注',visionNotes:'视觉说明'})
 let providerError=false,revoked=false,unavailable=false
 const modelRepo:any={find:async(options:any)=>{assert.deepEqual(options,{where:{status:1},order:{id:'ASC'}});if(providerError)throw Error('受控提供方错误');return models.filter(m=>m.status===1)}}
 const groups:any={find:async()=>[{id:1,name:'default',models:null},{id:2,name:'premium',models:['premium-model']},{id:3,name:'empty',models:[]}]}
 const modelGroups=new ModelGroupService(groups,modelRepo)
 const audiences:string[]=[]
 unifiedIdentity.introspect=async(token,audience)=>{
  audiences.push(audience!);assert.equal(audience,'token-one')
  if(unavailable)throw new UnifiedAuthError(503,'身份服务不可用')
  const user=users['abc'.indexOf(token[0])]
  if(revoked||!user)throw new UnifiedAuthError(401,'未授权')
  return {sub:user.identitySubject,sid:'session',localUserId:String(user.id),username:user.username,name:user.displayName,department:null,securityVersion:1,aud:audience} as any
 }
 @Module({controllers:[ModelPortalController,PublicModelController],providers:[JwtAuthGuard,
  {provide:getRepositoryToken(User),useValue:repo},{provide:getRepositoryToken(ModelConfig),useValue:modelRepo},
  {provide:ModelGroupService,useValue:modelGroups},{provide:'APP_CONFIG',useValue:{}}]})
 class ContractModule{}
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined
 try{
  app=await NestFactory.create(ContractModule,{logger:false});app.useGlobalFilters(new HttpExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl()
  async function call(op:string,path:string,identity='',status=200){
   const response=await fetch(base+'/api'+path,{headers:identity?{authorization:`Bearer ${identity.repeat(43)}`,'X-MG-Application':'token-one-docs'}:{}})
   assert.equal(response.status,status);const data:any=await response.json(),validate=validators.get(`${op}:${status}`);assert.ok(validate);assert.ok(validate(data),JSON.stringify(validate.errors));return data
  }
  const publicResult=await call('models','/public/models');assert.equal(audiences.length,0)
  assert.deepEqual(publicResult.list.map((m:any)=>m.name),['default-model','premium-model','unassigned-model'])
  for(const item of publicResult.list)for(const field of ['groupTag','groupNames','remark','visionNotes','inputPrice','bindings','keysEncrypted','id'])assert.equal(field in item,false)
  assert.deepEqual(publicResult.list[0].inputModalities,['text']);assert.equal(publicResult.list[1].supportsVision,true)
  const defaultResult=await call('portal-models','/portal/models','a');assert.deepEqual(defaultResult.list.map((m:any)=>m.name),['default-model'])
  const premium=await call('portal-models','/portal/models','b');assert.deepEqual(premium.list.map((m:any)=>m.name),['premium-model']);assert.deepEqual(premium.list[0].groupNames,['premium']);assert.equal(premium.list[0].remark,'内部备注')
  assert.equal((await call('portal-models','/portal/models','c')).list.length,3)
  users[2].role='user';users[2].groupNames=['empty'];assert.deepEqual((await call('portal-models','/portal/models','c')).list,[])
  users[1].groupNames=['empty'];assert.deepEqual((await call('portal-models','/portal/models','b')).list,[])
  await call('portal-models','/portal/models','',401);await call('portal-models','/portal/models','x',401)
  revoked=true;await call('portal-models','/portal/models','a',401);revoked=false
  unavailable=true;await call('portal-models','/portal/models','a',503);unavailable=false
  providerError=true;await call('models','/public/models','',500);providerError=false
  assert.equal(validators.get('models:200')({list:[{...publicResult.list[0],groupNames:['secret']}]}),false)
  assert.equal(validators.get('portal-models:200')({list:[{...premium.list[0],bindings:[]}]}),false)
 }finally{
  await app?.close();unifiedIdentity.introspect=oldIntrospect
  for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key]
  Object.assign(process.env,oldEnv)
 }
})
