import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as identity from '../src/modules/auth/identity-client'
import { IdentityController, IdentitySyncService } from '../src/modules/auth/identity.controller'
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard'
import { JwtUtil } from '../src/common/utils/jwt.util'
import { AuthController } from '../src/modules/auth/auth.controller'
import { UserAdminController } from '../src/modules/user/user.module'
import { AuthService } from '../src/modules/auth/auth.service'

test('SSO 状态 Cookie 覆盖真实回调子目录，且清除时使用相同路径', () => {
  const previous = process.env.IDENTITY_REDIRECT_URI
  try {
    for (const base of ['', '/knowledge-base-inside']) {
      process.env.IDENTITY_REDIRECT_URI = `https://app.example${base}/api/auth/sso/callback`
      const cookies = [identity.flowCookie('test'), identity.flowCookie('', 0)]
      for (const cookie of cookies) {
        const cookiePath = cookie.match(/; Path=([^;]+)/)![1]
        assert.equal(cookiePath, `${base}/api/auth/sso`)
        assert.ok(new URL(process.env.IDENTITY_REDIRECT_URI).pathname.startsWith(`${cookiePath}/`))
      }
    }
  } finally {
    if (previous === undefined) delete process.env.IDENTITY_REDIRECT_URI
    else process.env.IDENTITY_REDIRECT_URI = previous
  }
})

test('SSO 只关联原账号，保留权限、额度和 ID，拒绝覆盖已有绑定', async t => {
  t.mock.method(identity, 'completeIdentity', async () => ({ profile: { sub: 'central-user', identity_session: 'central-session', local_user_id: '7', name: '姓名' }, returnTo: '/' }))
  const user = { id: 7, username: 'original', role: 'user', status: 1, identityEnabled: true, identitySubject: 'central-user', identityIssuer: 'https://identity.meta-gravity.com', quota: 900 }
  let saves = 0
  const source: any = { transaction: (callback: any) => callback({ getRepository: () => ({ findOne: async (q:any) => q.where.displayName ? null : user, save: async (u: any) => { saves++; return u } }) }) }
  const controller = new IdentityController(source, { jwt: { secret: 'isolated-test-signing-secret', expiresIn: '1h' } } as any)
  let target = ''
  const response: any = { setHeader() {}, redirect(url: string) { target = url } }
  await controller.callback({ originalUrl: '/api/auth/sso/callback?code=test', headers: {} } as any, response)
  const token = new URLSearchParams(target.split('#')[1]).get('sso_token')!
  assert.ok(token)
  const claims = JwtUtil.verify(token, 'isolated-test-signing-secret')
  assert.equal(claims.sub, 7); assert.equal(claims.role, 'user'); assert.equal(claims.identitySession, 'central-session')
  assert.equal(user.quota, 900); assert.equal(saves, 1)
  Object.assign(user, { identitySubject: 'different-user' })
  await controller.callback({ originalUrl: '/api/auth/sso/callback', headers: {} } as any, response)
  assert.equal(target, '/login?sso_error=1'); assert.equal(saves, 1)
})

test('中心退出或停用后拒绝旧 SSO JWT，权限实时读取本地账号', async t => {
  const central = t.mock.method(identity, 'identitySessionActive', async () => true)
  const user = { id: 7, username: 'original', role: 'user', status: 1, identityEnabled: true, identitySubject: 'central-user' }
  const guard = new JwtAuthGuard({ findOne: async () => user } as any, { jwt: { secret: 'isolated-test-signing-secret' } } as any)
  const token = JwtUtil.sign({ sub: 7, username: 'original', role: 'admin', identitySubject: 'central-user', identitySession: 'central-session' }, 'isolated-test-signing-secret', '1h')
  const req: any = { headers: { authorization: `Bearer ${token}` } }
  const context: any = { switchToHttp: () => ({ getRequest: () => req }) }
  assert.equal(await guard.canActivate(context), true); assert.equal(req.user.role, 'user')
  assert.equal(req.user.identitySession, 'central-session')
  central.mock.mockImplementation(async () => false)
  await assert.rejects(guard.canActivate(context), /统一登录已失效/)
  user.identityEnabled = false
  await assert.rejects(guard.canActivate(context), /账号无效/)
})

test('应用退出仅使用服务端验证的中心会话，并传递撤销失败', async t => {
  const ended = t.mock.method(identity, 'identityEndSession', async () => {})
  const controller = new AuthController({} as any)
  await controller.logout({user:{sub:7}} as any)
  assert.equal(ended.mock.callCount(),0)
  await controller.logout({user:{sub:7,identitySubject:'central-user',identitySession:'central-session'}} as any)
  assert.deepEqual(ended.mock.calls[0].arguments,['central-user','central-session'])
  ended.mock.mockImplementation(async()=>{throw new Error('中心不可达')})
  await assert.rejects(controller.logout({user:{identitySubject:'central-user',identitySession:'central-session'}} as any),/中心不可达/)
})

test('目录同步更新资料、停用标志并停用快照中已撤销的映射', async t => {
  t.mock.method(identity, 'identityEnabled', () => true)
  t.mock.method(identity, 'identityDirectory', async () => [{ subject: 'central-user', localUserId: '7', name: '新姓名', department: '产品', active: false, securityVersion: 1 }])
  const user:any={id:7,identityIssuer:'https://identity.meta-gravity.com',identitySubject:'central-user',role:'admin',quota:900}
  const updates: any[] = []
  const repo={findOne:async(q:any)=>q.where.displayName?null:user,save:async(u:any)=>u,find:async()=>[user,{id:8,identitySubject:'revoked'}],update:async(...args:any[])=>updates.push(args)}
  await new IdentitySyncService({transaction:async(callback:any)=>callback({getRepository:()=>repo})} as any).sync()
  assert.equal(user.displayName,'新姓名');assert.equal(user.status,0);assert.equal(user.identityEnabled,false)
  assert.equal(user.role,'admin');assert.equal(user.quota,900)
  assert.deepEqual(updates,[[{id:8},{identityEnabled:false,status:0}]])
})

test('统一认证启用后，旧员工 JWT 和直接禅道建号入口均不可绕过中心', async () => {
  const previous=process.env.IDENTITY_ENABLED;process.env.IDENTITY_ENABLED='true'
  try {
    const config={jwt:{secret:'isolated-test-signing-secret',expiresIn:'1h'}} as any
    const user={id:7,username:'old-user',role:'user',status:1,identityEnabled:true,syncSource:'zentao'}
    const repo={findOne:async()=>user} as any
    const auth=new AuthService(repo,config,{enabled:true,authenticate:()=>{throw new Error('不应调用旧禅道服务')}} as any)
    await assert.rejects(auth.validateUser('old-user','unused'),/统一身份/)
    const guard=new JwtAuthGuard(repo,config)
    const token=JwtUtil.sign({sub:7,username:'old-user',role:'user'},config.jwt.secret,'1h')
    const req={headers:{authorization:`Bearer ${token}`}}
    const context={switchToHttp:()=>({getRequest:()=>req})} as any
    await assert.rejects(guard.canActivate(context),(error: any)=>error.getStatus?.()===401)
    Object.assign(user,{role:'admin',syncSource:'local'})
    await assert.rejects(guard.canActivate(context),(error: any)=>error.getStatus?.()===401)
    await assert.rejects(auth.validateUser('old-user','unused'),/统一身份/)
  } finally {if(previous===undefined)delete process.env.IDENTITY_ENABLED;else process.env.IDENTITY_ENABLED=previous}
})

test('业务管理接口禁止本地建号、删除、修改身份及密码', async()=>{
  const previous=process.env.IDENTITY_ENABLED;process.env.IDENTITY_ENABLED='true'
  try {
    const controller=new UserAdminController({} as any,{} as any,{} as any,{} as any,{} as any)
    await assert.rejects(controller.create({sub:1} as any,{} as any),/统一认证/)
    await assert.rejects(controller.remove('1'),/统一认证/)
    for(const field of ['username','displayName','department','status','password']) await assert.rejects(controller.update({sub:1} as any,'1',{[field]:'changed'} as any),/统一认证/)
  }finally{if(previous===undefined)delete process.env.IDENTITY_ENABLED;else process.env.IDENTITY_ENABLED=previous}
})
