import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { unifiedIdentity, UnifiedAuthError } from './unified-client';
import { allowedOrigins, desktopOrigin, identityOrigin, publicApp, registry, allowsApiPath, desktopPresentation, essentialApplicationIds, type RegisteredApp } from './config';
import { ApplicationInputError, createApplicationStore } from './applications';
import { safeAppPath, appAllowsPath } from '../../../../mg-platform/packages/frontend/desktop-contracts/src/index';
import { hasRequiredRole } from './application-access';
import { createNotificationStore } from './notifications';
import { createServiceRegistry, ServiceError,validateRegistrySnapshot } from './services';
import {ContractError} from './service-contracts';
import {createPostgresServiceStorage,servicePool,ServiceStorageUnavailable} from './service-postgres';
import {withServiceSnapshot} from './service-snapshot';
import {createDeploymentSource,deploymentDigest,ServiceBindingError} from './service-deployments';
import {createApplicationVersionReader} from './application-versions';
const applicationVersion=createApplicationVersionReader();

const TOKEN_COOKIE = 'mg_desktop_token', FLOW_COOKIE = 'mg_desktop_flow';
const port = Number(process.env.PORT || 4300);
const runtime = resolve(process.env.DESKTOP_RUNTIME_DIR || '.runtime');
const notifications = createNotificationStore(resolve(runtime, 'notifications'));
const applications = createApplicationStore(resolve(runtime, 'applications'), [...allowedOrigins, identityOrigin]);
const serviceDir=resolve(runtime,'services');
if(process.env.SERVICE_DATABASE_URL&&!process.env.SERVICE_ENVIRONMENT)throw Error('数据库模式必须配置 SERVICE_ENVIRONMENT');
const serviceAppIds=new Set(registry.filter(a=>a.id!=='service-manager').map(a=>a.id));
const serviceEnvironment=process.env.SERVICE_ENVIRONMENT||'local';
const serviceDeployments=process.env.SERVICE_DEPLOYMENTS_FILE?createDeploymentSource(process.env.SERVICE_DEPLOYMENTS_FILE,serviceAppIds):undefined;
if(serviceDeployments){if(!process.env.SERVICE_DATABASE_URL)throw Error('环境部署绑定需要独立数据库');await serviceDeployments.refresh();if(!serviceDeployments.get().environments.some(e=>e.id===serviceEnvironment))throw Error('运行环境未在受控部署配置中登记');}
function serviceContext(environment:string){
 const validated=new Set<string>();
 const persistence=process.env.SERVICE_DATABASE_URL?withServiceSnapshot(createPostgresServiceStorage(servicePool(process.env.SERVICE_DATABASE_URL),environment),serviceDir,environment,state=>validateRegistrySnapshot(state,serviceAppIds,validated)):undefined;
 const store=createServiceRegistry(serviceDir,serviceAppIds,persistence?.storage,serviceDeployments?{environment,deployments:()=>serviceDeployments.get(),refresh:()=>serviceDeployments.refresh()}:undefined);
 return {store,persistence};
}
const contexts=new Map<string,ReturnType<typeof serviceContext>>();
const currentContext=serviceContext(serviceEnvironment);contexts.set(serviceEnvironment,currentContext);
const services=currentContext.store,servicePersistence=currentContext.persistence;
async function managementContext(environment:string){
 if(environment===serviceEnvironment)return currentContext;
 if(!serviceDeployments?.get().environments.some(e=>e.id===environment))throw new ServiceBindingError('目标环境未配置',404);
 let context=contexts.get(environment);if(!context){context=serviceContext(environment);await context.store.initialize();contexts.set(environment,context);}return context;
}
const staticRoot = resolve(process.env.DESKTOP_WEB_DIR || 'dist/web');
await mkdir(runtime, { recursive: true });
await services.initialize();
let flowKey: Buffer;
if (process.env.DESKTOP_FLOW_KEY) {
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.DESKTOP_FLOW_KEY)) throw new Error('桌面登录流程密钥格式无效');
  flowKey = Buffer.from(process.env.DESKTOP_FLOW_KEY, 'hex');
} else {
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境必须提供 DESKTOP_FLOW_KEY');
  const keyPath = resolve(runtime, 'flow.key');
  try { flowKey = await readFile(keyPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    flowKey = randomBytes(32); await writeFile(keyPath, flowKey, { flag: 'wx', mode: 0o600 });
  }
  if (flowKey.length !== 32) throw new Error('桌面登录流程密钥无效');
}
function pack(value: object) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', flowKey, iv); cipher.setAAD(Buffer.from(FLOW_COOKIE));
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
function unpack(value: string) {
  const packed = Buffer.from(value, 'base64url');
  if (packed.length < 29 || packed.length > 4096) throw new Error('登录流程无效');
  const decipher = createDecipheriv('aes-256-gcm', flowKey, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(FLOW_COOKIE)); decipher.setAuthTag(packed.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(packed.subarray(12, -16)), decipher.final()]).toString());
}
function readCookie(req: IncomingMessage, name: string) {
  const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  if (values.length !== 1) return '';
  try { return decodeURIComponent(values[0]!.slice(name.length + 1)); } catch { return ''; }
}
function cookie(name: string, value: string, age: number, path = '/') {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(age))}${new URL(desktopOrigin).protocol === 'https:' ? '; Secure' : ''}`;
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
}
function redirect(res: ServerResponse, location: string) { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function equal(a: unknown, b: string) { if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
async function body(req: IncomingMessage, limit=65536) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new ServiceError('请求过大',413); chunks.push(chunk); }
  try{return JSON.parse(Buffer.concat(chunks).toString() || '{}');}catch{throw new ServiceError('请求 JSON 格式无效');}
}
function requestedTarget(url: URL) {
  const app = registry.find(a => a.id === url.searchParams.get('app'));
  const externalId = /^external-[a-f0-9-]{36}$/.test(url.searchParams.get('app') || '') ? url.searchParams.get('app')! : '';
  const route = safeAppPath(url.searchParams.get('path'), app?.defaultPath || '/');
  return { appId: app?.id || externalId, path: app && appAllowsPath(app, route) ? route : app?.defaultPath || '/', standalone: !!app && url.searchParams.get('display') === 'standalone' };
}
async function session(req: IncomingMessage) {
  const token = readCookie(req, TOKEN_COOKIE);
  if (!token) throw new UnifiedAuthError(401, '请通过统一认证登录');
  return { token, profile: await unifiedIdentity.introspect(token) };
}
async function grantedApplications(token: string) {
  const authorized = new Set((await unifiedIdentity.applications(token)).map(a => a.id));
  const candidates: RegisteredApp[] = [];
  for (const app of registry) {
    if (essentialApplicationIds.has(app.id) || authorized.has(app.authorizationAppId || app.id)) { candidates.push(app); continue; }
    // 新登记 audience 在目录接口同步异常时仍以中心的精确内省为最终授权依据，不能因目录缺项误放开。
    if (app.id === 'low-alt-cockpit') {
      try { await unifiedIdentity.introspect(token, app.authorizationAppId || app.id); candidates.push(app); }
      catch { /* 未获该 audience 授权时保持不可见。 */ }
    }
  }
  return (await Promise.all(candidates.map(async app => await hasRequiredRole(app, token) ? app : null))).filter((app): app is RegisteredApp => app !== null);
}
function csrf(req: IncomingMessage, value: string) {
  if (!allowedOrigins.has(req.headers.origin || '') || !equal(req.headers['x-csrf-token'], value)) throw new UnifiedAuthError(401, '请求验证失败，请刷新后重试');
}
const renewing = new Map<string, ReturnType<typeof unifiedIdentity.renew>>();
async function renew(token: string) {
  const key = createHash('sha256').update(token).digest('hex');
  let pending = renewing.get(key);
  if (!pending) { pending = unifiedIdentity.renew(token); renewing.set(key, pending); }
  try { return await pending; } finally { if (renewing.get(key) === pending) renewing.delete(key); }
}
function proxy(req: IncomingMessage, res: ServerResponse, app: RegisteredApp, rest: string, token: string) {
  const target = new URL(app.upstream + rest);
  const expected = new URL(app.upstream);
  if (target.origin !== expected.origin || !target.pathname.startsWith(expected.pathname.replace(/\/$/, '') + '/')) { json(res, 400, { message: '应用请求路径无效' }); return; }
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'accept-encoding': 'identity' };
  for (const key of ['content-type', 'content-length', 'accept', 'x-csrf-token', 'range', 'if-none-match', 'if-match', 'last-event-id']) {
    const value = req.headers[key]; if (typeof value === 'string') headers[key] = value;
  }
  const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers }, response => {
    const outgoing: Record<string, string | string[]> = {};
    for (const key of ['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers[key]; if (value !== undefined) outgoing[key] = value;
    }
    // 登录 Cookie 始终由统一入口管理，业务响应不向浏览器写入另一套会话。
    outgoing['cache-control'] = 'no-store'; outgoing['x-accel-buffering'] = 'no';
    if (response.headers.location) {
      const location = new URL(response.headers.location, target);
      if (location.origin === new URL(app.entryUrl).origin) outgoing.location = location.href;
    }
    response.on('error', () => res.destroy()); response.on('aborted', () => res.destroy());
    res.writeHead(response.statusCode || 502, outgoing); response.pipe(res);
  });
  upstream.setTimeout(300_000, () => upstream.destroy(new Error('业务请求超时')));
  upstream.on('error', () => { if (!res.headersSent) json(res, 502, { message: '业务服务暂时不可用，请稍后重试' }); else res.destroy(); });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  // 字体是公开静态资源，独立于会话/API CORS；不携带或设置认证 Cookie。
  if (req.url?.startsWith('/fonts/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const path = new URL(req.url, desktopOrigin).pathname;
    if (!/^\/fonts\/(?:fonts\.css|alinormal-(?:400|500|600)-[a-f0-9]{12}\.woff2)$/.test(path)) { res.writeHead(404); res.end(); return; }
    try {
      const data = await readFile(resolve(staticRoot, '.' + path));
      res.writeHead(200, { 'Content-Type': path.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2',
        'Cache-Control': path.endsWith('.css') ? 'public, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable', 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; frame-src https: http:; object-src 'none'; base-uri 'self'");
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.has(origin)) { json(res, 403, { message: '未授权的应用来源' }); return; }
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Request-Id, X-Service-Lifecycle, X-Service-Retire-After');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, If-Match, Range, Last-Event-ID', 'Access-Control-Max-Age': '600' }); res.end(); return; }
  try {
    const url = new URL(req.url || '/', desktopOrigin);
    if (url.pathname === '/api/health') { json(res, 200, { status: 'ready', application: 'mg-desktop-one' }); return; }
    if (url.pathname === '/auth/start' && req.method === 'GET') {
      const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
      const flow = { verifier, state, issued: Date.now(), ...requestedTarget(url) };
      res.setHeader('Set-Cookie', cookie(FLOW_COOKIE, pack(flow), 600, '/auth'));
      const target = new URL('/api/unified/authorize', identityOrigin);
      target.search = new URLSearchParams({ client_id: process.env.IDENTITY_CLIENT_ID || 'desktop-one', redirect_uri: `${desktopOrigin}/auth/callback`, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      redirect(res, target.href); return;
    }
    if (url.pathname === '/auth/callback' && req.method === 'GET') {
      res.setHeader('Set-Cookie', cookie(FLOW_COOKIE, '', 0, '/auth'));
      let flow;
      try { flow = unpack(readCookie(req, FLOW_COOKIE)); } catch { throw new UnifiedAuthError(401, '登录请求已失效，请重新登录'); }
      if (!equal(url.searchParams.get('state'), flow.state) || !Number.isFinite(flow.issued) || Date.now() - flow.issued > 600_000 || flow.issued > Date.now()) throw new UnifiedAuthError(401, '登录请求校验失败');
      const result = await unifiedIdentity.exchange(url.searchParams.get('code') || '', flow.verifier, `${desktopOrigin}/auth/callback`);
      res.setHeader('Set-Cookie', [cookie(FLOW_COOKIE, '', 0, '/auth'), cookie(TOKEN_COOKIE, result.token, result.profile.exp - Date.now() / 1000)]);
      const standaloneApp = registry.find(a => a.id === flow.appId);
      if (flow.standalone === true && standaloneApp && appAllowsPath(standaloneApp, flow.path)) {
        await unifiedIdentity.introspect(result.token, standaloneApp.authorizationAppId || standaloneApp.id);
        if (!await hasRequiredRole(standaloneApp, result.token)) { json(res, 403, { message: '当前业务账号没有此应用的访问权限' }); return; }
        redirect(res, standaloneApp.entryUrl.replace(/\/$/, '') + safeAppPath(flow.path)); return;
      }
      const returnTo = new URL('/open', desktopOrigin);
      if (registry.some(a => a.id === flow.appId) || (await applications.list(result.profile.sub)).some(a => a.id === flow.appId)) { returnTo.searchParams.set('app', flow.appId); returnTo.searchParams.set('path', safeAppPath(flow.path)); }
      redirect(res, returnTo.pathname + returnTo.search); return;
    }
    if (url.pathname === '/api/session' && req.method === 'GET') {
      const { token, profile } = await session(req);
      const granted = await grantedApplications(token);
      json(res, 200, { user: { id: profile.sub, name: profile.name, username: profile.username, role: profile.role, department: profile.department, avatarUrl: profile.avatarUrl || null },
        csrfToken: profile.csrfToken, expiresAt: profile.exp, desktop: desktopPresentation, apps: [...granted.map(publicApp), ...await applications.list(profile.sub)] }); return;
    }
    const applicationRoute = /^\/api\/applications(?:\/([a-z0-9-]+))?$/.exec(url.pathname);
    if (applicationRoute) {
      const { token, profile } = await session(req), id = applicationRoute[1];
      await unifiedIdentity.introspect(token, 'app-manager');
      if (req.method === 'GET' && !id) {
        const available = new Set((await grantedApplications(token)).map(app => app.id));
        const managedApps=await Promise.all(registry.filter(app=>available.has(app.id)).map(async app=>({...publicApp(app),version:await applicationVersion(app),editable:false,available:true})));
        json(res, 200, { desktop: desktopPresentation, items: [
          ...managedApps,
          ...(await applications.list(profile.sub)).map(app => ({ ...app, editable: true, available: true })),
        ] }); return;
      }
      csrf(req, profile.csrfToken);
      if (id && registry.some(app => app.id === id)) throw new ApplicationInputError('系统和内部应用不可编辑', 403);
      if ((req.method === 'POST' && !id) || (req.method === 'PUT' && id)) {
        const app = await applications.save(profile.sub, await body(req), id);
        json(res, req.method === 'POST' ? 201 : 200, { ...app, editable: true, available: true }); return;
      }
      if (req.method === 'DELETE' && id) { await applications.remove(profile.sub, id); json(res, 200, { ok: true }); return; }
      json(res, 405, { message: '不支持此请求方法' }); return;
    }
    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      const { token, profile } = await session(req); csrf(req, profile.csrfToken);
      await unifiedIdentity.revoke(token); res.setHeader('Set-Cookie', cookie(TOKEN_COOKIE, '', 0)); json(res, 200, { ok: true }); return;
    }
    if (url.pathname === '/auth/renew' && req.method === 'POST') {
      const { token, profile } = await session(req); csrf(req, profile.csrfToken);
      const updated = await renew(token); res.setHeader('Set-Cookie', cookie(TOKEN_COOKIE, updated.token, updated.profile.exp - Date.now() / 1000));
      json(res, 200, { expiresAt: updated.profile.exp }); return;
    }
    if (url.pathname === '/api/service-registry' || url.pathname.startsWith('/api/service-registry/')) {
      const {token,profile}=await session(req);
      await unifiedIdentity.introspect(token,'service-manager');
      const canManage=profile.role==='system_admin';
      const allowed=new Set((await grantedApplications(token)).map(a=>a.id));
      await serviceDeployments?.refresh();
      const environments=url.searchParams.getAll('environment');if(environments.length>1)throw new ServiceBindingError('只能指定一个目标环境');
      const environment=environments[0]||serviceEnvironment;
      if(environment!==serviceEnvironment&&!canManage)throw new ServiceBindingError('只有管理员可管理其他环境',403);
      if(serviceDeployments&&req.method!=='GET'&&!environments[0])throw new ServiceBindingError('请刷新页面并明确选择目标环境');
      const context=await managementContext(environment),managed=context.store;
      if(req.method==='GET'&&url.pathname==='/api/service-registry') {
        await managed.refresh();
        const options=serviceDeployments?.get().environments.find(e=>e.id===environment)?.deployments.filter(d=>allowed.has(d.appId)).map(d=>({...d,digest:deploymentDigest(d)}))||[];
        json(res,200,{items:managed.list(allowed),activity:managed.activity(allowed),audit:canManage?managed.audit():[],canManage,storage:context.persistence?.status()||{backend:'json',environment},runningEnvironment:serviceEnvironment,bindingRequired:!!serviceDeployments,environments:serviceDeployments?.get().environments.filter(e=>canManage||e.id===serviceEnvironment).map(e=>({id:e.id,name:e.name}))||[{id:serviceEnvironment,name:serviceEnvironment}],deployments:options});return;
      }
      if(!canManage)throw new ServiceError('只有已授权的平台管理员可以维护服务',403);
      csrf(req,profile.csrfToken);
      if(req.method==='POST'&&url.pathname==='/api/service-registry/publications') {
        const payload=await body(req,600*1024);
        if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ServiceError('登记请求必须是 JSON 对象');
        if('manifest' in payload&&Object.keys(payload).some(key=>!['manifest','contract'].includes(key)))throw new ServiceError('登记请求包含无效字段');
        const input='manifest' in payload?payload.manifest:payload;
        if(!input||typeof input!=='object')throw new ServiceError('缺少服务清单');
        if(!allowed.has(input.appId))throw new ServiceError('没有提供应用的访问权限',403);
        // 地址始终由平台已登记的应用绑定，不接受清单上传任意上游 URL。
        const app=registry.find(a=>a.id===input.appId);
        if(!app||!Array.isArray(input.operations)||input.operations.some((op:any)=>typeof op.path!=='string'||!allowsApiPath(app,op.path.replace(/\{[^}]+\}/g,'test'))))throw new ServiceError('接口超出应用允许范围',403);
        json(res,201,await managed.publish(input,profile.sub,'manifest' in payload?payload.contract:undefined));return;
      }
      if(req.method==='POST'&&url.pathname==='/api/service-registry/activation') {
        const input=await body(req);
        await managed.refresh();
        if(!managed.list(allowed).some(p=>p.manifest.serviceId===input.serviceId))throw new ServiceError('服务不存在或无权维护',404);
        if(input.version!==null&&typeof input.version!=='string')throw new ServiceError('版本无效');
        if(Object.keys(input).some(key=>!['serviceId','version','expectedRevision','allowBreaking','allowContractChange','endpointRef','expectedDeploymentDigest'].includes(key)))throw new ServiceBindingError('发布请求包含不支持的字段，地址只能来自受控部署');
        json(res,200,await managed.activate(input.serviceId,input.version,profile.sub,{expectedRevision:input.expectedRevision,allowBreaking:input.allowBreaking===true,allowContractChange:input.allowContractChange===true,endpointRef:input.endpointRef,expectedDeploymentDigest:input.expectedDeploymentDigest}));return;
      }
      if(req.method==='POST'&&url.pathname==='/api/service-registry/lifecycle') {
        const input=await body(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['serviceId','version','status','reason','retireAfter','expectedRevision'].includes(key)))throw new ServiceError('生命周期请求包含无效字段');
        await managed.refresh();
        if(!managed.list(allowed).some(p=>p.manifest.serviceId===input.serviceId&&p.manifest.version===input.version))throw new ServiceError('服务版本不存在或无权维护',404);
        json(res,200,await managed.setLifecycle(input.serviceId,input.version,profile.sub,input));return;
      }
      throw new ServiceError('接口不存在',404);
    }
    const servicePath=/^\/api\/services\/apps\/([a-z0-9-]+)(\/.*)$/.exec(url.pathname);
    const serviceCall=/^\/api\/services\/invoke\/([a-z0-9.-]+)\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if(servicePath||serviceCall) {
      const {token}=await session(req);
      await serviceDeployments?.refresh();
      await services.refresh({allowCache:true});
      const params:Record<string,string>={};
      if(serviceCall)for(const [key,value] of url.searchParams)if(key.startsWith('path.'))params[key.slice(5)]=value;
      const target=servicePath?services.resolve(servicePath[1]!,req.method||'GET',servicePath[2]!):services.invoke(serviceCall![1]!,serviceCall![2]!,req.method||'GET',params);
      const app=registry.find(a=>a.id===target.manifest.appId);
      if(!app||!allowsApiPath(app,target.path))throw new ServiceError('服务绑定不可用',403);
      const profile=await unifiedIdentity.introspect(token,app.authorizationAppId||app.id);
      if(!await hasRequiredRole(app,token))throw new ServiceError('没有提供应用的访问权限',403);
      if(!['GET','HEAD'].includes(req.method||''))csrf(req,profile.csrfToken);
      const deployment=services.deployment(target.manifest.serviceId);
      const requestId=randomBytes(16).toString('hex'),start=Date.now();
      res.setHeader('X-Request-Id',requestId);res.setHeader('X-Service-Id',target.manifest.serviceId);
      res.setHeader('X-Service-Lifecycle',target.lifecycle.status);
      if(target.lifecycle.status==='deprecated'&&target.lifecycle.retireAfter)res.setHeader('X-Service-Retire-After',target.lifecycle.retireAfter);
      if(servicePersistence)res.setHeader('X-Service-Catalog',servicePersistence.status().stale?'cached':'current');
      res.once('finish',()=>{if(servicePersistence?.status().stale)return;void services.record({serviceId:target.manifest.serviceId,operationId:target.operation.operationId,actor:profile.sub,status:res.statusCode,durationMs:Date.now()-start}).catch(()=>console.error('服务调用记录写入失败'));});
      const query=new URLSearchParams(url.searchParams);if(serviceCall)for(const key of [...query.keys()])if(key.startsWith('path.'))query.delete(key);
      if(deployment){res.setHeader('X-Service-Environment',serviceEnvironment);res.setHeader('X-Service-Deployment',deployment.deploymentId);}
      proxy(req,res,deployment?{...app,upstream:deployment.baseUrl}:app,target.path+(query.size?'?'+query.toString():''),token);return;
    }
    const match = /^\/api\/apps\/([a-z0-9-]+)(\/.*)$/.exec(url.pathname);
    if (match) {
      const app = registry.find(a => a.id === match[1]); if (!app) { json(res, 404, { message: '应用不存在' }); return; }
      const { token } = await session(req);
      if (!allowsApiPath(app, match[2]!)) { json(res, 403, { message: '该接口不属于此应用' }); return; }
      if (app.id === 'token-one-docs' && !['GET', 'HEAD'].includes(req.method || '')) { json(res, 403, { message: '文档应用仅提供读取接口' }); return; }
      const profile = await unifiedIdentity.introspect(token, app.authorizationAppId || app.id);
      if (!await hasRequiredRole(app, token)) { json(res, 403, { message: '当前业务账号没有此应用的访问权限' }); return; }
      if (!['GET', 'HEAD'].includes(req.method || '')) csrf(req, profile.csrfToken);
      proxy(req, res, app, match[2]! + url.search, token); return;
    }
    if (url.pathname === '/api/notifications') {
      const { profile } = await session(req);
      if (req.method === 'GET') { json(res, 200, { items: await notifications.list(profile.sub) }); return; }
      if (!['POST', 'PATCH', 'DELETE'].includes(req.method || '')) { json(res, 405, { message: '不支持此请求方法' }); return; }
      csrf(req, profile.csrfToken); const input = await body(req);
      if (!input || typeof input !== 'object' || Array.isArray(input) || (input.id !== undefined && (typeof input.id !== 'string' || !input.id || input.id.length > 80))) { json(res, 400, { message: '通知参数无效' }); return; }
      if (req.method === 'POST') {
        const app = registry.find(item => item.id === input.appId);
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500 || (input.appId && !app)) { json(res, 400, { message: '通知内容无效' }); return; }
        json(res, 201, { items: await notifications.add(profile.sub, { text: input.text.trim(), appId: app?.id || '', appName: app?.name || '桌面' }) }); return;
      }
      if (req.method === 'PATCH' && input.read !== true) { json(res, 400, { message: '通知状态无效' }); return; }
      json(res, 200, { items: req.method === 'PATCH' ? await notifications.markRead(profile.sub, input.id) : await notifications.remove(profile.sub, input.id) }); return;
    }
    if (url.pathname === '/api/preferences') {
      const { profile } = await session(req);
      // 旧标签页不能把前一个账户的偏好读写到新登录的账户。
      if (req.headers['x-desktop-account'] && req.headers['x-desktop-account'] !== profile.sub) {
        json(res, 409, { code: 'ACCOUNT_CHANGED', message: '账户已切换，请重新加载桌面' }); return;
      }
      const dir = resolve(runtime, 'preferences'); await mkdir(dir, { recursive: true });
      const file = resolve(dir, createHash('sha256').update(profile.sub).digest('hex') + '.json');
      if (req.method === 'GET') { try { json(res, 200, JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; json(res, 200, {}); } return; }
      if (req.method === 'PUT') { csrf(req, profile.csrfToken); const input = await body(req);
        const personalApps = await applications.list(profile.sub);
        const applicationIds = new Set([...registry, ...personalApps].map(app => app.id));
        const value = { theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
          wallpaper: ['dawn', 'dusk'].includes(input.wallpaper) ? input.wallpaper : 'dawn', restore: input.restore !== false,
          pinned: Array.isArray(input.pinned) ? [...new Set(input.pinned.filter((id: unknown) => typeof id === 'string' && applicationIds.has(id)))].slice(0, 40) : registry.map(a => a.id),
          applicationOrder: Array.isArray(input.applicationOrder) ? [...new Set(input.applicationOrder.filter((id: unknown) => typeof id === 'string' && applicationIds.has(id)))].slice(0, 40) : [] };
        await writeFile(file, JSON.stringify(value), { mode: 0o600 }); json(res, 200, value); return;
      }
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) { json(res, 404, { message: '接口不存在' }); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { message: '不支持此请求方法' }); return; }
    const requestedFile = /^\/(assets|app-icons)\//.test(url.pathname) ? resolve(staticRoot, '.' + decodeURIComponent(url.pathname)) : resolve(staticRoot, 'index.html');
    if (!requestedFile.startsWith(staticRoot + sep)) { json(res, 404, { message: '文件不存在' }); return; }
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
    const data = await readFile(requestedFile); res.writeHead(200, { 'Content-Type': types[extname(requestedFile)] || 'application/octet-stream', 'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store' }); res.end(data);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if(error instanceof ServiceStorageUnavailable)json(res,503,{message:error.message});
    else if (error instanceof UnifiedAuthError || error instanceof ApplicationInputError || error instanceof ServiceError || error instanceof ContractError || error instanceof ServiceBindingError) json(res, error.status, { message: error.message });
    else if ((error as NodeJS.ErrnoException).code === 'ENOENT') json(res, 503, { message: '桌面前端尚未构建，请启动前端开发服务' });
    else json(res, 500, { message: '桌面请求未完成，请稍后重试' });
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`MG 桌面服务已启动：${port}`));
function stop() { server.close(() => process.exit(0)); server.closeIdleConnections(); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
