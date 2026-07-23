import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../rateLimiter.ts', import.meta.url), 'utf8');

describe('loginRateLimiter config', () => {
  it('uses the intended one-minute window', () => {
    const loginBlock = source.slice(
      source.indexOf('export const loginRateLimiter'),
      source.indexOf('export const ipLoginRateLimiter'),
    );

    expect(loginBlock).toContain('windowMs: 60 * 1000');
    expect(loginBlock).not.toContain('windowMs: 6 * 1000');
  });
});