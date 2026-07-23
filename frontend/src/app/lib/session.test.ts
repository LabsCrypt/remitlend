import { describe, expect, it, jest } from '@jest/globals';
import { isJwtExpired } from './session';

function base64UrlEncode(value: unknown): string {
  return window
    .btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function tokenWithPayload(payload: Record<string, unknown>): string {
  return `${base64UrlEncode({ alg: 'none', typ: 'JWT' })}.${base64UrlEncode(payload)}.`;
}

describe('isJwtExpired', () => {
  it('returns false for a token expiring in the future', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    expect(isJwtExpired(tokenWithPayload({ exp: 1_700_000_060 }))).toBe(false);
  });

  it('returns true for a token expiring in the past', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    expect(isJwtExpired(tokenWithPayload({ exp: 1_699_999_940 }))).toBe(true);
  });

  it('treats a token expiring exactly now as expired', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    expect(isJwtExpired(tokenWithPayload({ exp: 1_700_000_000 }))).toBe(true);
  });

  it('returns false for malformed tokens or missing numeric exp', () => {
    expect(isJwtExpired('not-a-jwt')).toBe(false);
    expect(isJwtExpired(tokenWithPayload({ exp: '1700000000' }))).toBe(false);
    expect(isJwtExpired(tokenWithPayload({ sub: 'GUSER' }))).toBe(false);
  });
});