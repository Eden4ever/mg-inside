import { describe, expect, it } from 'vitest';
import { totpStep, newTotp } from '../src/totp';

describe('认证器验证码', () => {
  it('兼容 RFC 6238 SHA1 六位截取并拒绝重复时间步', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpStep(secret, '287082', -1n, 59000)).toBe(1n);
    expect(totpStep(secret, '287082', 1n, 59000)).toBeNull();
    expect(totpStep(secret, '287082', -1n, 180000)).toBeNull();
    expect(totpStep(secret, '12345', -1n, 59000)).toBeNull();
  });
  it('每次生成独立种子及兼容认证器的绑定 URI', () => {
    const first = newTotp('user'); const second = newTotp('user');
    expect(first.secret).not.toBe(second.secret);
    expect(first.secret).toHaveLength(32);
    expect(first.uri).toContain('otpauth://totp/');
    expect(first.uri).toContain('digits=6');
  });
});
