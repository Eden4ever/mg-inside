import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import pg from 'pg';

// 新建隔离 PostgreSQL 实例，验证真实 JAR；身份与业务接口使用本地替身。
const root = resolve(import.meta.dirname, '..'), kernel = resolve(root, '../mg-platform-kernel');
const work = await mkdtemp(join(root, '.runtime/application-registration-'));
const pgBin = process.env.TEST_POSTGRES_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const jdk = (await readdir(join(kernel, '.runtime/java-tools'))).find(name => name.startsWith('jdk-25'));
const java = join(kernel, '.runtime/java-tools', jdk, 'bin/java.exe');
const buildDirectory = join(work, 'kernel-target');
const jar = process.env.TEST_KERNEL_JAR || join(buildDirectory, 'mg-platform-kernel-0.1.0-SNAPSHOT.jar');
const children = [], granted = new Set(['desktop-one', 'app-manager', 'service-manager', 'files']);
let db, postgres, desktop, databaseStarted = false, profileRole = 'system_admin', profileUser = 'fixture-user';
function child(command, args, env = process.env) {
  const value = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  value.output = ''; value.stdout.on('data', data => value.output = (value.output + data).slice(-12000));
  value.stderr.on('data', data => value.output = (value.output + data).slice(-12000));
  value.done = new Promise((resolve, reject) => { value.once('error', reject); value.once('close', resolve); });
  children.push(value); return value;
}
async function run(command, args, env, expected = 0) {
  const value = child(command, args, env); assert.equal(await value.done, expected, value.output); return value.output;
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mock = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const data = req.headers['content-type']?.includes('application/json') && raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, 'http://localhost');
  const send = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/token') return send({ access_token: 'machine-fixture', expires_in: 60 });
  if (url.pathname === '/api/unified/introspect') {
    const available = data.app_id === 'desktop-one' || !db || Boolean((await db.query(
      'SELECT 1 FROM desktop_applications WHERE enabled=true AND (id=$1 OR authorization_app_id=$1)', [data.app_id])).rowCount);
    return send(granted.has(data.app_id) && available ? {
    active: true, iss: mockOrigin, aud: data.app_id, sub: profileUser, sid: 'fixture-session', role: profileRole,
    name: '注册验证', username: 'fixture', department: null, localUserId: null, authTime: 1700000000, amr: ['pwd'],
    exp: 2000000000, csrfToken: 'fixture-csrf', securityVersion: 1,
    } : { active: false });
  }
  if (url.pathname === '/api/unified/applications') {
    const rows = db ? (await db.query('SELECT id,authorization_app_id FROM desktop_applications WHERE enabled=true')).rows : [];
    const available = new Set(rows.flatMap(row => [row.id, row.authorization_app_id].filter(Boolean)));
    return send({ applications: [...granted].filter(id => id !== 'desktop-one' && available.has(id)).map(id => ({ id, name: id })) });
  }
  if (url.pathname.endsWith('/auth/me')) return send({ user: { role: 'system_admin' } });
  if (url.pathname.endsWith('/capabilities')) return send({ user: { role: 'operator' } });
  if (url.pathname.endsWith('/version.json')) return send({ schemaVersion: 1, appId: 'shared-package', version: '20260909T000000Z' });
  return send({ path: url.pathname, requestId: req.headers['x-request-id'] });
});
mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
const mockOrigin = `http://127.0.0.1:${mock.address().port}`;
const dbPort = await freePort(), httpPort = await freePort(), origin = `http://127.0.0.1:${httpPort}`;
const connection = `postgresql://postgres@127.0.0.1:${dbPort}/postgres`;
const httpDatabase = new URL(connection); httpDatabase.pathname = '/registration_http';
const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(httpPort), DESKTOP_ORIGIN: origin,
  DESKTOP_RUNTIME_DIR: join(work, 'desktop'), DESKTOP_WEB_DIR: join(root, 'dist/web'), DESKTOP_FLOW_KEY: '12'.repeat(32),
  DESKTOP_CONFIG_FILE: join(work, 'presentation.json'), SERVICE_DATABASE_URL: httpDatabase.href,
  SERVICE_ENVIRONMENT: 'local', SERVICE_DEPLOYMENTS_FILE: '', IDENTITY_ISSUER: mockOrigin,
  IDENTITY_CLIENT_ID: 'desktop-one', IDENTITY_CLIENT_SECRET: 'fixture-secret'.repeat(4) };
async function request(path, status = 200, options = {}) {
  const response = await fetch(origin + path, { redirect: 'manual', ...options, headers: { origin,
    cookie: 'mg_desktop_token=' + 'A'.repeat(43), 'content-type': 'application/json', 'x-csrf-token': 'fixture-csrf', ...options.headers }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status, await response.clone().text());
  return response;
}
async function session() { return (await (await request('/api/session')).json()).apps; }
async function migrate(applications, filename = 'registration.json', expected = 0) {
  const file = join(work, filename); await writeFile(file, JSON.stringify({ schemaVersion: 1, applications }));
  return run(java, ['-jar', jar, 'desktop-applications', 'migrate', file], env, expected);
}
try {
  await run(join(pgBin, 'initdb.exe'), ['-D', join(work, 'data'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  postgres = child(join(pgBin, 'postgres.exe'), ['-D', join(work, 'data'), '-h', '127.0.0.1', '-p', String(dbPort)]);
  for (let i = 0; i < 100; i++) {
    const candidate = new pg.Client({ connectionString: connection, connectionTimeoutMillis: 500 });
    try { await candidate.connect(); db = candidate; databaseStarted = true; break; }
    catch { await candidate.end().catch(() => {}); await wait(100); }
  }
  assert(db, '隔离数据库启动失败');
  if (!process.env.TEST_KERNEL_JAR) {
    console.log('隔离 PostgreSQL 已启动，开始 Java 构建与完整测试。');
    await run('pwsh.exe', ['-NoProfile', '-File', join(kernel, 'scripts/java-maven.ps1'), 'verify', '-q'],
      { ...process.env, KERNEL_BUILD_DIRECTORY: buildDirectory, TEST_POSTGRES_URL: `jdbc:postgresql://127.0.0.1:${dbPort}/postgres?user=postgres` });
  }
  console.log('开始显式迁移及真实 JAR HTTP 验证。');
  await db.query('CREATE DATABASE registration_http'); await db.end();
  db = new pg.Client({ connectionString: env.SERVICE_DATABASE_URL }); await db.connect();
  await writeFile(env.DESKTOP_CONFIG_FILE, JSON.stringify({ name: '注册验证桌面', applications: { files: { name: '禁止覆盖数据库名称' } } }));
  const rows = JSON.parse(await readFile(join(kernel, 'src/test/resources/application-fixture.json'), 'utf8'));
  for (const row of rows) { row.entryUrl = mockOrigin + '/apps/' + row.id; row.upstream = mockOrigin + '/provider/' + row.id; }
  const first = await migrate(rows); assert.match(first, /"inserted":12/);
  assert.match(await migrate(rows), /"inserted":0/);
  await run(java, ['-jar', jar, 'desktop-applications', 'schema'], env);
  await db.query(await readFile(join(kernel, 'src/main/resources/db/migration/V1__service_registry.sql'), 'utf8'));
  await run(java,['-jar',jar,'service-storage','api-inventory-schema'],env);
  await run(java,['-jar',jar,'service-storage','workspace-schema'],env);
  const inventoryDocument=JSON.parse(await readFile(join(root,'registrations/api-inventory.json'),'utf8'));
  const publicationDocument=JSON.parse(await readFile(join(root,'registrations/api-publications.json'),'utf8'));
  const imported=await run(java,['-jar',jar,'service-storage','api-inventory-import',join(root,'registrations/api-inventory.json')],env);
  assert.match(imported,/"duplicate":false/);
  assert.match(await run(java,['-jar',jar,'service-storage','api-inventory-import',join(root,'registrations/api-inventory.json')],env),/"duplicate":true/);
  await db.query("INSERT INTO service_environments(name,imported_digest) VALUES('local','fixture')");
  assert.match(await run(java,['-jar',jar,'service-storage','publications-import',join(root,'registrations/api-publications.json')],env),new RegExp(`"inserted":${publicationDocument.publications.length}`));
  assert.match(await run(java,['-jar',jar,'service-storage','publications-import',join(root,'registrations/api-publications.json')],env),new RegExp(`"duplicate":${publicationDocument.publications.length}`));
  // 应用运行账号仅可更新展示字段和内部应用启停，不授予路由、授权字段或 DDL 权限。
  await db.query('CREATE ROLE application_reader LOGIN');
  await db.query('GRANT USAGE ON SCHEMA public TO application_reader');
  await db.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO application_reader');
  await db.query('GRANT UPDATE(name,description,developer,icon,min_width,min_height,default_maximized,enabled,revision,updated_at,registered_version) ON desktop_applications TO application_reader');
  await db.query('GRANT INSERT ON desktop_application_audit TO application_reader');
  await db.query('GRANT INSERT, UPDATE ON service_environments,service_publications,service_bindings,service_version_lifecycles,service_audit,service_activity TO application_reader');
  await db.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO application_reader');
  await db.query('GRANT UPDATE ON service_api_inventory TO application_reader');
  await db.query('GRANT INSERT ON service_api_inventory_history TO application_reader');
  const runtimeDatabase = new URL(env.SERVICE_DATABASE_URL); runtimeDatabase.username = 'application_reader';
  desktop = child(java, ['-jar', jar], { ...env, SERVICE_DATABASE_URL: runtimeDatabase.href });
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (desktop.exitCode !== null) throw Error(desktop.output);
    try { ready = (await fetch(origin + '/api/health')).ok; } catch {}
    if (ready) break; await wait(100);
  }
  assert(ready, desktop.output);
  console.log('受限数据库账号的 Java 服务已就绪，验证动态注册与访问边界。');
  const inventory=await (await request('/api/service-registry/api-inventory')).json();
  assert.equal(inventory.document.entries.length,inventoryDocument.entries.length);
  assert.equal(inventory.revision,1);
  await request('/api/service-registry/api-inventory',401,{method:'POST',headers:{'x-csrf-token':'invalid'},body:JSON.stringify({expectedRevision:1,document:inventoryDocument})});
  await request('/api/service-registry/api-inventory',409,{method:'POST',body:JSON.stringify({expectedRevision:0,document:inventoryDocument})});
  const changedInventory=structuredClone(inventoryDocument);changedInventory.entries[0].note+=' 验证修改。';
  await request('/api/service-registry/api-inventory',200,{method:'POST',body:JSON.stringify({expectedRevision:1,document:changedInventory})});
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM service_api_inventory_history')).rows[0].count,2);
  const updatedInventory=await (await request('/api/service-registry/api-inventory')).json();assert.equal(updatedInventory.revision,2);
  await writeFile(join(work,'api-inventory-evidence.json'),JSON.stringify(updatedInventory,null,2));
  profileRole='member';await request('/api/service-registry/api-inventory',403);await request('/api/service-registry/api-inventory',403,{method:'POST',body:JSON.stringify({expectedRevision:2,document:inventoryDocument})});profileRole='system_admin';
  await request('/api/service-registry/api-inventory',401,{headers:{cookie:''}});
  assert.equal((await session()).find(app => app.id === 'files').name, '文件');
  const added = { ...rows.find(row => row.id === 'files'), id: 'dynamic-app', name: '动态注册应用', kind: 'internal',
    icon: 'resource-manager', entryUrl: 'https://dynamic.example.org', upstream: mockOrigin + '/dynamic',
    authorizationAppId: 'dynamic-audience', allowedApiPaths: ['/echo', '/extra'] };
  await migrate([added], 'dynamic.json');
  assert(!(await session()).some(app => app.id === added.id));
  await request('/api/apps/dynamic-app/echo', 401);
  granted.add('dynamic-audience');
  const application = (await session()).find(app => app.id === added.id);
  assert.equal(application.icon, 'resource-manager');
  assert.equal(application.name, added.name);
  const detailPath = '/api/applications/' + added.id;
  const detail = await (await request(detailPath)).json();
  assert.equal(detail.developer, ''); assert.equal(detail.editable, true);
  const metadata = { name: '编辑后的应用', description: '编辑后的说明', developer: '元引开发团队', icon: 'resource-manager',
    minWidth: 800, minHeight: 600, defaultMaximized: true, expectedRevision: detail.revision };
  await request(detailPath, 401, { method: 'PATCH', headers: { 'x-csrf-token': 'invalid' }, body: JSON.stringify(metadata) });
  profileRole = 'member';
  assert.equal((await (await request(detailPath)).json()).editable, false);
  await request(detailPath, 403, { method: 'PATCH', body: JSON.stringify(metadata) });
  profileRole = 'system_admin';
  await request(detailPath, 400, { method: 'PATCH', body: JSON.stringify({ ...metadata, upstream: 'https://bad.example' }) });
  await request(detailPath, 400, { method: 'PATCH', body: JSON.stringify({ ...metadata, developer: 'x'.repeat(121) }) });
  const savedMetadata = await (await request(detailPath, 200, { method: 'PATCH', body: JSON.stringify(metadata) })).json();
  assert.equal(savedMetadata.developer, metadata.developer); assert.equal(savedMetadata.revision, detail.revision + 1);
  assert.equal((await session()).find(app => app.id === added.id).name, metadata.name);
  assert.equal((await (await request('/api/applications')).json()).items.find(app => app.id === added.id).developer, metadata.developer);
  await request(detailPath, 409, { method: 'PATCH', body: JSON.stringify(metadata) });
  const disabled = await (await request(detailPath, 200, { method: 'PATCH', body: JSON.stringify({ enabled: false, expectedRevision: savedMetadata.revision }) })).json();
  assert.equal(disabled.enabled, false); assert(!(await session()).some(app => app.id === added.id));
  assert.equal((await (await request('/api/applications')).json()).items.find(app => app.id === added.id).enabled, false);
  await request('/api/apps/dynamic-app/echo', 404);
  profileRole = 'member'; await request(detailPath, 403, { method: 'PATCH', body: JSON.stringify({ enabled: true, expectedRevision: disabled.revision }) }); profileRole = 'system_admin';
  await request(detailPath, 200, { method: 'PATCH', body: JSON.stringify({ enabled: true, expectedRevision: disabled.revision }) });
  assert((await session()).some(app => app.id === added.id));
  for (const fixedId of ['app-manager', 'personal-center']) {
    const fixed = await (await request('/api/applications/' + fixedId)).json();
    await request('/api/applications/' + fixedId, 403, { method: 'PATCH', body: JSON.stringify({ enabled: false, expectedRevision: fixed.revision }) });
  }
  const external = await (await request('/api/applications', 201, { method: 'POST', body: JSON.stringify({ name: '个人外链', url: 'https://external-test.example', developer: '外链开发者' }) })).json();
  assert.equal(external.developer, '外链开发者');
  profileUser = 'another-user';
  await request('/api/applications/' + external.id, 404);
  await request('/api/applications/' + external.id, 404, { method: 'PATCH', body: '{"enabled":false}' });
  profileUser = 'fixture-user';
  await request('/api/applications/' + external.id, 200, { method: 'PATCH', body: '{"enabled":false}' });
  assert(!(await session()).some(app => app.id === external.id));
  const editedExternal = await (await request('/api/applications/' + external.id, 200, { method: 'PUT', body: JSON.stringify({ name: '外链修改', url: external.entryUrl, developer: '更新开发者' }) })).json();
  assert.equal(editedExternal.enabled, false); assert.equal(editedExternal.developer, '更新开发者');
  await request('/api/applications/' + external.id, 200, { method: 'PATCH', body: '{"enabled":true}' });
  assert((await session()).some(app => app.id === external.id));
  await request('/api/applications/' + external.id, 200, { method: 'DELETE' });
  const applicationAudits = (await db.query("SELECT action,actor,before_config,after_config FROM desktop_application_audit WHERE application_id=$1 AND action<>'create' ORDER BY sequence", [added.id])).rows;
  assert.deepEqual(applicationAudits.map(row => row.action), ['update', 'disable', 'enable']);
  assert.equal(applicationAudits[0].after_config.developer, metadata.developer);
  assert.equal(applicationAudits[0].actor, 'fixture-user');
  assert.equal(applicationAudits[0].after_config.upstream_url, applicationAudits[0].before_config.upstream_url);
  await writeFile(join(work, 'application-metadata-evidence.json'), JSON.stringify({ savedMetadata, applicationAudits }, null, 2));
  const unregistered = await request('/api/apps/dynamic-app/echo');
  assert.equal(unregistered.headers.get('x-api-governance'), 'unregistered-compatibility');
  const unregisteredBody = await unregistered.json();
  assert.equal(unregisteredBody.path, '/dynamic/echo');
  assert.equal(unregisteredBody.requestId, unregistered.headers.get('x-request-id'));
  await request('/api/apps/dynamic-app/private', 403);
  await request('/api/session', 200, { headers: { origin: added.entryUrl } });
  await request('/api/applications', 400, { method: 'POST', body: JSON.stringify({ name: '冒充平台', url: added.entryUrl }) });
  const manifest = { schemaVersion: 1, serviceId: 'dynamic-app.api', appId: added.id, name: '动态服务', version: '1.0.0',
    description: '注册验证', operations: [{ operationId: 'echo', method: 'GET', path: '/echo', summary: '验证接口', effect: 'read' }] };
  await request('/api/service-registry/publications', 201, { method: 'POST', body: JSON.stringify(manifest) });
  await request('/api/apps/dynamic-app/echo', 404);
  await request('/api/service-registry/activation', 200, { method: 'POST', body: JSON.stringify({ serviceId: manifest.serviceId, version: '1.0.0', expectedRevision: 0 }) });
  const governed = await request('/api/apps/dynamic-app/echo', 200, { headers: { 'x-request-id': 'untrusted-client-id' } });
  assert.equal(governed.headers.get('x-service-id'), manifest.serviceId);
  assert.notEqual(governed.headers.get('x-request-id'), 'untrusted-client-id');
  assert.equal((await governed.json()).requestId, governed.headers.get('x-request-id'));
  await request('/api/apps/dynamic-app/echo', 404, { method: 'POST', body: '{}' });
  await request('/api/services/apps/dynamic-app/echo');
  assert.equal((await request('/api/apps/dynamic-app/echo/')).headers.get('x-service-id'), manifest.serviceId);
  await request('/api/apps/dynamic-app/%65cho', 400);
  await request('/api/apps/dynamic-app//echo', 400);
  await request('/api/service-registry/activation', 200, { method: 'POST', body: JSON.stringify({ serviceId: manifest.serviceId, version: null, expectedRevision: 1 }) });
  await request('/api/apps/dynamic-app/echo', 404);
  await request('/api/apps/dynamic-app/echo/', 404);
  await request('/api/service-registry/activation', 200, { method: 'POST', body: JSON.stringify({ serviceId: manifest.serviceId, version: '1.0.0', expectedRevision: 2 }) });
  await request('/api/apps/dynamic-app/extra');
  await db.query("UPDATE desktop_applications SET runtime_policy=jsonb_set(runtime_policy,'{apiMode}','\"registered\"'::jsonb) WHERE id='dynamic-app'");
  await request('/api/apps/dynamic-app/extra', 404);
  const strict = { ...added, id: 'strict-app', entryUrl: mockOrigin + '/bundle', requiredRole: 'operator',
    runtimePolicy: { rolePath: '/capabilities', rolePointer: '/user/role', versionOwnerAppId: 'shared-package' } };
  await migrate([strict], 'strict.json');
  assert((await session()).some(app => app.id === strict.id));
  assert.equal((await (await request('/api/applications')).json()).items.find(app => app.id === strict.id).version, '20260909T000000Z');
  await db.query("UPDATE desktop_applications SET runtime_policy=jsonb_set(runtime_policy,'{rolePointer}','\"/role\"'::jsonb) WHERE id='strict-app'");
  assert(!(await session()).some(app => app.id === strict.id));
  await request('/api/apps/strict-app/echo', 404);
  for (let attempt = 0; attempt < 50; attempt++) {
    const events = await db.query("SELECT event FROM service_activity WHERE event->>'requestId'=$1", [governed.headers.get('x-request-id')]);
    if (events.rows.length) {
      assert.equal(events.rows[0].event.serviceId, manifest.serviceId);
      assert.equal(events.rows[0].event.version, '1.0.0');
      assert.equal(events.rows[0].event.operationId, 'echo');
      break;
    }
    assert(attempt < 49, '服务调用记录未落库'); await wait(100);
  }
  const audit = (await db.query("SELECT event FROM service_audit WHERE event->>'requestId'=$1", [unregistered.headers.get('x-request-id')])).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].event.action, 'api-route');
  assert.equal(audit[0].event.appId, added.id); assert.equal(audit[0].event.serviceId, undefined);
  assert.equal(audit[0].event.forwarded, true);
  await writeFile(join(work, 'gateway-evidence.json'), JSON.stringify({ audit: audit[0].event,
    activity: (await db.query("SELECT event FROM service_activity WHERE event->>'requestId'=$1", [governed.headers.get('x-request-id')])).rows[0].event }, null, 2));
  await db.query("UPDATE desktop_applications SET name='数据库即时更新',sort_order=-1,upstream_url=$1 WHERE id='dynamic-app'", [mockOrigin + '/updated']);
  assert.equal((await session())[0].name, '数据库即时更新');
  assert.equal((await (await request('/api/apps/dynamic-app/echo')).json()).path, '/updated/echo');
  await migrate([{ ...added, id: 'rollback-candidate' }, added], 'conflict.json', 1);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM desktop_applications WHERE id='rollback-candidate'")).rows[0].count, 0);
  await db.query("UPDATE desktop_applications SET enabled=false WHERE id='dynamic-app'");
  assert(!(await session()).some(app => app.id === added.id));
  await request('/api/apps/dynamic-app/echo', 404);
  await request('/api/session', 403, { headers: { origin: added.entryUrl } });
  await request('/api/applications', 400, { method: 'POST', body: JSON.stringify({ name: '冒充平台', url: added.entryUrl }) });
  await request('/api/service-registry');
  await db.query('REVOKE SELECT ON desktop_applications FROM application_reader');
  await request('/api/session', 503); await request('/api/apps/files/echo', 503);
  assert.equal((await fetch(origin + '/api/health')).status, 503);
  await db.query('GRANT SELECT ON desktop_applications TO application_reader');
  await request('/api/session');
  await db.query("UPDATE desktop_applications SET enabled=false WHERE id IN ('app-manager','service-manager')");
  await request('/api/applications'); await request('/api/service-registry', 403);
  console.log('动态注册验证通过，继续原 Node/Java HTTP 兼容回归。');
  const compatibility = JSON.parse(await run(process.execPath, [join(root, 'scripts/verify-java-platform.mjs')],
    { ...process.env, JAVA_TEST_APPLICATION_DATABASE_URL: env.SERVICE_DATABASE_URL, TEST_KERNEL_JAR: jar }));
  const result = { passed: true, javaTestsRun: !process.env.TEST_KERNEL_JAR, jar, compatibilityEvidence: join(compatibility.workspace, 'result.json'), checks: ['全量服务操作实际登记、分类与重复导入','协议服务禁止代理启用','API 台账权限、修订与历史持久化','显式幂等迁移与冲突回滚', '数据库元数据优先',
    '新增应用及独立 audience 授权', '动态代理与 API 白名单', '图标资源键', '新增应用的服务登记',
    '实时名称排序上游更新', '停用后目录代理来源同步失效', '停用不损坏服务历史', '外链主机保护', '数据库失权返回 503 并可恢复',
    '旧地址接受服务启停及方法约束', '真实 serviceId/version/operationId 落库', '网关生成请求标识并下传', '未登记兼容请求独立治理审计', '新增应用默认拒绝未登记 API'],
    identityAndBusiness: '本地替身', productionChanged: false };
  await writeFile(join(work, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, evidence: join(work, 'result.json') }, null, 2));
} finally {
  if (desktop && desktop.exitCode === null) { desktop.kill(); await desktop.done; }
  if (db) await db.end().catch(() => {});
  if (databaseStarted) await run(join(pgBin, 'pg_ctl.exe'), ['-D', join(work, 'data'), '-m', 'fast', '-w', 'stop']);
  if (postgres && postgres.exitCode === null) { postgres.kill(); await postgres.done; }
  mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));
}
