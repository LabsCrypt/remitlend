import { jest } from '@jest/globals';
import { createRequire } from 'module';
import { INDEX_SCALE } from '../lib/fixedPoint.js';

const require = createRequire(import.meta.url);
const vectors = require('../../../contracts/testdata/accrual_vectors.json');

const mockQuery = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const { calculateOwedForLoan, isLoanOwedAboveThreshold } =
  await import('../services/defaultChecker.js');
const { persistIndexSnapshot } = await import('../services/eventIndexer.js');

describe('Backend Accrual Integration & Parity (Issue #1382)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('persists index snapshot into interest_index table', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await persistIndexSnapshot(101, 500, '1000000792281625', '1000000000000000000');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = (mockQuery as jest.Mock).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO interest_index');
    expect(params).toEqual(['101', '500', '1000000792281625', '1000000000000000000']);
  });

  it('calculates owed amount from interest_index matching golden vectors', async () => {
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i]!;
      const loanId = i + 1;
      const principal = BigInt(v.principal);

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            index_value: v.expected_index,
            origin_index: INDEX_SCALE.toString(),
          },
        ],
      });

      const owed = await calculateOwedForLoan(loanId, principal);
      expect(owed.toString()).toBe(v.expected_owed);
    }
  });

  it('returns base principal if no interest_index snapshot exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const principal = 10_0000000n;
    const owed = await calculateOwedForLoan(999, principal);
    expect(owed).toBe(principal);
  });

  it('evaluates threshold check using interest_index owed calculation', async () => {
    // 1000 XLM with interest accrued to 1000.7922816 XLM (10007922816 stroops)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          index_value: '1000079228162510000',
          origin_index: INDEX_SCALE.toString(),
        },
      ],
    });

    const principal = 1000_0000000n;
    const isAbove1000 = await isLoanOwedAboveThreshold(1, principal, 1000_0000000n);
    expect(isAbove1000).toBe(true);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          index_value: '1000079228162510000',
          origin_index: INDEX_SCALE.toString(),
        },
      ],
    });

    const isAbove1001 = await isLoanOwedAboveThreshold(1, principal, 1001_0000000n);
    expect(isAbove1001).toBe(false);
  });
});
