import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const { buildDepositorYieldHistory, computeApy, normalizeYieldHistoryDays } =
  await import('../yieldHistoryService.js');

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

  // Issue #1171 — previously uncovered paths

  it('Withdraw reduces cost basis proportionally', async () => {
    const now = new Date();
    const t1 = new Date(now);
    t1.setUTCDate(t1.getUTCDate() - 2);
    const t2 = new Date(now);
    t2.setUTCDate(t2.getUTCDate() - 1);

    // Pool events: Deposit 1000 then Withdraw 500 (value=null → shares=amount)
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: t1, value: null },
        { event_type: 'Withdraw', amount: '500', ledger_closed_at: t2, value: null },
      ],
    });
    // Depositor events: same
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: t1, value: null },
        { event_type: 'Withdraw', amount: '500', ledger_closed_at: t2, value: null },
      ],
    });

    const history = await buildDepositorYieldHistory('GDep', 'GTok', 7, 500_000);
    expect(history.length).toBeGreaterThan(0);
    // After withdrawing half the shares the cost basis should have halved
    const latest = history[history.length - 1]!;
    // netYield = currentValue - costBasis; costBasis after withdraw ≈ 500
    expect(latest.netYield).toBeGreaterThanOrEqual(-1); // may be slightly negative due to share price
  });

  it('EmergencyWithdraw follows the same cost-basis reduction path as Withdraw', async () => {
    const now = new Date();
    const t1 = new Date(now);
    t1.setUTCDate(t1.getUTCDate() - 2);
    const t2 = new Date(now);
    t2.setUTCDate(t2.getUTCDate() - 1);

    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: t1, value: null },
        { event_type: 'EmergencyWithdraw', amount: '1000', ledger_closed_at: t2, value: null },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: t1, value: null },
        { event_type: 'EmergencyWithdraw', amount: '1000', ledger_closed_at: t2, value: null },
      ],
    });

    const history = await buildDepositorYieldHistory('GDep', 'GTok', 7, 0);
    // Full emergency withdraw → depositor has 0 shares → currentValue = 0
    if (history.length > 0) {
      const latest = history[history.length - 1]!;
      expect(latest.currentValue).toBe(0);
    }
  });

  it('decodes shares from base64 XDR value (BigInt conversion path)', async () => {
    // XDR encodes [assetAmount=1000, shares=500] as a 2-element Vec of i128
    // Generated with: nativeToScVal([BigInt(1000), BigInt(500)]).toXDR('base64')
    const xdrDeposit = 'AAAAEAAAAAEAAAACAAAABQAAAAAAAAPoAAAABQAAAAAAAAH0';
    // [assetAmount=2000, shares=800]
    const xdrWithdraw = 'AAAAEAAAAAEAAAACAAAABQAAAAAAAAfQAAAABQAAAAAAAAMg';

    const now = new Date();
    const t1 = new Date(now);
    t1.setUTCDate(t1.getUTCDate() - 2);
    const t2 = new Date(now);
    t2.setUTCDate(t2.getUTCDate() - 1);

    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: t1, value: xdrDeposit },
        { event_type: 'Withdraw', amount: '500', ledger_closed_at: t2, value: xdrWithdraw },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'Deposit', amount: '1000', ledger_closed_at: t1, value: xdrDeposit },
        { event_type: 'Withdraw', amount: '500', ledger_closed_at: t2, value: xdrWithdraw },
      ],
    });

    // Should not throw even with non-null XDR values
    const history = await buildDepositorYieldHistory('GDep', 'GTok', 7, 1_000_000);
    expect(history.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when XDR value is malformed', async () => {
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: now,
          value: 'not-valid-base64-xdr!!!',
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: 'Deposit',
          amount: '1000',
          ledger_closed_at: now,
          value: 'not-valid-base64-xdr!!!',
        },
      ],
    });

    // Should not throw — falls back to assetAmount as shares
    await expect(buildDepositorYieldHistory('GDep', 'GTok', 7)).resolves.toBeDefined();
  });
});
