import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from '@/api/client';

describe('resolveApiBaseUrl', () => {
  it('uses the root API path for local development', () => {
    expect(resolveApiBaseUrl(undefined, '/')).toBe('/api');
  });

  it('keeps API requests inside a production subpath', () => {
    expect(resolveApiBaseUrl(undefined, '/knowledge-base-inside/')).toBe('/knowledge-base-inside/api');
  });

  it('honors an explicit API base and removes its trailing slash', () => {
    expect(resolveApiBaseUrl('https://api.example.test/v1/', '/knowledge-base-inside/')).toBe('https://api.example.test/v1');
  });
});
