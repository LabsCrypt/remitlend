import { query } from '../db/connection.js';
import { setAbsoluteUserScoresBulk } from './scoresService.js';
import { sorobanService } from './sorobanService.js';
import { jobMetricsService } from './jobMetricsService.js';
import logger from '../utils/logger.js';

/**
 * Cross-contract reconciliation (issue #1377).
 *
 * A loan's custody change (approve/repay/default) and its credit-score
 * mutation are supposed to share one atomic boundary. When they don't — e.g. a
 * classic disbursement submitted separately from the score sub-invocation, or a
 * score update that never lands — the two sides diverge silently.
 *
 * This service owns a durable ledger (`cross_contract_reconciliation`) so that
 * divergence is observable and repairable:
 *   1. backfill: one row per custody event, keyed by a deterministic intent_key.
 *   2. reconcile: for events that expect a score delta (repay/default), confirm
 *      a matching on-chain score event landed; otherwise flag `half_applied`.
 *   3. repair (opt-in): correct the DB score to the authoritative on-chain value.
 *
 * NOTE (scope): on-chain *repair* (submitting a settle_intent / apply_pending_score
 * admin transaction) is intentionally NOT performed here — this service detects,
 * records, and DB-side-corrects. See PR notes.
 */

interface UnresolvedRow {
  id: number;
  intentKey: string;
  loanId: number | null;
  borrower: string;
  operation: 'approve' | 'repay' | 'default';
  disbursementLedger: number | null;
  expectedScoreDelta: number;
  attempts: number;
  state: 'pending' | 'half_applied';
}

export interface CrossContractReconciliationResult {
  backfilledRows: number;
  processedRows: number;
  reconciledCount: number;
  halfAppliedCount: number;
  stillPendingCount: number;
  correctedCount: number;
  autoCorrectEnabled: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

// On-chain event types that represent a credit-score mutation landing.
const SCORE_EVENT_TYPES = ['ScoreUpdated', 'ScoreDecreased'];

class CrossContractReconciler {
  private getMaxRowsPerRun(): number {
    return parsePositiveInt(process.env.CROSS_RECONCILE_MAX_ROWS_PER_RUN, 500);
  }

  /** Attempts without a matching score event before a row is flagged half_applied. */
  private getStaleAttempts(): number {
    return parsePositiveInt(process.env.CROSS_RECONCILE_STALE_ATTEMPTS, 3);
  }

  private isAutoCorrectEnabled(): boolean {
    return parseBoolean(process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED, false);
  }

  /**
   * Insert one `pending` reconciliation row per custody event that doesn't have
   * one yet. Idempotent via the unique intent_key + ON CONFLICT DO NOTHING.
   */
  private async backfillPendingRows(): Promise<number> {
    const result = await query(
      `/* backfill */
      INSERT INTO cross_contract_reconciliation
        (intent_key, loan_id, borrower, operation, disbursement_ledger,
         disbursement_tx_hash, expected_score_delta, state)
      SELECT
        ce.event_type || ':' || COALESCE(ce.loan_id::text, '-') || ':' || ce.event_id,
        ce.loan_id,
        ce.address,
        CASE ce.event_type
          WHEN 'LoanApproved'  THEN 'approve'
          WHEN 'LoanRepaid'    THEN 'repay'
          WHEN 'LoanDefaulted' THEN 'default'
        END,
        ce.ledger,
        ce.tx_hash,
        CASE ce.event_type
          WHEN 'LoanRepaid'    THEN GREATEST(0, FLOOR(COALESCE(ce.amount, 0) / 100))::int
          WHEN 'LoanDefaulted' THEN -50
          ELSE 0
        END,
        'pending'
      FROM contract_events ce
      WHERE ce.event_type IN ('LoanApproved', 'LoanRepaid', 'LoanDefaulted')
        AND ce.address IS NOT NULL
        AND ce.address <> ''
        AND NOT EXISTS (
          SELECT 1 FROM cross_contract_reconciliation r
          WHERE r.intent_key =
            ce.event_type || ':' || COALESCE(ce.loan_id::text, '-') || ':' || ce.event_id
        )
      ON CONFLICT (intent_key) DO NOTHING`,
    );
    return result.rowCount ?? 0;
  }

  private async fetchUnresolvedRows(): Promise<UnresolvedRow[]> {
    const result = await query(
      `/* fetch-unresolved */
      SELECT id, intent_key, loan_id, borrower, operation, disbursement_ledger,
             expected_score_delta, attempts, state
      FROM cross_contract_reconciliation
      WHERE state IN ('pending', 'half_applied')
      ORDER BY id ASC
      LIMIT $1`,
      [this.getMaxRowsPerRun()],
    );

    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        intentKey: String(r.intent_key ?? ''),
        loanId: r.loan_id == null ? null : Number(r.loan_id),
        borrower: String(r.borrower ?? ''),
        operation: String(r.operation ?? 'approve') as UnresolvedRow['operation'],
        disbursementLedger: r.disbursement_ledger == null ? null : Number(r.disbursement_ledger),
        expectedScoreDelta: Number(r.expected_score_delta ?? 0),
        attempts: Number(r.attempts ?? 0),
        state: String(r.state ?? 'pending') as UnresolvedRow['state'],
      };
    });
  }

  /** Returns the ledger of the first matching on-chain score event, or null. */
  private async findMatchingScoreLedger(
    borrower: string,
    sinceLedger: number | null,
  ): Promise<number | null> {
    const result = await query(
      `/* match-score */
      SELECT ledger
      FROM contract_events
      WHERE address = $1
        AND event_type = ANY($2::text[])
        AND ledger >= $3
      ORDER BY ledger ASC
      LIMIT 1`,
      [borrower, SCORE_EVENT_TYPES, sinceLedger ?? 0],
    );
    const row = result.rows[0] as { ledger?: number | string } | undefined;
    return row?.ledger == null ? null : Number(row.ledger);
  }

  private async markReconciled(id: number, scoreLedger: number | null, applied: boolean): Promise<void> {
    await query(
      `/* update */
      UPDATE cross_contract_reconciliation
      SET state = 'reconciled', score_applied = $2, score_ledger = $3,
          attempts = attempts + 1, last_checked_at = now(), updated_at = now()
      WHERE id = $1`,
      [id, applied, scoreLedger],
    );
  }

  private async markState(id: number, state: 'pending' | 'half_applied'): Promise<void> {
    await query(
      `/* update */
      UPDATE cross_contract_reconciliation
      SET state = $2, attempts = attempts + 1, last_checked_at = now(), updated_at = now()
      WHERE id = $1`,
      [id, state],
    );
  }

  async run(): Promise<CrossContractReconciliationResult> {
    const startTime = Date.now();
    const jobName = 'crossContractReconciler';
    const autoCorrectEnabled = this.isAutoCorrectEnabled();
    const staleAttempts = this.getStaleAttempts();

    const result: CrossContractReconciliationResult = {
      backfilledRows: 0,
      processedRows: 0,
      reconciledCount: 0,
      halfAppliedCount: 0,
      stillPendingCount: 0,
      correctedCount: 0,
      autoCorrectEnabled,
    };

    try {
      result.backfilledRows = await this.backfillPendingRows();
      const rows = await this.fetchUnresolvedRows();

      logger.withContext().info('cross_contract_reconciliation.run.start', {
        backfilledRows: result.backfilledRows,
        unresolvedRows: rows.length,
        autoCorrectEnabled,
      });

      const corrections = new Map<string, number>();

      for (const row of rows) {
        result.processedRows += 1;

        // Custody ops with no expected score change (approve, today) reconcile
        // immediately — there is nothing to sync.
        if (row.expectedScoreDelta === 0) {
          await this.markReconciled(row.id, null, false);
          result.reconciledCount += 1;
          continue;
        }

        const scoreLedger = await this.findMatchingScoreLedger(
          row.borrower,
          row.disbursementLedger,
        );

        if (scoreLedger !== null) {
          await this.markReconciled(row.id, scoreLedger, true);
          result.reconciledCount += 1;
          continue;
        }

        // No matching score event yet. If we've tried enough times, the custody
        // change committed without its score delta — a half-applied divergence.
        if (row.attempts + 1 >= staleAttempts) {
          await this.markState(row.id, 'half_applied');
          result.halfAppliedCount += 1;

          if (autoCorrectEnabled) {
            try {
              const onChainScore = await sorobanService.getOnChainCreditScore(row.borrower);
              corrections.set(row.borrower, onChainScore);
            } catch (err) {
              logger.withContext().error('cross_contract_reconciliation.autocorrect.lookup_failed', {
                borrower: row.borrower,
                error: err,
              });
            }
          }
        } else {
          await this.markState(row.id, 'pending');
          result.stillPendingCount += 1;
        }
      }

      if (corrections.size > 0) {
        await setAbsoluteUserScoresBulk(corrections);
        result.correctedCount = corrections.size;
        logger.withContext().warn('cross_contract_reconciliation.autocorrect.applied', {
          correctedCount: corrections.size,
        });
      }

      logger.withContext().info('cross_contract_reconciliation.run.complete', { ...result });
      jobMetricsService.recordSuccess(jobName, Date.now() - startTime);
      return result;
    } catch (error) {
      jobMetricsService.recordFailure(jobName, error as Error | string, Date.now() - startTime);
      throw error;
    }
  }
}

export const crossContractReconciler = new CrossContractReconciler();

let interval: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

export function startCrossContractReconciler(): void {
  if (interval) return;
  if (process.env.NODE_ENV === 'test') return;

  if (!process.env.REMITTANCE_NFT_CONTRACT_ID) {
    logger
      .withContext()
      .warn('Cross-contract reconciler disabled (set REMITTANCE_NFT_CONTRACT_ID)');
    return;
  }

  const intervalMs = parsePositiveInt(process.env.CROSS_RECONCILE_INTERVAL_MS, 5 * 60 * 1000);

  const runOnce = async () => {
    if (inFlight) {
      logger.withContext().warn('Cross-contract reconciler run skipped (previous run in flight)');
      return;
    }
    inFlight = true;
    try {
      await crossContractReconciler.run();
    } catch (error) {
      logger.withContext().error('Cross-contract reconciler scheduled run failed', { error });
    } finally {
      inFlight = false;
    }
  };

  void runOnce();
  interval = setInterval(() => void runOnce(), intervalMs);
  interval.unref?.();

  logger.withContext().info('Cross-contract reconciler scheduler started', { intervalMs });
}

export function stopCrossContractReconciler(): void {
  if (interval) {
    clearInterval(interval);
    interval = undefined;
    logger.withContext().info('Cross-contract reconciler scheduler stopped');
  }
}
