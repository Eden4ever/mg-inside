import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const origin = 'http://127.0.0.1:4200';
const credentials = JSON.parse(await fs.readFile(new URL('../private/service-test/user.json', import.meta.url)));
const secrets = JSON.parse(await fs.readFile(new URL('../private/service-test/identity.json', import.meta.url)));
const prisma = new PrismaClient();
if (!process.env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('集成测试仅允许专用本地数据库');
const jar = new Map();
async function browser(url, options = {}) {
  const response = await fetch(new URL(url, origin), { ...options, redirect: 'manual', headers: { ...options.headers,
    Origin: origin, Cookie: [...jar].map(([key,value]) => `${key}=${value}`).join('; ') } });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const offset = pair.indexOf('='); jar.set(pair.slice(0, offset), pair.slice(offset + 1)); }
  return response;
}
async function authorize(client) {
  const verifier = randomBytes(32).toString('base64url'); const state = randomBytes(24).toString('hex'); const nonce = randomBytes(24).toString('hex');
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], scope: 'openid profile', response_type: 'code', state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  let url = `${origin}/auth?${query}`;
  for (let i = 0; i < 12; i++) {
    const response = await browser(url);
    assert.ok([302,303].includes(response.status), `授权过程未成功：${response.status} ${new URL(url).pathname}`);
    url = new URL(response.headers.get('location'), origin).href;
    if (url.startsWith(client.redirect_uris[0])) {
      const params = new URL(url).searchParams;
      assert.equal(params.get('state'), state); assert.ok(params.get('code'), '回调缺少授权码');
      return { verifier, code: params.get('code'), nonce };
    }
  }
  throw new Error('授权跳转超过上限');
}
async function token(client, params) {
  return fetch(`${origin}/token`, { method:'POST', body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, ...params }) });
}
test('独立身份服务：双应用 SSO、原账号映射、用户同步及注销', async () => {
  try {
    assert.equal((await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const login = await browser('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: credentials.username, password: credentials.password}) });
    assert.equal(login.status, 200); const logged = await login.json();
    assert.equal((await browser('/api/applications')).status, 403);
    const identities = [];
    for (const client of secrets.clients) {
      const authorization = await authorize(client);
      const request = { grant_type: 'authorization_code', redirect_uri: client.redirect_uris[0], code: authorization.code, code_verifier: authorization.verifier };
      const exchanged = await token(client, request); assert.equal(exchanged.status, 200);
      const tokens = await exchanged.json();
      const infoResponse = await fetch(`${origin}/me`, { headers: {Authorization:`Bearer ${tokens.access_token}`} });
      assert.equal(infoResponse.status, 200);
      const info = await infoResponse.json(); identities.push(info);
      assert.equal(info.sub, credentials.id); assert.ok(info.identity_session); assert.ok(info.local_user_id);
      assert.equal((await token(client, request)).status, 400);
      const machineResponse = await token(client, { grant_type: 'client_credentials', scope: 'directory:read' });
      assert.equal(machineResponse.status, 200); const machine = await machineResponse.json();
      const directory = await fetch(`${origin}/api/directory/users`, { headers: {Authorization:`Bearer ${machine.access_token}`} });
      assert.equal(directory.status, 200); const snapshot = await directory.json();
      assert.equal(snapshot.users.find(u => u.subject === credentials.id).localUserId, info.local_user_id);
      const membership = await prisma.applicationUser.findUnique({ where: { clientId_userId: {clientId:client.client_id,userId:credentials.id} } });
      assert.equal(membership.localUserId, info.local_user_id);
    }
    assert.notEqual(identities[0].local_user_id, identities[1].local_user_id);
    const sdk = require('../../mg-token-one/mg-gateway/apps/gateway/dist/modules/auth/identity-client.js');
    Object.assign(process.env, { IDENTITY_ENABLED: 'true', IDENTITY_ISSUER: origin, IDENTITY_CLIENT_ID: secrets.clients[0].client_id,
      IDENTITY_CLIENT_SECRET: secrets.clients[0].client_secret, IDENTITY_REDIRECT_URI: secrets.clients[0].redirect_uris[0], IDENTITY_COOKIE_KEY: randomBytes(32).toString('hex') });
    const started = await sdk.startIdentity('/');
    const flowCookie = sdk.cookieValue(started.cookie);
    let sdkUrl = started.url;
    for (let i = 0; i < 12 && !sdkUrl.startsWith(secrets.clients[0].redirect_uris[0]); i++) {
      const response = await browser(sdkUrl);
      assert.ok([302,303].includes(response.status)); sdkUrl = new URL(response.headers.get('location'), origin).href;
    }
    await assert.rejects(sdk.completeIdentity(sdkUrl, 'invalid-cookie'));
    const completed = await sdk.completeIdentity(sdkUrl, flowCookie);
    assert.equal(completed.profile.sub, credentials.id);
    assert.equal(completed.profile.local_user_id, identities[0].local_user_id);
    assert.equal(await sdk.identitySessionActive(credentials.id, completed.profile.identity_session), true);
    assert.ok((await sdk.identityDirectory()).some(u => u.subject === credentials.id));
    await prisma.applicationUser.update({ where: { clientId_userId: { clientId: secrets.clients[0].client_id, userId: credentials.id } }, data: { enabled: false } });
    assert.equal(await sdk.identitySessionActive(credentials.id, completed.profile.identity_session), false);
    await prisma.applicationUser.update({ where: { clientId_userId: { clientId: secrets.clients[0].client_id, userId: credentials.id } }, data: { enabled: true } });
    const client = secrets.clients[0];
    const machine = await (await token(client, {grant_type:'client_credentials',scope:'directory:read'})).json();
    const check = () => fetch(`${origin}/api/directory/session`, {method:'POST',headers:{Authorization:`Bearer ${machine.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({subject:credentials.id,sessionId:identities[0].identity_session})}).then(r=>r.json());
    assert.equal((await check()).active, true);
    const logout = await browser('/api/auth/logout', {method:'POST',headers:{'X-CSRF-Token':logged.csrfToken}}); assert.equal(logout.status,204);
    assert.equal((await check()).active,false);
    assert.equal(await sdk.identitySessionActive(credentials.id, completed.profile.identity_session), false);
    // 保留浏览器旧 OIDC Cookie，中心注销后仍必须重新登录。
    const afterLogout = await sdk.startIdentity('/');
    let next = afterLogout.url; let reachedLogin = false;
    for (let i = 0; i < 10; i++) {
      const response = await browser(next); const location = response.headers.get('location');
      assert.ok(location, '注销后未回到登录流程'); next = new URL(location, origin).href;
      assert.ok(!next.startsWith(secrets.clients[0].redirect_uris[0]), '旧 Cookie 绕过了中心注销');
      if (new URL(next).pathname === '/' && new URL(next).searchParams.has('interaction')) { reachedLogin = true; break; }
    }
    assert.equal(reachedLogin, true);
    assert.equal((await browser('/api/applications')).status, 401);
    // 再次登录后，由业务应用发起退出，应使两个应用的同一中心会话一起失效。
    const again = await browser('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})});
    assert.equal(again.status,200);
    const activeSessions=[];
    for (const client of secrets.clients) {
      const authorization=await authorize(client);
      const exchanged=await token(client,{grant_type:'authorization_code',redirect_uri:client.redirect_uris[0],code:authorization.code,code_verifier:authorization.verifier});
      assert.equal(exchanged.status,200);const access=await exchanged.json();
      const info=await (await fetch(`${origin}/me`,{headers:{Authorization:`Bearer ${access.access_token}`}})).json();
      activeSessions.push(info.identity_session);
    }
    assert.equal(activeSessions[0],activeSessions[1]);
    const otherDevice=await prisma.authSession.create({data:{userId:credentials.id,tokenHash:randomBytes(32).toString('hex'),csrfToken:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+60000)}});
    await assert.rejects(sdk.identityEndSession(credentials.id,otherDevice.id));
    assert.equal((await prisma.authSession.findUnique({where:{id:otherDevice.id}})).revokedAt,null);
    await sdk.identityEndSession(credentials.id,activeSessions[0]);
    for (const sessionId of activeSessions) assert.equal(await sdk.identitySessionActive(credentials.id,sessionId),false);
    assert.equal((await browser('/api/auth/me')).status,401);
  } finally { await prisma.$disconnect(); }
});
