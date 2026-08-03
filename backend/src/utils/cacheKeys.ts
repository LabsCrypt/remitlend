import { cacheService } from '../services/cacheService.js';

/**
 * Canonical cache key generators.
 * Each read key that populates a cache entry is paired here with the
 * write operations that must bust it so the mapping is testable in isolation.
 *
 * IMPORTANT: The exact string format returned by each function is part of the
 * runtime contract between this module and the data in Redis.  If a format
 * is changed, existing cached entries under the old format become orphaned
 * and will never be evicted unless a deployment runbook step explicitly
 * flushes the affected keys.  Always add a cache flush step to the deploy
 * runbook when modifying a key format.
 */
export const CacheKeys = {
  // Pool stats aggregate (getPoolStats)
  poolStats: () => 'pool:stats',

  // Per-borrower loans aggregate (getBorrowerLoans)
  borrowerLoans: (borrower: string) => `borrower:loans:${borrower}`,

  // Credit-score breakdown (getScoreBreakdown)
  scoreBreakdown: (publicKey: string) => `score:breakdown:${publicKey}`,

  // Idempotency / unsigned-tx keys – loan
  pendingLoanTx: (borrower: string, amount: number) => `pending_loan_tx:${borrower}:${amount}`,

  pendingRepayTx: (borrower: string, loanId: number, amount: number) =>
    `pending_repay_tx:${borrower}:${loanId}:${amount}`,

  // Idempotency / unsigned-tx keys – pool
  pendingDepositTx: (depositor: string, token: string, amount: number) =>
    `pending_deposit_tx:${depositor}:${token}:${amount}`,

  pendingWithdrawTx: (depositor: string, token: string, amount: number) =>
    `pending_withdraw_tx:${depositor}:${token}:${amount}`,
} as const;

/**
 * Invalidate all cache keys that become stale after a repayment.
 * Call this after the DB transaction commits inside repayLoan.
 */
export async function invalidateOnRepay(borrower: string, _loanId: number): Promise<void> {
  await Promise.all([
    cacheService.delete(CacheKeys.poolStats()),
    cacheService.delete(CacheKeys.borrowerLoans(borrower)),
    cacheService.delete(CacheKeys.scoreBreakdown(borrower)),
  ]);
}

/**
 * Invalidate all cache keys that become stale after a new loan request.
 * Call this after the DB transaction commits inside requestLoan.
 */
export async function invalidateOnLoanRequest(borrower: string): Promise<void> {
  await Promise.all([
    cacheService.delete(CacheKeys.poolStats()),
    cacheService.delete(CacheKeys.borrowerLoans(borrower)),
  ]);
}

/**
 * Invalidate all cache keys that become stale after a pool deposit.
 * Call this after the DB transaction commits inside depositToPool.
 */
export async function invalidateOnDeposit(_depositor: string): Promise<void> {
  await cacheService.delete(CacheKeys.poolStats());
}

/**
 * Invalidate all cache keys that become stale after a pool withdrawal.
 * Call this after the DB transaction commits inside withdrawFromPool.
 */
export async function invalidateOnWithdraw(_depositor: string): Promise<void> {
  await cacheService.delete(CacheKeys.poolStats());
}
