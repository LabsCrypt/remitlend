import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type QueryResult = { rows: unknown[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const { getInactiveBorrowers, applyScoreDecay } = await import('../scoreDecayService.js');

describe('scoreDecayService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('getInactiveBorrowers', () => {
    it('selects inactive borrowers from the canonical scores table', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ borrower: 'user1', score: 700, last_repayment: null }],
        rowCount: 1,
      });

      const borrowers = await getInactiveBorrowers();

      expect(borrowers).toEqual([{ borrower: 'user1', score: 700, last_repayment: null }]);
      const sql = mockQuery.mock.calls[0]![0];
      expect(sql).toContain('FROM scores s');
      expect(sql).toContain('s.borrower');
      expect(sql).not.toContain('FROM borrowers');
    });
  });

  describe('applyScoreDecay', () => {
    it('decays inactive borrower with no repayment by configured amount', async () => {
      const borrower = { borrower: 'user1', score: 700, last_repayment: null };
      const newScore = await applyScoreDecay(borrower);

      // No last_repayment => monthsInactive = 1 => decay = 1 * 5 = 5
      expect(newScore).toBe(695);
      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE scores SET score = $1, updated_at = CURRENT_TIMESTAMP WHERE borrower = $2',
        [695, 'user1'],
      );
    });

    it('decays borrower inactive for multiple months', async () => {
      // 90 days = exactly 3 30-day months
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);

      const borrower = {
        borrower: 'user2',
        score: 700,
        last_repayment: ninetyDaysAgo.toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);

      // 90 days => floor(90/30) = 3 => max(1, 3) = 3 => decay = 3 * 5 = 15
      expect(newScore).toBe(685);
    });

    it('applies minimum decay of one month even with recent activity', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const borrower = {
        borrower: 'user3',
        score: 700,
        last_repayment: yesterday.toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);

      // 1 day => floor(1/30) = 0 => max(1, 0) = 1 => decay = 5
      expect(newScore).toBe(695);
    });

    it('floors score at minimum score', async () => {
      const borrower = { borrower: 'user4', score: 304, last_repayment: null };
      const newScore = await applyScoreDecay(borrower);

      // 304 - 5 = 299, floored to 300
      expect(newScore).toBe(300);
    });

    it('never drops score below minimum even if already below', async () => {
      const borrower = { borrower: 'user5', score: 200, last_repayment: null };
      const newScore = await applyScoreDecay(borrower);

      // max(300, 200 - 5) = 300
      expect(newScore).toBe(300);
    });

    it('is idempotent for identical borrower input', async () => {
      const borrower = { borrower: 'user6', score: 700, last_repayment: null };

      const first = await applyScoreDecay(borrower);
      const second = await applyScoreDecay(borrower);

      expect(first).toBe(695);
      expect(second).toBe(695);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
