import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const base = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(base, 'private/spike');
await fs.mkdir(directory, { recursive: true });
const password = randomBytes(32).toString('base64url');
const clients = ['token-one', 'expert-database'].map((clientId, index) => ({
  clientId, protocol: 'openid-connect', publicClient: true, standardFlowEnabled: true,
  directAccessGrantsEnabled: false, implicitFlowEnabled: false,
  redirectUris: [`http://127.0.0.1:${18881 + index}/callback`],
  attributes: { 'pkce.code.challenge.method': 'S256' },
}));
const realm = { realm: 'mg-identity-spike', enabled: true, sslRequired: 'none', registrationAllowed: false,
  clients, users: [{ username: 'spike-user', enabled: true, email: 'spike@example.invalid', emailVerified: true,
    firstName: '测试', lastName: '员工', credentials: [{ type: 'password', value: password, temporary: false }] }] };
await fs.writeFile(path.join(directory, 'realm.json'), JSON.stringify(realm), { mode: 0o600 });
await fs.writeFile(path.join(directory, 'test-user.json'), JSON.stringify({ username: 'spike-user', password }), { mode: 0o600 });
// 独立容器，仅监听本机；不挂载业务数据库、不使用真实员工账号。
execFileSync('docker', ['run', '--detach', '--rm', '--name', 'mg-identity-spike',
  '-p', '127.0.0.1:18880:8080', '--mount', `type=bind,source=${path.join(directory, 'realm.json')},target=/opt/keycloak/data/import/realm.json,readonly`,
  'quay.io/keycloak/keycloak:26.7.3', 'start-dev', '--import-realm'], { stdio: 'inherit' });
