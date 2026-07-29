import { describe, it, expect } from '@jest/globals';
import { CacheKeys } from '../cacheKeys.js';

describe('CacheKeys format stability', () => {
  it('poolStats', () => {
    expect(CacheKeys.poolStats()).toBe('pool:stats');
  });

  it('borrowerLoans', () => {
    expect(CacheKeys.borrowerLoans('GBORROWER123')).toBe('borrower:loans:GBORROWER123');
  });

  it('scoreBreakdown', () => {
    expect(CacheKeys.scoreBreakdown('GPUBKEY456')).toBe('score:breakdown:GPUBKEY456');
  });

  it('pendingLoanTx', () => {
    expect(CacheKeys.pendingLoanTx('GBORROWER789', 5000)).toBe('pending_loan_tx:GBORROWER789:5000');
  });

  it('pendingRepayTx', () => {
    expect(CacheKeys.pendingRepayTx('GBORROWER789', 42, 2500)).toBe(
      'pending_repay_tx:GBORROWER789:42:2500',
    );
  });

  it('pendingDepositTx', () => {
    expect(CacheKeys.pendingDepositTx('GDEPOSITOR111', 'USDC', 10000)).toBe(
      'pending_deposit_tx:GDEPOSITOR111:USDC:10000',
    );
  });

  it('pendingWithdrawTx', () => {
    expect(CacheKeys.pendingWithdrawTx('GDEPOSITOR111', 'USDC', 5000)).toBe(
      'pending_withdraw_tx:GDEPOSITOR111:USDC:5000',
    );
  });
});
