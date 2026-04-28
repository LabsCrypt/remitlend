import { jest } from "@jest/globals";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
const mockGetOnChainCreditScore =
  jest.fn<(userPublicKey: string) => Promise<number>>();
const mockSetAbsoluteUserScoresBulk =
  jest.fn<(scores: Map<string, number>) => Promise<void>>();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    getOnChainCreditScore: mockGetOnChainCreditScore,
  },
}));

jest.unstable_mockModule("../services/scoresService.js", () => ({
  setAbsoluteUserScoresBulk: mockSetAbsoluteUserScoresBulk,
}));

const logger = (await import("../utils/logger.js")).default;
const { scoreReconciliationService } =
  await import("../services/scoreReconciliationService.js");

describe("scoreReconciliationService", () => {
  const originalAutoCorrectEnabled =
    process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED;
  const originalAutoCorrectThreshold =
    process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD;
  const originalBatchSize = process.env.SCORE_RECONCILIATION_BATCH_SIZE;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    if (originalAutoCorrectEnabled === undefined) {
      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED;
    } else {
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED =
        originalAutoCorrectEnabled;
    }

    if (originalAutoCorrectThreshold === undefined) {
      delete process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD;
    } else {
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD =
        originalAutoCorrectThreshold;
    }

    if (originalBatchSize === undefined) {
      delete process.env.SCORE_RECONCILIATION_BATCH_SIZE;
    } else {
      process.env.SCORE_RECONCILIATION_BATCH_SIZE = originalBatchSize;
    }
  });

  it("logs divergences and auto-corrects borrowers above the threshold", async () => {
    process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED = "true";
    process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD = "40";
    process.env.SCORE_RECONCILIATION_BATCH_SIZE = "2";

    const infoSpy = jest
      .spyOn(logger, "info")
      .mockImplementation(() => logger as typeof logger);
    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => logger as typeof logger);

    mockQuery.mockResolvedValueOnce({
      rows: [
        { borrower: "GBORROWER1", current_score: 700 },
        { borrower: "GBORROWER2", current_score: 600 },
        { borrower: "GBORROWER3", current_score: null },
      ],
    });

    mockGetOnChainCreditScore
      .mockResolvedValueOnce(700)
      .mockResolvedValueOnce(660)
      .mockResolvedValueOnce(620);
    mockSetAbsoluteUserScoresBulk.mockResolvedValueOnce();

    const result =
      await scoreReconciliationService.reconcileActiveBorrowerScores();

    expect(result).toMatchObject({
      activeBorrowerCount: 3,
      checkedBorrowerCount: 3,
      failedBorrowerCount: 0,
      divergenceCount: 2,
      correctedCount: 2,
      autoCorrectEnabled: true,
      autoCorrectThreshold: 40,
    });
    expect(result.divergences).toEqual([
      {
        borrower: "GBORROWER2",
        dbScore: 600,
        contractScore: 660,
        absoluteDifference: 60,
      },
      {
        borrower: "GBORROWER3",
        dbScore: null,
        contractScore: 620,
        absoluteDifference: null,
      },
    ]);
    expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledWith(
      new Map([
        ["GBORROWER2", 660],
        ["GBORROWER3", 620],
      ]),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "score_divergence_count",
      expect.objectContaining({
        metric: "score_divergence_count",
        value: 2,
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "score_reconciliation.autocorrect.applied",
      expect.objectContaining({
        correctedCount: 2,
        threshold: 40,
      }),
    );
  });
});
