import { query } from "../db/connection.js";
import { setAbsoluteUserScoresBulk } from "./scoresService.js";
import { sorobanService } from "./sorobanService.js";
import logger from "../utils/logger.js";

interface ActiveBorrowerScoreRow {
  borrower: string;
  dbScore: number | null;
}

export interface ScoreDivergence {
  borrower: string;
  dbScore: number | null;
  contractScore: number;
  absoluteDifference: number | null;
}

export interface ScoreReconciliationResult {
  activeBorrowerCount: number;
  checkedBorrowerCount: number;
  failedBorrowerCount: number;
  divergenceCount: number;
  correctedCount: number;
  autoCorrectEnabled: boolean;
  autoCorrectThreshold: number;
  divergences: ScoreDivergence[];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

class ScoreReconciliationService {
  private getBatchSize(): number {
    return parsePositiveInt(process.env.SCORE_RECONCILIATION_BATCH_SIZE, 25);
  }

  private getMaxBorrowersPerRun(): number {
    return parsePositiveInt(
      process.env.SCORE_RECONCILIATION_MAX_BORROWERS_PER_RUN,
      500,
    );
  }

  private isAutoCorrectEnabled(): boolean {
    return parseBoolean(
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_ENABLED,
      false,
    );
  }

  private getAutoCorrectThreshold(): number {
    return parseNonNegativeInt(
      process.env.SCORE_RECONCILIATION_AUTOCORRECT_THRESHOLD,
      50,
    );
  }

  private async fetchActiveBorrowerScores(): Promise<ActiveBorrowerScoreRow[]> {
    const result = await query(
      `
      WITH active_loans AS (
        SELECT approved.loan_id, approved.address
        FROM contract_events approved
        WHERE approved.event_type = 'LoanApproved'
          AND approved.loan_id IS NOT NULL
          AND approved.address IS NOT NULL
          AND approved.address <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM contract_events e
            WHERE e.loan_id = approved.loan_id
              AND e.event_type IN ('LoanRepaid', 'LoanDefaulted')
          )
      )
      SELECT DISTINCT
        a.address,
        s.current_score
      FROM active_loans a
      LEFT JOIN scores s ON s.user_id = a.address
      ORDER BY a.address ASC
      LIMIT $1
      `,
      [this.getMaxBorrowersPerRun()],
    );

    return result.rows.map((row) => {
      const record = row as {
        address?: string;
        current_score?: number | string | null;
      };

      return {
        borrower: String(record.address ?? ""),
        dbScore:
          record.current_score === null || record.current_score === undefined
            ? null
            : Number(record.current_score),
      };
    });
  }

  async reconcileActiveBorrowerScores(): Promise<ScoreReconciliationResult> {
    const activeBorrowers = await this.fetchActiveBorrowerScores();
    const batchSize = this.getBatchSize();
    const autoCorrectEnabled = this.isAutoCorrectEnabled();
    const autoCorrectThreshold = this.getAutoCorrectThreshold();
    const divergences: ScoreDivergence[] = [];
    const corrections = new Map<string, number>();
    let checkedBorrowerCount = 0;
    let failedBorrowerCount = 0;

    logger.info("score_reconciliation.run.start", {
      activeBorrowerCount: activeBorrowers.length,
      batchSize,
      autoCorrectEnabled,
      autoCorrectThreshold,
    });

    for (const batch of chunk(activeBorrowers, batchSize)) {
      const batchResults = await Promise.allSettled(
        batch.map(async (borrowerRow) => {
          const contractScore = await sorobanService.getOnChainCreditScore(
            borrowerRow.borrower,
          );
          return {
            ...borrowerRow,
            contractScore,
          };
        }),
      );

      batchResults.forEach((result, index) => {
        const borrower = batch[index]?.borrower ?? "unknown";
        if (result.status === "rejected") {
          failedBorrowerCount += 1;
          logger.error("score_reconciliation.borrower.failed", {
            borrower,
            error: result.reason,
          });
          return;
        }

        checkedBorrowerCount += 1;
        const { dbScore, contractScore } = result.value;
        const absoluteDifference =
          dbScore === null ? null : Math.abs(contractScore - dbScore);
        const isDivergent = dbScore === null || dbScore !== contractScore;

        if (!isDivergent) {
          return;
        }

        const divergence: ScoreDivergence = {
          borrower,
          dbScore,
          contractScore,
          absoluteDifference,
        };
        divergences.push(divergence);

        logger.warn("score_reconciliation.mismatch", divergence);

        const exceedsThreshold =
          absoluteDifference === null ||
          absoluteDifference >= autoCorrectThreshold;

        if (autoCorrectEnabled && exceedsThreshold) {
          corrections.set(borrower, contractScore);
        }
      });
    }

    logger.info("score_divergence_count", {
      metric: "score_divergence_count",
      value: divergences.length,
    });

    if (corrections.size > 0) {
      await setAbsoluteUserScoresBulk(corrections);
      logger.warn("score_reconciliation.autocorrect.applied", {
        correctedCount: corrections.size,
        threshold: autoCorrectThreshold,
      });
    }

    const result: ScoreReconciliationResult = {
      activeBorrowerCount: activeBorrowers.length,
      checkedBorrowerCount,
      failedBorrowerCount,
      divergenceCount: divergences.length,
      correctedCount: corrections.size,
      autoCorrectEnabled,
      autoCorrectThreshold,
      divergences,
    };

    logger.info("score_reconciliation.run.complete", {
      activeBorrowerCount: result.activeBorrowerCount,
      checkedBorrowerCount: result.checkedBorrowerCount,
      failedBorrowerCount: result.failedBorrowerCount,
      divergenceCount: result.divergenceCount,
      correctedCount: result.correctedCount,
    });

    return result;
  }
}

export const scoreReconciliationService = new ScoreReconciliationService();

let reconciliationInterval: ReturnType<typeof setInterval> | undefined;
let reconciliationInFlight = false;

export function startScoreReconciliationScheduler(): void {
  if (reconciliationInterval) return;

  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (!process.env.REMITTANCE_NFT_CONTRACT_ID) {
    logger.warn(
      "Score reconciliation scheduler disabled (set REMITTANCE_NFT_CONTRACT_ID)",
    );
    return;
  }

  const intervalMs = parsePositiveInt(
    process.env.SCORE_RECONCILIATION_INTERVAL_MS,
    60 * 60 * 1000,
  );

  const run = async () => {
    if (reconciliationInFlight) {
      logger.warn(
        "Score reconciliation run skipped because a previous run is still in flight",
      );
      return;
    }

    reconciliationInFlight = true;
    try {
      await scoreReconciliationService.reconcileActiveBorrowerScores();
    } catch (error) {
      logger.error("Score reconciliation scheduled run failed", { error });
    } finally {
      reconciliationInFlight = false;
    }
  };

  void run();

  reconciliationInterval = setInterval(() => {
    void run();
  }, intervalMs);
  reconciliationInterval.unref?.();

  logger.info("Score reconciliation scheduler started", {
    intervalMs,
  });
}

export function stopScoreReconciliationScheduler(): void {
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = undefined;
    logger.info("Score reconciliation scheduler stopped");
  }
}
