import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';
const issuer = 'http://127.0.0.1:18880/realms/mg-identity-spike';
const user = JSON.parse(await fs.readFile(new URL('./private/spike/test-user.json', import.meta.url)));
const checks = [];
let discoveryResponse;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2000) });
    if (discoveryResponse.status === 200) break;
  } catch { /* 容器首次启动需要初始化。 */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(discoveryResponse, '本地认证实例尚未就绪');
assert.equal(discoveryResponse.status, 200);
const discovery = await discoveryResponse.json();
assert.equal(discovery.issuer, issuer);
const keys = (await (await fetch(discovery.jwks_uri)).json()).keys;
checks.push('发现文档与签名公钥可用');
const cookies = new Map();
async function browser(url, options = {}) {
  assert.equal(new URL(url).origin, 'http://127.0.0.1:18880');
  const response = await fetch(url, { ...options, redirect: 'manual', headers: { ...options.headers, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') } });
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(';')[0]; const offset = part.indexOf('=');
    cookies.set(part.slice(0, offset), part.slice(offset + 1));
  }
  return response;
}
function request(client, port, prompt) {
  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(24).toString('hex');
  const state = randomBytes(24).toString('hex');
  const redirect = `http://127.0.0.1:${port}/callback`;
  const query = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'openid', state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  if (prompt) query.set('prompt', prompt);
  return { client, verifier, nonce, state, redirect, url: `${discovery.authorization_endpoint}?${query}` };
}
function codeFrom(response, attempt) {
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin + location.pathname, attempt.redirect);
  assert.equal(location.searchParams.get('state'), attempt.state);
  assert.ok(location.searchParams.get('code'));
  return location.searchParams.get('code');
}
async function exchange(attempt, code, verifier = attempt.verifier) {
  return fetch(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: attempt.client,
    redirect_uri: attempt.redirect, code, code_verifier: verifier }) });
}
function validate(token, attempt) {
  const [header, payload, signature] = token.split('.');
  const h = JSON.parse(Buffer.from(header, 'base64url'));
  assert.equal(h.alg, 'RS256');
  const key = keys.find(k => k.kid === h.kid); assert.ok(key);
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url')));
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, issuer); assert.equal(claims.aud, attempt.client);
  assert.equal(claims.nonce, attempt.nonce); assert.ok(claims.exp > Date.now() / 1000);
  assert.ok(claims.sub); return claims;
}
const first = request('token-one', 18881);
const login = await browser(first.url);
assert.equal(login.status, 200);
const html = await login.text();
const action = html.match(/<form[^>]+action="([^"]+)"/);
assert.ok(action, '未找到登录表单');
const authenticated = await browser(action[1].replaceAll('&amp;', '&'), { method: 'POST', body: new URLSearchParams(user) });
const firstCode = codeFrom(authenticated, first);
const firstResponse = await exchange(first, firstCode); assert.equal(firstResponse.status, 200);
const firstTokens = await firstResponse.json(); const firstClaims = validate(firstTokens.id_token, first);
checks.push('应用一完成授权码与 PKCE 登录，校验签名、签发方、受众、nonce 和有效期');
assert.equal((await exchange(first, firstCode)).status, 400); checks.push('授权码重放被拒绝');
const second = request('expert-database', 18882, 'none');
const secondCode = codeFrom(await browser(second.url), second);
const secondResponse = await exchange(second, secondCode); assert.equal(secondResponse.status, 200);
const secondTokens = await secondResponse.json(); const secondClaims = validate(secondTokens.id_token, second);
assert.equal(firstClaims.sub, secondClaims.sub);
assert.throws(() => validate(secondTokens.id_token, first));
checks.push('同一登录会话免再次认证进入应用二，两个应用受众隔离');
const wrong = request('token-one', 18881, 'none');
const wrongCode = codeFrom(await browser(wrong.url), wrong);
assert.equal((await exchange(wrong, wrongCode, randomBytes(32).toString('base64url'))).status, 400);
checks.push('错误 PKCE verifier 被拒绝');
const illegal = new URL(first.url); illegal.searchParams.set('redirect_uri', 'https://example.invalid/callback');
assert.equal((await browser(illegal)).status, 400); checks.push('未登记回调地址被拒绝');
const logout = await browser(`${discovery.end_session_endpoint}?${new URLSearchParams({ id_token_hint: secondTokens.id_token, client_id: second.client })}`);
assert.ok([200, 302, 303].includes(logout.status));
const after = await browser(request('token-one', 18881, 'none').url);
assert.equal(new URL(after.headers.get('location')).searchParams.get('error'), 'login_required');
checks.push('统一会话注销后静默登录被拒绝');
const result = { completedAt: new Date().toISOString(), checks, scope: '独立本地 Keycloak、合成员工和两个测试客户端；不是两个业务系统或真实企微端到端验收' };
await fs.writeFile(new URL('./private/spike/result.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
