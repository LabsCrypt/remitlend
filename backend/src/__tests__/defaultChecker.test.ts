import { jest } from "@jest/globals";
import logger from "../utils/logger.js";
import { DefaultChecker } from "../services/defaultChecker.js";

describe("DefaultChecker", () => {
  const originalBatchSize = process.env.DEFAULT_CHECK_BATCH_SIZE;
  const originalBatchTimeoutMs = process.env.DEFAULT_CHECK_BATCH_TIMEOUT_MS;

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalBatchSize === undefined) {
      delete process.env.DEFAULT_CHECK_BATCH_SIZE;
    } else {
      process.env.DEFAULT_CHECK_BATCH_SIZE = originalBatchSize;
    }

    if (originalBatchTimeoutMs === undefined) {
      delete process.env.DEFAULT_CHECK_BATCH_TIMEOUT_MS;
    } else {
      process.env.DEFAULT_CHECK_BATCH_TIMEOUT_MS = originalBatchTimeoutMs;
    }
  });

  it("times out a stuck batch and continues processing later batches", async () => {
    process.env.DEFAULT_CHECK_BATCH_SIZE = "1";
    process.env.DEFAULT_CHECK_BATCH_TIMEOUT_MS = "10";

    const checker = new DefaultChecker();
    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => logger as typeof logger);

    (checker as any).acquireLock = async () => true;
    (checker as any).releaseLock = async () => undefined;
    (checker as any).assertConfigured = () => ({
      signer: {},
      server: {
        getLatestLedger: async () => ({ sequence: 4321 }),
      },
      passphrase: "test-passphrase",
    });
    (checker as any).fetchOverdueStats = async () => ({
      overdueCount: 2,
      oldestDueLedger: 4200,
      ledgersPastOldestDue: 121,
    });
    (checker as any).fetchOverdueLoanIds = async () => [101, 102];

    let submissionCount = 0;
    (checker as any).submitCheckDefaults = async (
      _server: unknown,
      _signer: unknown,
      _passphrase: string,
      loanIds: number[],
    ) => {
      submissionCount += 1;
      if (submissionCount === 1) {
        return new Promise<never>(() => undefined);
      }

      return {
        loanIds,
        txHash: "second-batch-hash",
        submitStatus: "PENDING",
      };
    };

    const result = await checker.checkOverdueLoans();

    expect(result!.batches).toHaveLength(2);
    expect(result!.batches[0]).toMatchObject({
      loanIds: [101],
      timedOut: true,
      error: "batch timed out after 10ms",
    });
    expect(result!.batches[1]).toMatchObject({
      loanIds: [102],
      txHash: "second-batch-hash",
      submitStatus: "PENDING",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Default check batch timed out",
      expect.objectContaining({
        loanIds: [101],
        timeoutMs: 10,
      }),
    );
  });
});
