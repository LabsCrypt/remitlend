import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../webhookService.ts', import.meta.url), 'utf8');

describe('webhook retry delay index', () => {
  it('clamps retry attempts to the matching delay step instead of always using the last delay', () => {
    expect(source).toContain('Math.min(Math.max(attemptNumber - 1, 0), RETRY_DELAYS_MS.length - 1)');
    expect(source).not.toContain('Math.max(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)');
  });
});