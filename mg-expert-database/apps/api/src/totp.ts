import { Secret, TOTP } from 'otpauth';
import type { Prisma } from '@prisma/client';
import { decryptSecret } from './security-secrets';

export function newTotp(label: string) {
  const totp = new TOTP({ issuer: '营商环境指标知识库', label, algorithm: 'SHA1', digits: 6, period: 30, secret: new Secret({ size: 20 }) });
  return { secret: totp.secret.base32, uri: totp.toString() };
}

export function totpStep(secret: string, token: unknown, lastUsedStep = -1n, timestamp = Date.now()): bigint | null {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) return null;
  const delta = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).validate({ token, timestamp, window: 1 });
  if (delta === null) return null;
  const step = BigInt(Math.floor(timestamp / 30_000) + delta);
  return step > lastUsedStep ? step : null;
}

// 调用者须持有用户行锁，确保多个挑战不能同时消费同一时间步。
export async function consumeTotp(tx: Prisma.TransactionClient, userId: string, code: unknown): Promise<boolean> {
  const row = await tx.totpCredential.findUnique({ where: { userId } });
  if (!row) return false;
  const step = totpStep(decryptSecret(row.encryptedSecret, `totp:${userId}`), code, row.lastUsedStep);
  if (step === null) return false;
  await tx.totpCredential.update({ where: { userId }, data: { lastUsedStep: step } });
  return true;
}
