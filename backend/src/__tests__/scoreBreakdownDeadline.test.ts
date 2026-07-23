import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../controllers/scoreController.ts', import.meta.url), 'utf8');

describe('score breakdown repayment timing query', () => {
  it('classifies repayments against approved ledger plus term ledgers', () => {
    expect(source).toContain(
      'CASE WHEN r.repaid_ledger <= a.approved_ledger + a.term_ledgers',
    );
    expect(source).not.toContain(
      'CASE WHEN r.repaid_ledger <= a.approved_ledger - a.term_ledgers',
    );
  });
});