import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scryptCallback) as (password: string, salt: string, length: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 128) throw new Error('密码长度必须为10至128个字符。');
  const salt = randomBytes(16).toString('hex');
  const digest = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${digest.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
