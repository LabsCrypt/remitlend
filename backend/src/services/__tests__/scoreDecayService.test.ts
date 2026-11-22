import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

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

  describe('applyScoreDecay date boundaries', () => {
    const NOW = new Date('2025-06-15T00:00:00.000Z');
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTH_MS = 30 * DAY_MS;

    const isoAtOffset = (epochMs: number, offset: string): string => {
      // Render the same instant with an explicit non-UTC offset so the test
      // proves decay math is based on the instant, not the wall-clock string.
      const sign = offset.startsWith('-') ? -1 : 1;
      const [hours, minutes] = offset.replace(/[+-]/, '').split(':').map(Number) as [
        number,
        number,
      ];
      const shifted = new Date(epochMs + sign * (hours * 60 + minutes) * 60 * 1000);
      return `${shifted.toISOString().slice(0, 19)}${offset}`;
    };

    beforeEach(() => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('applies exactly one month of decay at the exact 30-day cutoff', async () => {
      const score = await applyScoreDecay({
        borrower: 'boundary-exact',
        score: 700,
        last_activity: new Date(NOW.getTime() - MONTH_MS).toISOString(),
      });

      expect(score).toBe(695);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]![1]).toEqual([695, NOW.toISOString(), 'boundary-exact']);
    });

    it('does not decay one millisecond before the 30-day cutoff', async () => {
      const score = await applyScoreDecay({
        borrower: 'boundary-before',
        score: 700,
        last_activity: new Date(NOW.getTime() - MONTH_MS + 1).toISOString(),
      });

      expect(score).toBe(700);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('still applies one month one millisecond after the cutoff', async () => {
      const score = await applyScoreDecay({
        borrower: 'boundary-after',
        score: 700,
        last_activity: new Date(NOW.getTime() - MONTH_MS - 1).toISOString(),
      });

      expect(score).toBe(695);
    });

    it('applies two months at the exact 60-day cutoff', async () => {
      const score = await applyScoreDecay({
        borrower: 'boundary-two-months',
        score: 700,
        last_activity: new Date(NOW.getTime() - 2 * MONTH_MS).toISOString(),
      });

      expect(score).toBe(690);
      expect(mockQuery.mock.calls[0]![1]![0]).toBe(690);
    });

    it('decays identically for the same instant expressed in different timezones', async () => {
      const lastActivityInstant = NOW.getTime() - MONTH_MS;

      const fromUtc = await applyScoreDecay({
        borrower: 'tz-utc',
        score: 700,
        last_activity: new Date(lastActivityInstant).toISOString(),
      });
      const fromPositiveOffset = await applyScoreDecay({
        borrower: 'tz-plus-14',
        score: 700,
        last_activity: isoAtOffset(lastActivityInstant, '+14:00'),
      });
      const fromNegativeOffset = await applyScoreDecay({
        borrower: 'tz-minus-11',
        score: 700,
        last_activity: isoAtOffset(lastActivityInstant, '-11:00'),
      });

      expect(fromUtc).toBe(695);
      expect(fromPositiveOffset).toBe(695);
      expect(fromNegativeOffset).toBe(695);
    });

    it('does not decay when the activity timestamp crosses the cutoff only by local wall clock', async () => {
      // Same calendar date/time as the cutoff but shifted across the date line:
      // parsed instant is still 29d 23h before now, so no full month has elapsed.
      const lastActivityInstant = NOW.getTime() - MONTH_MS + 60 * 60 * 1000;

      const score = await applyScoreDecay({
        borrower: 'tz-near-boundary',
        score: 700,
        last_activity: isoAtOffset(lastActivityInstant, '+14:00'),
      });

      expect(score).toBe(700);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('honours an exact last_decayed_at baseline without double-decaying a month', async () => {
      const lastActivity = new Date(NOW.getTime() - 3 * MONTH_MS).toISOString();
      const lastDecayedAt = new Date(NOW.getTime() - MONTH_MS).toISOString();

      const score = await applyScoreDecay({
        borrower: 'boundary-baseline',
        score: 700,
        last_activity: lastActivity,
        last_decayed_at: lastDecayedAt,
      });

      // 3 months inactive - 2 months already decayed = 1 month pending.
      expect(score).toBe(695);
      expect(mockQuery.mock.calls[0]![1]![0]).toBe(695);
    });

    it('ignores a last_decayed_at that predates the latest activity', async () => {
      const lastActivity = new Date(NOW.getTime() - 2 * MONTH_MS).toISOString();
      const staleDecay = new Date(NOW.getTime() - 5 * MONTH_MS).toISOString();

      const score = await applyScoreDecay({
        borrower: 'boundary-stale-decay',
        score: 700,
        last_activity: lastActivity,
        last_decayed_at: staleDecay,
      });

      // The stale baseline is discarded, so both inactive months apply.
      expect(score).toBe(690);
    });

    it('does not decay an unparseable activity timestamp', async () => {
      const score = await applyScoreDecay({
        borrower: 'boundary-invalid',
        score: 700,
        last_activity: 'not-a-date',
      });

      expect(score).toBe(700);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('is idempotent when executed repeatedly at the exact cutoff', async () => {
      const dbRow: { score: number; last_decayed_at: string | null } = {
        score: 700,
        last_decayed_at: null,
      };
      const lastActivity = new Date(NOW.getTime() - MONTH_MS).toISOString();

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE scores')) {
          dbRow.score = params![0] as number;
          dbRow.last_decayed_at = params![1] as string;
        }
        return { rows: [], rowCount: 1 };
      });

      const first = await applyScoreDecay({
        borrower: 'boundary-repeat',
        score: dbRow.score,
        last_activity: lastActivity,
        last_decayed_at: dbRow.last_decayed_at,
      });
      const second = await applyScoreDecay({
        borrower: 'boundary-repeat',
        score: dbRow.score,
        last_activity: lastActivity,
        last_decayed_at: dbRow.last_decayed_at,
      });

      expect(first).toBe(695);
      expect(second).toBe(695);
      expect(dbRow.score).toBe(695);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('clamps to the minimum score and does not rewrite it on a repeat run', async () => {
      const dbRow: { score: number; last_decayed_at: string | null } = {
        score: 302,
        last_decayed_at: null,
      };
      const lastActivity = new Date(NOW.getTime() - MONTH_MS).toISOString();

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE scores')) {
          dbRow.score = params![0] as number;
          dbRow.last_decayed_at = params![1] as string;
        }
        return { rows: [], rowCount: 1 };
      });

      const first = await applyScoreDecay({
        borrower: 'boundary-min',
        score: dbRow.score,
        last_activity: lastActivity,
        last_decayed_at: dbRow.last_decayed_at,
      });
      const second = await applyScoreDecay({
        borrower: 'boundary-min',
        score: dbRow.score,
        last_activity: lastActivity,
        last_decayed_at: dbRow.last_decayed_at,
      });

      expect(first).toBe(300);
      expect(second).toBe(300);
      expect(dbRow.score).toBe(300);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});
