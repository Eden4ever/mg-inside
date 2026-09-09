import test from 'node:test';
import assert from 'node:assert/strict';
import { profileAvatarUrl, weComAvatar } from '../dist/profile-avatar.js';
import { syncWeComAvatars } from '../dist/wecom-avatar-sync.js';
import { WeComAuthService } from '../dist/wecom-auth.js';
import { AuthService, sha256 } from '../dist/auth.js';

test('头像地址安全规范化、缺字段保留缓存、显式空头像清空', () => {
  assert.equal(profileAvatarUrl('http://p.qlogo.cn/bizmail/example/0'), 'https://p.qlogo.cn/bizmail/example/0');
  for (const value of ['javascript:alert(1)', 'data:image/png;base64,x', 'http://other.example/a', 'https://user:pass@example.com/a', '//example.com/a', 'https://example.com/\nx']) assert.equal(profileAvatarUrl(value), null);
  assert.equal(weComAvatar({}), undefined); assert.equal(weComAvatar({ avatar: 'bad' }), undefined);
  assert.equal(weComAvatar({ avatar: '' }), null);
  assert.equal(weComAvatar({ avatar: '', thumb_avatar: 'https://avatar.example/thumb' }), 'https://avatar.example/thumb');
});

test('仅本人已绑定账号读取头像，头像服务失败保留旧值且仍登录', async () => {
  const user = { id:'existing', status:'active', avatarUrl:'https://avatar.example/old' };
  const binding = { id:'binding', userId:user.id, user };
  let bound = true, reads = 0;
  const db = { $queryRaw:async()=>[], weComLoginState:{findUnique:async()=>({id:'state',browserNonceHash:sha256('nonce'),expiresAt:new Date(Date.now()+60000),returnTo:'/users'}),updateMany:async()=>({count:1})}, weComIdentityRevocation:{findUnique:async()=>null}, weComIdentity:{findUnique:async()=>bound?binding:null,update:async()=>binding},user:{update:async({data})=>Object.assign(user,data)}};
  db.$transaction = async fn=>fn(db);
  const service = new WeComAuthService(db,{beginAuthentication:async value=>({state:'authenticated',user:value})});
  service.config=()=>({corpId:'corp',secret:'fake',agentId:'app'});service.exchangeIdentity=async()=>'bound-member';service.accessToken=async()=>'fake';
  service.getJson=async url=>{reads++;assert.equal(new URL(url).pathname,'/cgi-bin/user/get');assert.equal(new URL(url).searchParams.get('userid'),'bound-member');return{errcode:0,avatar:'http://p.qlogo.cn/bizmail/new/0'};};
  assert.equal((await service.complete('code','state','mg_identity_wecom_state=nonce',{})).user.avatarUrl,'https://p.qlogo.cn/bizmail/new/0');
  service.getJson=async()=>{reads++;throw Error('临时断网');};
  assert.equal((await service.complete('code','state','mg_identity_wecom_state=nonce',{})).state,'authenticated');
  assert.equal(user.avatarUrl,'https://p.qlogo.cn/bizmail/new/0');
  bound=false;await assert.rejects(()=>service.complete('code','state','mg_identity_wecom_state=nonce',{}),e=>e.getStatus()===403);assert.equal(reads,2);
});

test('头像补齐仅更新既有绑定头像，网络失败与缺失保留，重复执行幂等', async () => {
  const bindings=['new','same','missing','failure','revoked'].map(id=>({id,userId:id,externalUserId:id,user:{avatarUrl:'https://avatar.example/'+(id==='same'?id:'old')}}));
  const writes=[];
  const db={ $queryRaw:async()=>[],weComIdentity:{findMany:async({where})=>{assert.deepEqual(where,{corpId:'corp',user:{status:'active'}});return bindings;}},weComIdentityRevocation:{findUnique:async({where})=>where.corpId_externalUserId.externalUserId==='revoked'?{}:null},user:{updateMany:async({where,data})=>{assert.deepEqual(Object.keys(data),['avatarUrl']);assert.equal(where.wecomIdentities.some.corpId,'corp');const row=bindings.find(b=>b.userId===where.id);row.user.avatarUrl=data.avatarUrl;writes.push(data);return{count:1};}}};db.$transaction=async fn=>fn(db);
  const request=async url=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/gettoken'))return Response.json({errcode:0,access_token:'fake'});assert.equal(parsed.pathname,'/cgi-bin/user/get');const id=parsed.searchParams.get('userid');assert.notEqual(id,'revoked');if(id==='failure')throw Error('断网');return Response.json(id==='missing'?{errcode:0}:{errcode:0,avatar:'https://avatar.example/'+id});};
  assert.deepEqual(await syncWeComAvatars(db,{corpId:'corp',secret:'fake'},true,request),{total:5,updated:1,unchanged:1,unavailable:1,failed:1,skipped:1,dryRun:false});
  assert.equal(writes.length,1);
  const again=await syncWeComAvatars(db,{corpId:'corp',secret:'fake'},true,request);assert.equal(again.updated,0);assert.equal(again.unchanged,2);assert.equal(writes.length,1);
});

test('同一已登录会话下次读取即可看到更新头像，无需重新签发令牌', async () => {
  const user={id:'user',username:'user',displayName:'测试成员',passwordHash:'hash',status:'active',securityVersion:0,avatarUrl:null};
  const row={id:'session',userId:'user',user,securityVersion:0,expiresAt:new Date(Date.now()+60000),lastSeenAt:new Date(),csrfToken:'csrf'};
  const db={authSession:{findUnique:async()=>row},userRole:{findMany:async()=>[]},application:{findUnique:async()=>null},user:{findUnique:async()=>user},applicationUser:{findUnique:async()=>null},roleApplication:{findMany:async()=>[]}};
  const auth=new AuthService(db,{},{}),token='a'.repeat(43);
  assert.equal((await auth.authenticateToken(token)).user.avatarUrl,null);
  user.avatarUrl='https://avatar.example/new';assert.equal((await auth.authenticateToken(token)).user.avatarUrl,user.avatarUrl);
});

test('现有资料同步顺带更新头像，上游缺少头像字段不清空缓存', async () => {
  const user={id:'existing',displayName:'已有成员',departmentName:'研发',avatarUrl:null};
  let member={userid:'bound',name:'已有成员',department:[1],avatar:'https://avatar.example/member'};
  const db={$queryRaw:async()=>[],weComIdentityRevocation:{findUnique:async()=>null},weComIdentity:{findUnique:async()=>({userId:user.id,user})},user:{update:async({data})=>Object.assign(user,data)},auditLog:{create:async()=>({})}};
  db.$transaction=async fn=>fn(db);
  const service=new WeComAuthService(db,{});service.config=()=>({corpId:'corp',secret:'fake'});service.accessToken=async()=>'fake';
  service.getJson=async url=>new URL(url).pathname.endsWith('/department/list')?{errcode:0,department:[{id:1,name:'研发'}]}:{errcode:0,userlist:[member]};
  assert.equal((await service.syncDirectory()).updated,1);assert.equal(user.avatarUrl,member.avatar);
  member={userid:'bound',name:'已有成员',department:[1]};assert.equal((await service.syncDirectory()).unchanged,1);assert.equal(user.avatarUrl,'https://avatar.example/member');
});
