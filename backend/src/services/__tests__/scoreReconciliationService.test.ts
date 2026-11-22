import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

const mockSetAbsoluteUserScoresBulk = jest
  .fn<(scores: Map<string, number>) => Promise<void>>()
  .mockResolvedValue(undefined);

const mockGetOnChainCreditScore = jest
  .fn<(address: string) => Promise<number>>()
  .mockResolvedValue(700);

const mockRecordScoreReconciliationRun = jest.fn();

const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
}));

jest.unstable_mockModule('../scoresService.js', () => ({
  setAbsoluteUserScoresBulk: mockSetAbsoluteUserScoresBulk,
}));

jest.unstable_mockModule('../sorobanService.js', () => ({
  sorobanService: {
    getOnChainCreditScore: mockGetOnChainCreditScore,
  },
}));

jest.unstable_mockModule('../../middleware/metrics.js', () => ({
  recordScoreReconciliationRun: mockRecordScoreReconciliationRun,
}));

jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  },
}));

const { scoreReconciliationService } = await import('../scoreReconciliationService.js');

describe('scoreReconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    mockQuery.mockImplementation(async (_sql: string, _params?: unknown[]) => {
      return { rows: [], rowCount: 0 };
    });
  });

  describe('reconcileActiveBorrowerScores', () => {
    it('returns empty result when there are no active borrowers', async () => {
      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.activeBorrowerCount).toBe(0);
      expect(result.checkedBorrowerCount).toBe(0);
      expect(result.failedBorrowerCount).toBe(0);
      expect(result.divergenceCount).toBe(0);
      expect(result.correctedCount).toBe(0);
      expect(mockRecordScoreReconciliationRun).toHaveBeenCalled();
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
    });

    it('treats borrower with matching on-chain score as non-divergent', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { address: 'GB...ABC', score: 700 },
          { address: 'GB...DEF', score: 650 },
        ],
        rowCount: 2,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(700).mockResolvedValueOnce(650);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.activeBorrowerCount).toBe(2);
      expect(result.checkedBorrowerCount).toBe(2);
      expect(result.failedBorrowerCount).toBe(0);
      expect(result.divergenceCount).toBe(0);
      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
    });

    it('detects divergence when on-chain score differs from DB score', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: 700 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(750);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.activeBorrowerCount).toBe(1);
      expect(result.checkedBorrowerCount).toBe(1);
      expect(result.failedBorrowerCount).toBe(0);
      expect(result.divergenceCount).toBe(1);
      expect(result.divergences[0]?.address).toBe('GB...ABC');
      expect(result.divergences[0]?.dbScore).toBe(700);
      expect(result.divergences[0]?.contractScore).toBe(750);
      expect(result.divergences[0]?.absoluteDifference).toBe(50);
    });

    it('treats null dbScore as divergent with null absoluteDifference', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...XYZ', score: null }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(600);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.divergences[0]?.dbScore).toBeNull();
      expect(result.divergences[0]?.absoluteDifference).toBeNull();
    });

    it('falls back to user_id/current_score schema when borrower column is missing', async () => {
      const err = new Error('column s.borrower does not exist') as any;
      err.code = '42703';

      mockQuery.mockRejectedValueOnce(err).mockResolvedValueOnce({
        rows: [{ address: 'GB...XYZ', score: 720 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(720);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.activeBorrowerCount).toBe(1);
      expect(result.checkedBorrowerCount).toBe(1);
      expect(result.divergenceCount).toBe(0);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1]?.[0]).toContain('s.user_id = a.address');
    });

    it('increments failedBorrowerCount when on-chain lookup rejects', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { address: 'GB...ABC', score: 700 },
          { address: 'GB...DEF', score: 650 },
          { address: 'GB...GHI', score: 600 },
        ],
        rowCount: 3,
      });

      mockGetOnChainCreditScore
        .mockResolvedValueOnce(700)
        .mockRejectedValueOnce(new Error('RPC timeout'))
        .mockResolvedValueOnce(600);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.activeBorrowerCount).toBe(3);
      expect(result.checkedBorrowerCount).toBe(2);
      expect(result.failedBorrowerCount).toBe(1);
      expect(result.divergenceCount).toBe(0);
    });

    it('does not crash the entire run when one on-chain lookup fails', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { address: 'GB...ABC', score: 700 },
          { address: 'GB...DEF', score: 700 },
        ],
        rowCount: 2,
      });

      mockGetOnChainCreditScore
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(700);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.failedBorrowerCount).toBe(1);
      expect(result.checkedBorrowerCount).toBe(1);
      expect(result.divergenceCount).toBe(0);
    });

    it('autocorrects divergence when autoCorrectEnabled and threshold met', async () => {
      const originalThreshold = process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD;
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD = '50';
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED = 'true';

      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: 700 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(600);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.correctedCount).toBe(1);
      expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledTimes(1);

      if (originalThreshold !== undefined) {
        process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD = originalThreshold;
      } else {
        delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD;
      }
      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED;
    });

    it('autocorrects null dbScore when threshold and enabled flag are set', async () => {
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED = 'true';
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD = '0';

      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...NULL', score: null }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(500);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.correctedCount).toBe(1);
      expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledTimes(1);

      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED;
      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD;
    });

    it('does not autocorrect divergence below threshold', async () => {
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED = 'true';
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD = '100';

      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: 700 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(650);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();

      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED;
      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD;
    });

    it('does not autocorrect when autoCorrectEnabled is false', async () => {
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED = 'false';

      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: 700 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(300);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();

      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED;
    });

    it('does not perform bulk write when there are zero corrections', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: 700 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(700);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
    });
  });

  describe('idempotency and partial failure handling', () => {
    const autoCorrectEnv = {
      enabled: 'SCORE_RECONCILIATION_AUTOCORRECT_ENABLED',
      threshold: 'SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD',
    } as const;

    beforeEach(() => {
      mockQuery.mockReset();
      mockSetAbsoluteUserScoresBulk.mockReset();
      mockSetAbsoluteUserScoresBulk.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      process.env[autoCorrectEnv.enabled] = 'true';
      process.env[autoCorrectEnv.threshold] = '0';
    });

    afterEach(() => {
      delete process.env[autoCorrectEnv.enabled];
      delete process.env[autoCorrectEnv.threshold];
      delete process.env.SCORE_RECONCILIATION_BATCH_SIZE;
    });

    it('does not write corrections again once a record has been reconciled', async () => {
      const storedScores = new Map<string, number>([['GB...ABC', 700]]);
      mockSetAbsoluteUserScoresBulk.mockImplementation(async (scores: Map<string, number>) => {
        for (const [address, score] of scores) {
          storedScores.set(address, score);
        }
      });

      // First run: stale DB score, on-chain score is the source of truth.
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: storedScores.get('GB...ABC') }],
        rowCount: 1,
      });
      mockGetOnChainCreditScore.mockResolvedValueOnce(750);

      const firstRun = await scoreReconciliationService.reconcileActiveBorrowerScores();
      expect(firstRun.divergenceCount).toBe(1);
      expect(firstRun.correctedCount).toBe(1);
      expect(storedScores.get('GB...ABC')).toBe(750);

      // Second run observes the persisted correction and must stay a no-op.
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...ABC', score: storedScores.get('GB...ABC') }],
        rowCount: 1,
      });
      mockGetOnChainCreditScore.mockResolvedValueOnce(750);

      const secondRun = await scoreReconciliationService.reconcileActiveBorrowerScores();
      expect(secondRun.divergenceCount).toBe(0);
      expect(secondRun.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledTimes(1);
    });

    it('retries a failed on-chain lookup on the next run and corrects then', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...RETRY', score: 700 }],
        rowCount: 1,
      });
      mockGetOnChainCreditScore.mockRejectedValueOnce(new Error('RPC timeout'));

      const firstRun = await scoreReconciliationService.reconcileActiveBorrowerScores();
      expect(firstRun.failedBorrowerCount).toBe(1);
      expect(firstRun.divergenceCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();

      // The failed record is re-read and retried on the next run.
      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...RETRY', score: 700 }],
        rowCount: 1,
      });
      mockGetOnChainCreditScore.mockResolvedValueOnce(720);

      const secondRun = await scoreReconciliationService.reconcileActiveBorrowerScores();
      expect(secondRun.failedBorrowerCount).toBe(0);
      expect(secondRun.divergenceCount).toBe(1);
      expect(secondRun.correctedCount).toBe(1);
      expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledTimes(1);
      expect(mockSetAbsoluteUserScoresBulk.mock.calls[0]![0]).toEqual(
        new Map([['GB...RETRY', 720]]),
      );
    });

    it('surfaces a partial write failure and records the run as failed', async () => {
      const writeError = new Error('batch update failed after partial write');
      mockSetAbsoluteUserScoresBulk.mockRejectedValueOnce(writeError);

      mockQuery.mockResolvedValueOnce({
        rows: [
          { address: 'GB...ONE', score: 700 },
          { address: 'GB...TWO', score: 600 },
        ],
        rowCount: 2,
      });
      mockGetOnChainCreditScore.mockResolvedValueOnce(750).mockResolvedValueOnce(650);

      await expect(scoreReconciliationService.reconcileActiveBorrowerScores()).rejects.toThrow(
        'batch update failed after partial write',
      );

      expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledTimes(1);
      expect(mockRecordFailure).toHaveBeenCalledWith(
        'scoreReconciliationService',
        writeError,
        expect.any(Number),
      );
      expect(mockRecordSuccess).not.toHaveBeenCalled();
      expect(mockRecordScoreReconciliationRun).not.toHaveBeenCalled();
    });

    it('leaves the run retryable after a total fetch failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection reset'));

      await expect(scoreReconciliationService.reconcileActiveBorrowerScores()).rejects.toThrow(
        'connection reset',
      );
      expect(mockRecordFailure).toHaveBeenCalledTimes(1);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const retryRun = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(retryRun.activeBorrowerCount).toBe(0);
      expect(mockRecordSuccess).toHaveBeenCalledTimes(1);
    });

    it('does not correct a divergence one point below the threshold', async () => {
      process.env[autoCorrectEnv.threshold] = '50';

      mockQuery.mockResolvedValueOnce({
        rows: [{ address: 'GB...NEAR', score: 700 }],
        rowCount: 1,
      });
      mockGetOnChainCreditScore.mockResolvedValueOnce(749);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.divergences[0]?.absoluteDifference).toBe(49);
      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
    });

    it('processes every borrower across batch boundaries', async () => {
      process.env.SCORE_RECONCILIATION_BATCH_SIZE = '2';

      const rows = Array.from({ length: 5 }, (_, index) => ({
        address: `GB...BATCH${index}`,
        score: 700,
      }));
      mockQuery.mockResolvedValueOnce({ rows, rowCount: rows.length });
      for (let index = 0; index < rows.length; index += 1) {
        mockGetOnChainCreditScore.mockResolvedValueOnce(700 + index + 1);
      }

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.activeBorrowerCount).toBe(5);
      expect(result.checkedBorrowerCount).toBe(5);
      expect(result.failedBorrowerCount).toBe(0);
      expect(result.divergenceCount).toBe(5);
      expect(result.correctedCount).toBe(5);
      const corrections = mockSetAbsoluteUserScoresBulk.mock.calls[0]![0];
      expect(corrections.size).toBe(5);
      expect(mockGetOnChainCreditScore).toHaveBeenCalledTimes(5);
    });
  });
});
