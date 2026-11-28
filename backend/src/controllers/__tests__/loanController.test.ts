import { jest, describe, it, expect, beforeEach } from '@jest/globals';

/**
 * Regression test for #2233: a failed settlement load must be propagated to
 * the caller instead of being logged and swallowed.
 *
 * `loadLoanSettlements` used to `return` the partial maps in its catch block,
 * so an unreadable `contract_events` table produced loans whose `totalOwed`
 * silently omitted every repayment and late fee. The service layer must fail
 * the request instead of serving inflated balances.
 */

type QueryResult = { rows: unknown[] };

type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>;

const mockQuery = jest.fn<QueryFn>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const { loadLoanSettlements } = await import('../loanController.js');

beforeEach(() => {
  mockQuery.mockReset();
});

describe('loadLoanSettlements settlement-load failures (#2233)', () => {
  it('propagates a query failure instead of returning empty maps', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(loadLoanSettlements([1, 2])).rejects.toThrow('DB connection lost');
  });

  it('parses settlements and late fees when the query succeeds', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { loan_id: 1, event_type: 'LoanRepaid', ledger: 120, amount: '5000000000' },
        { loan_id: 1, event_type: 'LateFeeCharged', ledger: 130, amount: '1000000' },
        { loan_id: 2, event_type: 'LoanRepaid', ledger: 140, amount: '2500000000' },
      ],
    });

    const { settlements, lateFees } = await loadLoanSettlements([1, 2]);

    expect(settlements.get(1)).toEqual([{ ledger: 120, amountStroops: 5000000000n }]);
    expect(settlements.get(2)).toEqual([{ ledger: 140, amountStroops: 2500000000n }]);
    expect(lateFees.get(1)).toBe(1000000n);
    expect(lateFees.get(2)).toBeUndefined();
  });

  it('does not query the database for an empty loan list', async () => {
    const { settlements, lateFees } = await loadLoanSettlements([]);

    expect(settlements.size).toBe(0);
    expect(lateFees.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
