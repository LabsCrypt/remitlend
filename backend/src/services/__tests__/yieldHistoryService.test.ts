import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { nativeToScVal } from '@stellar/stellar-sdk';

const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const { buildDepositorYieldHistory, computeApy, normalizeYieldHistoryDays } = await import(
  '../yieldHistoryService.js'
);

/** Encode [assetAmount, shares] as a base64 Soroban ScVec XDR string. */
function makeXdrValue(assetAmount: bigint, shares: bigint): string {
  return nativeToScVal([assetAmount, shares]).toXDR('base64');
}

describe('yieldHistoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LENDING_POOL_CONTRACT_ID = 'CPoolContract';
  });

  it('normalizes days to allowed ranges', () => {
    expect(normalizeYieldHistoryDays(7)).toBe(7);
    expect(normalizeYieldHistoryDays(90)).toBe(90);
    expect(normalizeYieldHistoryDays(undefined)).toBe(30);
    expect(normalizeYieldHistoryDays(14)).toBe(30);
  });

  it('computes annualized APY from period return', () => {
    const apy = computeApy(10, 100, 30);
    expect(apy).toBeCloseTo(121.67, 1);
  });

  it('returns empty history when depositor has no events', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const history = await buildDepositorYieldHistory('GDepositor', 'GToken', 30);
    expect(history).toEqual([]);
  });

  it('reduces cost-basis proportionally on Withdraw (value=null)', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    // Pool: deposit 1000 then withdraw 500 (no XDR value, so shares == assetAmount)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: twoDaysAgo, value: null },
        { event_type: 'Withdraw', amount: '500', ledger_closed_at: yesterday, value: null },
      ],
    });
    // Depositor mirrors the pool events
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: twoDaysAgo, value: null },
        { event_type: 'Withdraw', amount: '500', ledger_closed_at: yesterday, value: null },
      ],
    });

    const history = await buildDepositorYieldHistory('GDepositor', 'GToken', 7);
    expect(history.length).toBeGreaterThan(0);

    // After deposit 1000 then withdraw 500 (shareRatio = 0.5), costBasis = 500
    const latest = history[history.length - 1]!;
    expect(latest.depositedValue).toBeCloseTo(500, 5);
    // netYield must not be negative
    expect(latest.netYield).toBeGreaterThanOrEqual(0);
  });

  it('decodes shares from base64 XDR ScVec and converts BigInt to Number', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    // Deposit: 1000 asset, 800_000 shares (encoded in XDR as BigInts)
    const depositXdr = makeXdrValue(1000n, 800_000n);
    // Withdraw: 400 asset, 320_000 shares (shareRatio = 320000/800000 = 0.4 → costBasis drops to 600)
    const withdrawXdr = makeXdrValue(400n, 320_000n);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: twoDaysAgo,
          value: depositXdr,
        },
        {
          event_type: 'Withdraw',
          amount: '400',
          ledger_closed_at: yesterday,
          value: withdrawXdr,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: twoDaysAgo,
          value: depositXdr,
        },
        {
          event_type: 'Withdraw',
          amount: '400',
          ledger_closed_at: yesterday,
          value: withdrawXdr,
        },
      ],
    });

    const history = await buildDepositorYieldHistory('GDepositor', 'GToken', 7);
    expect(history.length).toBeGreaterThan(0);

    // shareRatio = 320000 / 800000 = 0.4, costBasis after = 1000 * (1 - 0.4) = 600
    const afterWithdraw = history[history.length - 1]!;
    expect(afterWithdraw.depositedValue).toBeCloseTo(600, 4);
    expect(afterWithdraw.netYield).toBeGreaterThanOrEqual(0);
  });

  it('treats EmergencyWithdraw the same as Withdraw for cost-basis reduction', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    // EmergencyWithdraw with XDR value encoding 800 shares out of 1000 (shareRatio = 0.8)
    const depositXdr = makeXdrValue(1000n, 1000n);
    const emergencyWithdrawXdr = makeXdrValue(800n, 800n);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: twoDaysAgo,
          value: depositXdr,
        },
        {
          event_type: 'EmergencyWithdraw',
          amount: '800',
          ledger_closed_at: yesterday,
          value: emergencyWithdrawXdr,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: twoDaysAgo,
          value: depositXdr,
        },
        {
          event_type: 'EmergencyWithdraw',
          amount: '800',
          ledger_closed_at: yesterday,
          value: emergencyWithdrawXdr,
        },
      ],
    });

    const history = await buildDepositorYieldHistory('GDepositor', 'GToken', 7);
    expect(history.length).toBeGreaterThan(0);

    // shareRatio = 800/1000 = 0.8, costBasis = 1000 * 0.2 = 200, shares = 200
    const latest = history[history.length - 1]!;
    expect(latest.depositedValue).toBeCloseTo(200, 4);
    expect(latest.netYield).toBeGreaterThanOrEqual(0);
  });

  it('aggregates deposit and yield into increasing net yield', async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: yesterday,
          value: null,
        },
        {
          event_type: 'YieldDistributed',
          amount: '100',
          ledger_closed_at: now,
          value: null,
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: yesterday,
          value: null,
        },
      ],
    });

    const history = await buildDepositorYieldHistory('GDepositor', 'GToken', 7, 1_100_000);

    expect(history.length).toBeGreaterThan(0);
    const latest = history[history.length - 1]!;
    expect(latest.depositedValue).toBe(1000);
    expect(latest.currentValue).toBeGreaterThanOrEqual(1000);
    expect(latest.netYield).toBeGreaterThanOrEqual(0);
  });
});
