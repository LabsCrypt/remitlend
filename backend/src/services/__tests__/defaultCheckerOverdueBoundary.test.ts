import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../defaultChecker.ts', import.meta.url), 'utf8');

describe('DefaultChecker overdue ledger boundary', () => {
  it('only selects loans after the current ledger passes the due ledger', () => {
    expect(source).toContain('WHERE due_ledger < $2');
    expect(source).not.toContain('WHERE due_ledger <= $2');
  });
});