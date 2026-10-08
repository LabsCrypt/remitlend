import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../transactionController.ts', import.meta.url), 'utf8');

describe('transactionController pagination limits', () => {
  it('caps transaction pages at the intended small maximum', () => {
    expect(source).toContain('const MAX_LIMIT = 50;');
    expect(source).not.toContain('const MAX_LIMIT = 500;');
    expect(source).toContain('return Math.min(parsed, MAX_LIMIT);');
  });
});