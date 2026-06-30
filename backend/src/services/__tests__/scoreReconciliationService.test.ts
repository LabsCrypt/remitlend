import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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
          { address: 'GB...ABC', current_score: 700 },
          { address: 'GB...DEF', current_score: 650 },
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
        rows: [{ address: 'GB...ABC', current_score: 700 }],
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
        rows: [{ address: 'GB...XYZ', current_score: null }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(600);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.divergenceCount).toBe(1);
      expect(result.divergences[0]?.dbScore).toBeNull();
      expect(result.divergences[0]?.absoluteDifference).toBeNull();
    });

    it('increments failedBorrowerCount when on-chain lookup rejects', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { address: 'GB...ABC', current_score: 700 },
          { address: 'GB...DEF', current_score: 650 },
          { address: 'GB...GHI', current_score: 600 },
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
          { address: 'GB...ABC', current_score: 700 },
          { address: 'GB...DEF', current_score: 700 },
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
        rows: [{ address: 'GB...ABC', current_score: 700 }],
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
        rows: [{ address: 'GB...NULL', current_score: null }],
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
        rows: [{ address: 'GB...ABC', current_score: 700 }],
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
        rows: [{ address: 'GB...ABC', current_score: 700 }],
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
        rows: [{ address: 'GB...ABC', current_score: 700 }],
        rowCount: 1,
      });

      mockGetOnChainCreditScore.mockResolvedValueOnce(700);

      const result = await scoreReconciliationService.reconcileActiveBorrowerScores();

      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
    });
  });
});
