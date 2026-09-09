import { randomBytes, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
// 输入文件只有应用 ID、名称和精确回调 URL；私密结果不会输出到终端。
const [registrationPath, outputPath] = process.argv.slice(2);
if (!registrationPath || !outputPath) throw new Error('用法：node scripts/generate-secrets.mjs 应用注册.json 新建的私密目录');
const clients = JSON.parse(await fs.readFile(registrationPath, 'utf8'));
if (!Array.isArray(clients) || !clients.length) throw new Error('应用注册列表无效');
const root = path.resolve(outputPath);
await fs.mkdir(root, { mode: 0o700 });
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const key = { ...privateKey.export({ format: 'jwk' }), kid: randomBytes(16).toString('hex'), use: 'sig', alg: 'RS256' };
const registered = [];
for (const client of clients) {
  if (!/^[a-z0-9-]+$/.test(client.client_id) || !Array.isArray(client.redirect_uris) || client.redirect_uris.length !== 1) throw new Error('每个应用需要唯一 ID 和一个精确回调 URL');
  const callback = new URL(client.redirect_uris[0]);
  if (callback.protocol !== 'https:' || callback.hash || callback.search || callback.username || callback.password || callback.href.includes('*')) throw new Error('回调必须为无通配符的 HTTPS 地址');
  const clientSecret = randomBytes(32).toString('hex');
  registered.push({ ...client, client_secret: clientSecret });
  await fs.writeFile(path.join(root, `${client.client_id}.env`), `IDENTITY_ENABLED=false\nIDENTITY_ISSUER=https://identity.meta-gravity.com\nIDENTITY_CLIENT_ID=${client.client_id}\nIDENTITY_CLIENT_SECRET=${clientSecret}\nIDENTITY_REDIRECT_URI=${callback.href}\nIDENTITY_COOKIE_KEY=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
}
await fs.writeFile(path.join(root, 'identity.json'), JSON.stringify({ jwks: { keys: [key] }, cookieKeys: [randomBytes(32).toString('hex')], clients: registered }, null, 2), { flag: 'wx', mode: 0o600 });
await fs.writeFile(path.join(root, 'auth-config.key'), randomBytes(32), { flag: 'wx', mode: 0o600 });
console.log('密钥已保存到指定私密目录，应用开关默认关闭。请限制文件访问并备份，不要提交到 Git。');
