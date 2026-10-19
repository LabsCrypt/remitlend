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
        rows: [{ borrower: 'user1', score: 700, last_activity: '2025-01-01T00:00:00.000Z' }],
        rowCount: 1,
      });

      const borrowers = await getInactiveBorrowers();

      expect(borrowers).toEqual([
        { borrower: 'user1', score: 700, last_activity: '2025-01-01T00:00:00.000Z' },
      ]);
      const sql = mockQuery.mock.calls[0]![0];
      expect(sql).toContain('FROM scores s');
      expect(sql).toContain('s.user_id');
      expect(sql).toContain('s.current_score');
      expect(sql).toContain("e.event_type IN ('LoanApproved', 'LoanRepaid')");
      expect(sql).toContain('HAVING MAX(e.ledger_closed_at) < NOW() - INTERVAL');
      expect(sql).not.toContain('IS NULL');
    });
  });

  describe('applyScoreDecay', () => {
    it('does not decay a borrower with no loan activity timestamp', async () => {
      const borrower = { borrower: 'user1', score: 700, last_activity: null };
      const newScore = await applyScoreDecay(borrower);

      expect(newScore).toBe(700);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('decays borrower inactive for multiple months', async () => {
      // 90 days = exactly 3 30-day months
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);

      const borrower = {
        borrower: 'user2',
        score: 700,
        last_activity: ninetyDaysAgo.toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);

      // 90 days => floor(90/30) = 3 => max(1, 3) = 3 => decay = 3 * 5 = 15
      expect(newScore).toBe(685);
    });

    it('does not decay a borrower before one full inactive month', async () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const borrower = {
        borrower: 'user3',
        score: 700,
        last_activity: yesterday.toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);

      expect(newScore).toBe(700);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('floors score at minimum score', async () => {
      const borrower = {
        borrower: 'user4',
        score: 304,
        last_activity: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);

      // 304 - 5 = 299, floored to 300
      expect(newScore).toBe(300);
    });

    it('never drops score below minimum even if already below', async () => {
      const borrower = {
        borrower: 'user5',
        score: 200,
        last_activity: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);

      // max(300, 200 - 5) = 300
      expect(newScore).toBe(300);
    });

    it('is idempotent for identical borrower input', async () => {
      const borrower = {
        borrower: 'user6',
        score: 700,
        last_activity: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const first = await applyScoreDecay(borrower);
      const second = await applyScoreDecay(borrower);

      expect(first).toBe(690);
      expect(second).toBe(690);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenLastCalledWith(
        'UPDATE scores SET current_score = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
        [690, 'user6'],
      );
    });
  });
});
