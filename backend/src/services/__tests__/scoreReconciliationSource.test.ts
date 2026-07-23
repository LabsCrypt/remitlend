import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scoreReconciliationService.ts', import.meta.url), 'utf8');

describe('score reconciliation divergence check', () => {
  it('marks scores divergent only when DB score is missing or differs from contract score', () => {
    expect(source).toContain('dbScore === null || dbScore !== contractScore');
    expect(source).not.toContain('dbScore === null || dbScore === contractScore');
  });
});