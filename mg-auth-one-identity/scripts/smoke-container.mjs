import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const privateDir = path.resolve(import.meta.dirname, '../private/service-test');
const env = parseEnv(await fs.readFile(path.join(privateDir, 'service.env'), 'utf8'));
if (!env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('仅允许本地专用测试配置');
const url = new URL(env.DATABASE_URL); url.hostname = 'host.docker.internal';
Object.assign(env, { DATABASE_URL: url.href, NODE_ENV: 'development', HOST: '0.0.0.0', IDENTITY_SECRETS_FILE: '/run/identity/identity.json', AUTH_CONFIG_KEY_FILE: '/run/identity/auth-config.key' });
const envFile = path.join(privateDir, 'container.env');
await fs.writeFile(envFile, Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
const name = 'mg-identity-container-test'; let started = false;
try {
  execFileSync('docker', ['run', '--detach', '--rm', '--name', name, '--env-file', envFile, '-v', `${privateDir}:/run/identity:ro`, '-p', '127.0.0.1:14200:4200', 'mg-identity-service:local-check'], { stdio: 'pipe' }); started = true;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { ready = (await fetch('http://127.0.0.1:14200/health', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('容器未就绪');
  const html=await (await fetch('http://127.0.0.1:14200/login')).text();
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m=>m[1]);
  if(assets.length<2)throw new Error('缺少 GUI 资源');
  for(const file of assets){const response=await fetch(`http://127.0.0.1:14200${file}`);if(!response.ok)throw new Error('资源加载失败');}
  if ((await fetch('http://127.0.0.1:14200/api/applications')).status !== 401) throw new Error('管理接口未鉴权');
  console.log('Linux 容器启动、数据库、浏览器资源和管理接口鉴权检查通过');
} catch { console.error('身份容器验证失败'); process.exitCode = 1; }
finally { if (started) execFileSync('docker', ['stop', name], { stdio: 'pipe' }); }
