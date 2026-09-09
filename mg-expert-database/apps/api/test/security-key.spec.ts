import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { SecurityKeyService, webAuthnSite } from '../src/security-key';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest();
describe('WebAuthn 真实签名验证', () => {
  beforeEach(() => vi.stubEnv('WEBAUTHN_ORIGIN', 'https://example.com'));
  afterEach(() => vi.unstubAllEnvs());
  function fixture() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x!, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y!, 'base64url')]);
    const user: any = { id: 'user-1', securityVersion: 1 };
    const challenge: any = { id: 'challenge', payload: { challenge: 'test-challenge', requireUV: true } };
    const tx: any = { authChallenge: { findFirst: vi.fn(async () => challenge.usedAt ? null : challenge), update: vi.fn(async () => { challenge.usedAt = new Date(); }) },
      securityKey: { findUnique: vi.fn(async () => ({ id: 'a2V5LWlk', userId: user.id, publicKey: cose, counter: 0n, transports: ['usb'] })), update: vi.fn() } };
    const response = (origin = 'https://example.com', flags = 5, expectedChallenge = 'test-challenge') => {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: expectedChallenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([digest('example.com'), Buffer.from([flags, 0, 0, 0, 1])]);
      return { id: 'a2V5LWlk', rawId: 'a2V5LWlk', type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: sign('sha256', Buffer.concat([authData, digest(clientDataJSON)]), privateKey).toString('base64url'), userHandle: Buffer.from(user.id).toString('base64url') } };
    };
    return { user, tx, response, cose, service: new SecurityKeyService() };
  }
  function registration(origin = 'https://example.com', challenge = 'registration-test', rpID = 'example.com') {
    const { user, cose, service } = fixture();
    const credentialID = Buffer.from('key-id');
    const authData = Buffer.concat([digest(rpID), Buffer.from([65, 0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([0, credentialID.length]), credentialID, cose]);
    // WebAuthn none attestation：CBOR map {fmt:'none', attStmt:{}, authData:bytes}。
    const attestation = Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746158', 'hex'), Buffer.from([authData.length]), authData]);
    const input = { id: credentialID.toString('base64url'), rawId: credentialID.toString('base64url'), type: 'public-key', clientExtensionResults: {}, response: {
      attestationObject: attestation.toString('base64url'), clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false })).toString('base64url'), transports: ['usb'],
    } };
    const tx: any = { securityKey: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() } };
    return { service, user, tx, input, cose };
  }
  it('标准注册数据存储公钥，重复凭证不会覆盖原绑定', async () => {
    const { service, user, tx, input, cose } = registration();
    expect(await service.register(tx, user, 'registration-test', '测试密钥', input)).toBe(true);
    expect(tx.securityKey.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: input.id, userId: user.id, publicKey: cose, counter: 0n }) });
    tx.securityKey.findUnique.mockResolvedValue({ id: input.id, userId: 'other-user' });
    tx.securityKey.create.mockClear();
    expect(await service.register(tx, user, 'registration-test', '重复', input)).toBe(false);
    expect(tx.securityKey.create).not.toHaveBeenCalled();
  });
  it.each(['origin', 'challenge', 'rpID'])('注册拒绝 %s 不匹配且不落库', async failure => {
    const { service, user, tx, input } = registration(failure === 'origin' ? 'https://attacker.example' : undefined, failure === 'challenge' ? 'wrong' : undefined, failure === 'rpID' ? 'attacker.example' : undefined);
    expect(await service.register(tx, user, 'registration-test', '测试密钥', input)).toBe(false);
    expect(tx.securityKey.create).not.toHaveBeenCalled();
  });
  it('接受正确签名并更新计数，不能重放已消费挑战', async () => {
    const { service, tx, user, response } = fixture();
    expect(await service.consume(tx, user, 'mfa:test', response())).toBe(true);
    expect(tx.securityKey.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ counter: 1n }) }));
    expect(await service.consume(tx, user, 'mfa:test', response())).toBe(false);
  });
  it.each(['origin', 'challenge', 'uv', 'signature'])('拒绝 %s 不匹配，失败后同样消费挑战', async failure => {
    const { service, tx, user, response } = fixture();
    const input = response(failure === 'origin' ? 'https://attacker.example' : undefined, failure === 'uv' ? 1 : 5, failure === 'challenge' ? 'other' : undefined);
    if (failure === 'signature') input.response.signature = Buffer.alloc(64).toString('base64url');
    expect(await service.consume(tx, user, 'mfa:test', input)).toBe(false);
    expect(tx.authChallenge.update).toHaveBeenCalled();
    expect(tx.securityKey.update).not.toHaveBeenCalled();
  });
  it('生产配置拒绝 HTTP 来源', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('WEBAUTHN_ORIGIN', 'http://example.com');
    expect(() => webAuthnSite()).toThrow();
  });
});
