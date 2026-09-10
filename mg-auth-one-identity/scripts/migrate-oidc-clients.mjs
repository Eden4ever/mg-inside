import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { encryptSecret, decryptSecret } from '../dist/security-secrets.js';
import { callbackUris } from '../dist/oidc-clients.mjs';
const db = new PrismaClient();
try {
  const config = JSON.parse(await fs.readFile(process.env.IDENTITY_SECRETS_FILE || './secrets/identity.json', 'utf8'));
  const clients = config.clients || [];
  if (!Array.isArray(clients)) throw new Error('客户端配置无效');
  let inserted = 0;
  await db.$transaction(async tx => {
    for (const client of clients) {
      const id = client.client_id;
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(id) || typeof client.client_secret !== 'string' || client.client_secret.length < 32) throw new Error('客户端配置无效');
      const uris = callbackUris(client.redirect_uris);
      const current = await tx.oidcClient.findUnique({ where: { clientId: id } });
      if (current) {
        if (decryptSecret(current.encryptedSecret, `oidc:${id}`) !== client.client_secret || JSON.stringify(current.redirectUris) !== JSON.stringify(uris)) throw new Error('数据库与文件不一致，拒绝覆盖');
        continue;
      }
      await tx.oidcClient.create({ data: { clientId: id, redirectUris: uris, encryptedSecret: encryptSecret(client.client_secret, `oidc:${id}`), registrationId: `migration:${id}` } });
      inserted++;
    }
  });
  console.log(JSON.stringify({ migrated: true, inserted, total: clients.length }));
} catch { console.error('客户端迁移未完成，未覆盖现有配置；请核对数据库和密钥。'); process.exitCode = 1; }
finally { await db.$disconnect(); }
