import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scoreDecayService.ts', import.meta.url), 'utf8');

describe('score decay direction', () => {
  it('subtracts decay points from inactive borrower scores', () => {
    expect(source).toContain('Math.max(MIN_SCORE, borrower.score - decay)');
    expect(source).not.toContain('Math.max(MIN_SCORE, borrower.score + decay)');
  });
});