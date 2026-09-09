import { ensurePlatformAdministratorRole } from '../dist/platform-role.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../dist/password.js';
const require = createRequire(import.meta.url);
const origin = 'http://127.0.0.1:4200';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('仅允许本地专用测试库');

test('中心 GUI/API：无原账号 ID 的授权、签发、资料与停用同步', async () => {
  const db = new PrismaClient(); const jar = new Map(); const users = [];
  const suffix = randomBytes(6).toString('hex'); const password = randomBytes(24).toString('base64url');
  async function browser(path, body, method = body === undefined ? 'GET' : 'POST', csrf = '') {
    const response = await fetch(new URL(path, origin), { method, redirect:'manual', headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf,Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}, body:body === undefined ? undefined : JSON.stringify(body) });
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0];const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    return response;
  }
  try {
    const admin = await db.user.create({data:{username:`admin-${suffix}`,displayName:`测试管理-${suffix}`,role:'system_admin',passwordHash:await hashPassword(password)}});users.push(admin.id);
    const platformRole = await ensurePlatformAdministratorRole(db);
    await db.userRole.create({data:{userId:admin.id,roleId:platformRole.id}});
    await db.applicationUser.create({data:{userId:admin.id,clientId:'identity',enabled:true}});
    const login = await browser('/api/auth/login',{username:admin.username,password}); assert.equal(login.status,200); const csrf=(await login.json()).csrfToken;
    for(const path of ['/','/admin','/account','/applications']){const response=await browser(path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');}
    const created = await browser('/api/users',{username:`new-${suffix}`,displayName:`同步测试-${suffix}`,password,departmentName:'产品',roleIds:[]},'POST',csrf);
    assert.equal(created.status,201);const user=await created.json();users.push(user.id);
    const path=`/api/applications/token-one/users/${user.id}`;
    assert.equal((await browser(path,{enabled:true},'PUT')).status,403);
    const grant = await browser(path,{enabled:true},'PUT',csrf);assert.equal(grant.status,200);assert.equal((await grant.json()).localUserId,null);
    assert.equal((await browser(path,{enabled:true,localUserId:'999999'},'PUT',csrf)).status,409);
    const secrets=JSON.parse(await fs.readFile(new URL('../private/service-test/identity.json',import.meta.url)));
    const client=secrets.clients.find(c=>c.client_id==='token-one');
    Object.assign(process.env,{IDENTITY_ENABLED:'true',IDENTITY_ISSUER:origin,IDENTITY_CLIENT_ID:client.client_id,IDENTITY_CLIENT_SECRET:client.client_secret,IDENTITY_REDIRECT_URI:client.redirect_uris[0],IDENTITY_COOKIE_KEY:randomBytes(32).toString('hex')});
    const sdk=require('../../mg-token-one/mg-gateway/apps/gateway/dist/modules/auth/identity-client.js');
    const entry=()=>sdk.identityDirectory().then(rows=>rows.find(p=>p.subject===user.id));
    assert.deepEqual(await entry(),{subject:user.id,localUserId:null,username:user.username,name:user.displayName,department:'产品',active:true,securityVersion:0});
    assert.equal((await browser(`/api/users/${user.id}`,{displayName:`已改名-${suffix}`,departmentName:''},'PATCH',csrf)).status,200);
    assert.equal((await entry()).name,`已改名-${suffix}`);assert.equal((await entry()).department,null);
    await browser(path,{enabled:false},'PUT',csrf);assert.equal((await entry()).active,false);
    await browser(path,{enabled:true},'PUT',csrf);
    jar.clear();assert.equal((await browser('/api/auth/login',{username:user.username,password})).status,200);
    const flow=await sdk.startIdentity('/');let url=flow.url;
    for(let i=0;i<12&&!url.startsWith(client.redirect_uris[0]);i++){const response=await browser(url);assert.ok([302,303].includes(response.status));url=new URL(response.headers.get('location'),origin).href;}
    const result=await sdk.completeIdentity(url,sdk.cookieValue(flow.cookie));
    assert.equal(result.profile.sub,user.id);assert.equal(result.profile.local_user_id,null);assert.equal(result.profile.preferred_username,user.username);assert.ok(result.profile.auth_methods.includes('local'));
  } finally { await db.applicationUser.deleteMany({where:{userId:{in:users}}}); await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect(); }
});
