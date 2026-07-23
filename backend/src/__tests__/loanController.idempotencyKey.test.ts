import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../controllers/loanController.ts', import.meta.url), 'utf8');

describe('repayLoan idempotency key', () => {
  it('includes borrower, loan id, and repayment amount', () => {
    expect(source).toContain(
      'const cacheKey = `pending_repay_tx:${borrowerPublicKey}:${loanIdNum}:${amount}`;',
    );
    expect(source).not.toContain(
      'const cacheKey = `pending_repay_tx:${borrowerPublicKey}:${loanIdNum}:${loanIdNum}`;',
    );
  });
});