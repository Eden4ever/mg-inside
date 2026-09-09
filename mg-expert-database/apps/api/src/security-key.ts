import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransport } from '@simplewebauthn/server';

export function webAuthnSite() {
  const configured = process.env.WEBAUTHN_ORIGIN || process.env.WEB_APP_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  try {
    const url = new URL(configured);
    if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error();
    return { origin: url.origin, rpID: url.hostname };
  } catch { throw new ServiceUnavailableException('安全密钥站点配置无效，请配置 HTTPS 站点地址。'); }
}

@Injectable()
export class SecurityKeyService {
  async registrationOptions(tx: Prisma.TransactionClient, user: User) {
    const keys = await tx.securityKey.findMany({ where: { userId: user.id } });
    return generateRegistrationOptions({ rpName: '营商环境指标知识库', rpID: webAuthnSite().rpID,
      userID: new Uint8Array(Buffer.from(user.id)), userName: user.username || user.displayName,
      attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      excludeCredentials: keys.map(key => ({ id: key.id, transports: key.transports as AuthenticatorTransport[] })) });
  }
  async register(tx: Prisma.TransactionClient, user: User, challenge: string, name: string, response: unknown) {
    try {
      const site = webAuthnSite();
      const result = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge: challenge, expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: false });
      if (!result.verified || !result.registrationInfo) return false;
      const { credential, credentialBackedUp } = result.registrationInfo;
      if (await tx.securityKey.findUnique({ where: { id: credential.id } })) return false;
      await tx.securityKey.create({ data: { id: credential.id, userId: user.id, name, publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter), transports: credential.transports || [], backedUp: credentialBackedUp } });
      return true;
    } catch { return false; }
  }
  async prepare(tx: Prisma.TransactionClient, user: User, scope: string, requireUV = false) {
    const keys = await tx.securityKey.findMany({ where: { userId: user.id } });
    const options = await generateAuthenticationOptions({ rpID: webAuthnSite().rpID, userVerification: requireUV ? 'required' : 'preferred',
      allowCredentials: keys.map(key => ({ id: key.id, transports: key.transports as AuthenticatorTransport[] })) });
    await tx.authChallenge.updateMany({ where: { userId: user.id, purpose: 'key_verify', usedAt: null, payload: { path: ['scope'], equals: scope } }, data: { usedAt: new Date() } });
    await tx.authChallenge.create({ data: { tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'), browserHash: '', userId: user.id,
      purpose: 'key_verify', firstMethod: 'key', securityVersion: user.securityVersion, payload: { challenge: options.challenge, scope, requireUV }, expiresAt: new Date(Date.now() + 5 * 60_000) } });
    return options;
  }
  // 用户行锁由调用者持有，签名计数更新与凭证消费同一事务提交。
  async consume(tx: Prisma.TransactionClient, user: User, scope: string, response: unknown) {
    const challenge = await tx.authChallenge.findFirst({ where: { userId: user.id, purpose: 'key_verify', securityVersion: user.securityVersion, usedAt: null, expiresAt: { gt: new Date() }, payload: { path: ['scope'], equals: scope } }, orderBy: { createdAt: 'desc' } });
    if (!challenge) return false;
    await tx.authChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    try {
      const input = response as AuthenticationResponseJSON;
      if (typeof input?.id !== 'string') return false;
      const key = await tx.securityKey.findUnique({ where: { id: input.id } });
      if (!key || key.userId !== user.id) return false;
      if (input.response.userHandle && Buffer.from(input.response.userHandle, 'base64url').toString('utf8') !== user.id) return false;
      const payload = challenge.payload as { challenge: string; requireUV: boolean };
      const site = webAuthnSite();
      const result = await verifyAuthenticationResponse({ response: input, expectedChallenge: payload.challenge, expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: payload.requireUV,
        credential: { id: key.id, publicKey: new Uint8Array(key.publicKey), counter: Number(key.counter), transports: key.transports as AuthenticatorTransport[] } });
      if (!result.verified) return false;
      await tx.securityKey.update({ where: { id: key.id }, data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date(), backedUp: result.authenticationInfo.credentialBackedUp } });
      return true;
    } catch { return false; }
  }
}
