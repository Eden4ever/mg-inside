import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';

function key(create: boolean): Buffer {
  const path = process.env.AUTH_CONFIG_KEY_FILE || (process.env.NODE_ENV === 'production'
    ? '/app/secrets/auth-config.key' : resolve(process.cwd(), '.runtime/auth-config.key'));
  try {
    let value: Buffer;
    try { value = readFileSync(path); }
    catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      value = readFileSync(path);
    }
    if (value.length !== 32) throw new Error();
    return value;
  } catch { throw new ServiceUnavailableException('认证配置密钥不可用，请检查服务端密钥文件。'); }
}

export function encryptSecret(value: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(true), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(value => value.toString('base64')).join('.');
}

export function secretDigest(value: string, purpose: string): string {
  return createHmac('sha256', key(true)).update(purpose).update('\0').update(value).digest('hex');
}

export function decryptSecret(value: string, purpose: string): string {
  try {
    const parts = value.split('.').map(value => Buffer.from(value, 'base64'));
    if (parts.length !== 3 || parts[0]!.length !== 12 || parts[1]!.length !== 16) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key(false), parts[0]!);
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(parts[1]!);
    return Buffer.concat([cipher.update(parts[2]!), cipher.final()]).toString('utf8');
  } catch { throw new ServiceUnavailableException('认证配置无法解密，请恢复密钥文件或重新配置。'); }
}
