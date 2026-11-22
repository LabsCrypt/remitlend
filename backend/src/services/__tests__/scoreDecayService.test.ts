import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type QueryResult = { rows: unknown[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
}));

const { getInactiveBorrowers, applyScoreDecay } = await import('../scoreDecayService.js');
const { runScoreDecayJob } = await import('../../cron/scoreDecayJob.js');

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

    it('is idempotent when run twice for the same inactivity window', async () => {
      const now = Date.now();
      const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
      const dbRow: { score: number; last_decayed_at: string | null } = {
        score: 700,
        last_decayed_at: null,
      };

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT s.user_id AS borrower')) {
          return {
            rows: [
              {
                borrower: 'user6',
                score: dbRow.score,
                last_activity: sixtyDaysAgo,
                last_decayed_at: dbRow.last_decayed_at,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE scores')) {
          dbRow.score = params![0] as number;
          dbRow.last_decayed_at = params![1] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const [firstBorrower] = await getInactiveBorrowers();
      const firstScore = await applyScoreDecay(firstBorrower!);
      expect(firstScore).toBe(690);
      expect(dbRow.score).toBe(690);
      expect(dbRow.last_decayed_at).not.toBeNull();

      // Re-run in the same inactivity window using the persisted last_decayed_at baseline
      const [secondBorrower] = await getInactiveBorrowers();
      const secondScore = await applyScoreDecay(secondBorrower!);
      expect(secondScore).toBe(690);
      expect(dbRow.score).toBe(690);
      // Only 1 UPDATE should have been executed across both runs
      const updateCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE scores'));
      expect(updateCalls).toHaveLength(1);
    });

    it('runScoreDecayJob leaves score unchanged when run twice for the same inactivity window', async () => {
      const now = Date.now();
      const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
      const dbRow: { score: number; last_decayed_at: string | null } = {
        score: 700,
        last_decayed_at: null,
      };

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT s.user_id AS borrower')) {
          return {
            rows: [
              {
                borrower: 'user7',
                score: dbRow.score,
                last_activity: sixtyDaysAgo,
                last_decayed_at: dbRow.last_decayed_at,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE scores')) {
          dbRow.score = params![0] as number;
          dbRow.last_decayed_at = params![1] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await runScoreDecayJob();
      expect(dbRow.score).toBe(690);

      await runScoreDecayJob();
      expect(dbRow.score).toBe(690);
      const updateCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE scores'));
      expect(updateCalls).toHaveLength(1);
    });
  });
});
