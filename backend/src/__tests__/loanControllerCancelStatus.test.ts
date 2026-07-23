import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../controllers/loanController.ts', import.meta.url), 'utf8');

describe('buildCancelLoanTx cancellable statuses', () => {
  it('allows pending and open loans but not defaulted loans', () => {
    expect(source).toContain("['PENDING', 'OPEN'].includes(loan.status as string)");
    expect(source).not.toContain("['PENDING', 'DEFAULTED'].includes(loan.status as string)");
  });
});