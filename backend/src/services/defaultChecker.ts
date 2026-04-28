import {
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import {
  createSorobanRpcServer,
  getStellarNetworkPassphrase,
} from "../config/stellar.js";

import { cacheService } from "./cacheService.js";

/**
 * Mirrors `LoanManager::DEFAULT_TERM_LEDGERS` in `contracts/loan_manager/src/lib.rs`.
 * Used to estimate on-chain due ledgers from indexed `LoanApproved` events.
 */
const DEFAULT_TERM_LEDGERS = 17_280;
const LOCK_KEY = "default_checker:running";
const LOCK_TTL_SECONDS = 600; // 10 minutes - prevents stuck locks from crashed runs

export interface DefaultCheckBatchResult {
  loanIds: number[];
  txHash?: string;
  submitStatus?: string;
  txStatus?: string;
  error?: string;
  timedOut?: boolean;
}

export interface DefaultCheckRunResult {
  runId: string;
  currentLedger: number;
  termLedgers: number;
  overdueCount: number;
  loansChecked: number;
  successfulSubmissions: number;
  failedSubmissions: number;
  oldestDueLedger?: number;
  ledgersPastOldestDue?: number;
  batches: DefaultCheckBatchResult[];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

export class DefaultChecker {
  private contractId: string;
  private termLedgers: number;
  private batchSize: number;
  private batchTimeoutMs: number;
  private maxLoansPerRun: number;
  private pollAttempts: number;
  private pollSleepMs: number;
  private concurrency: number;

  constructor() {
    this.contractId = process.env.LOAN_MANAGER_CONTRACT_ID || "";
    this.termLedgers = parsePositiveInt(
      process.env.LOAN_TERM_LEDGERS,
      DEFAULT_TERM_LEDGERS,
    );
    this.batchSize = parsePositiveInt(process.env.DEFAULT_CHECK_BATCH_SIZE, 25);
    this.batchTimeoutMs = parsePositiveInt(
      process.env.DEFAULT_CHECK_BATCH_TIMEOUT_MS,
      5 * 60 * 1000,
    );
    this.maxLoansPerRun = parsePositiveInt(
      process.env.DEFAULT_CHECK_MAX_LOANS_PER_RUN,
      500,
    );
    this.pollAttempts = parsePositiveInt(
      process.env.DEFAULT_CHECK_POLL_ATTEMPTS,
      30,
    );
    this.pollSleepMs = parsePositiveInt(
      process.env.DEFAULT_CHECK_POLL_SLEEP_MS,
      1_000,
    );
    this.concurrency = parsePositiveInt(
      process.env.DEFAULT_CHECK_CONCURRENCY,
      3,
    );
  }

  private assertConfigured(): {
    signer: Keypair;
    server: rpc.Server;
    passphrase: string;
  } {
    if (!this.contractId) {
      throw AppError.internal(
        "Default checker misconfiguration: LOAN_MANAGER_CONTRACT_ID is not set",
      );
    }

    const secret = process.env.LOAN_MANAGER_ADMIN_SECRET;
    if (!secret) {
      throw AppError.internal(
        "Default checker misconfiguration: LOAN_MANAGER_ADMIN_SECRET is not set",
      );
    }

    let signer: Keypair;
    try {
      signer = Keypair.fromSecret(secret);
    } catch {
      throw AppError.internal(
        "Default checker misconfiguration: LOAN_MANAGER_ADMIN_SECRET is invalid",
      );
    }

    const server = createSorobanRpcServer();
    const passphrase = getStellarNetworkPassphrase();

    return { signer, server, passphrase };
  }

  private async fetchOverdueLoanIds(currentLedger: number): Promise<number[]> {
    const result = await query(
      `
      WITH approved AS (
        SELECT loan_id, MAX(ledger) AS approved_ledger
        FROM loan_events
        WHERE event_type = 'LoanApproved'
          AND loan_id IS NOT NULL
        GROUP BY loan_id
      ),
      active AS (
        SELECT
          a.loan_id,
          a.approved_ledger,
          (a.approved_ledger + $1) AS due_ledger
        FROM approved a
        WHERE NOT EXISTS (
          SELECT 1
          FROM loan_events e
          WHERE e.loan_id = a.loan_id
            AND e.event_type IN ('LoanRepaid', 'LoanDefaulted')
        )
      )
      SELECT loan_id
      FROM active
      WHERE due_ledger < $2
      ORDER BY due_ledger ASC, loan_id ASC
      LIMIT $3
      `,
      [this.termLedgers, currentLedger, this.maxLoansPerRun],
    );

    return result.rows
      .map((r: { loan_id: unknown }) => Number(r.loan_id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
  }

  private async fetchOverdueStats(currentLedger: number): Promise<{
    overdueCount: number;
    oldestDueLedger?: number;
    ledgersPastOldestDue?: number;
  }> {
    const result = await query(
      `
      WITH approved AS (
        SELECT loan_id, MAX(ledger) AS approved_ledger
        FROM loan_events
        WHERE event_type = 'LoanApproved'
          AND loan_id IS NOT NULL
        GROUP BY loan_id
      ),
      active AS (
        SELECT
          a.loan_id,
          (a.approved_ledger + $1) AS due_ledger
        FROM approved a
        WHERE NOT EXISTS (
          SELECT 1
          FROM loan_events e
          WHERE e.loan_id = a.loan_id
            AND e.event_type IN ('LoanRepaid', 'LoanDefaulted')
        )
      ),
      overdue AS (
        SELECT *
        FROM active
        WHERE due_ledger < $2
      )
      SELECT
        COUNT(*)::bigint AS overdue_count,
        MIN(due_ledger) AS oldest_due_ledger
      FROM overdue
      `,
      [this.termLedgers, currentLedger],
    );

    const row = result.rows[0] as
      | {
          overdue_count?: string | bigint;
          oldest_due_ledger?: string | bigint | null;
        }
      | undefined;

    const overdueCount =
      row?.overdue_count != null ? Number(row.overdue_count) : 0;
    const oldestDueLedger =
      row?.oldest_due_ledger != null
        ? Number(row.oldest_due_ledger)
        : undefined;

    const ledgersPastOldestDue =
      oldestDueLedger != null && Number.isFinite(oldestDueLedger)
        ? Math.max(0, currentLedger - oldestDueLedger)
        : undefined;

    return {
      overdueCount,
      ...(oldestDueLedger !== undefined ? { oldestDueLedger } : {}),
      ...(ledgersPastOldestDue !== undefined ? { ledgersPastOldestDue } : {}),
    };
  }

  private async submitCheckDefaults(
    server: rpc.Server,
    signer: Keypair,
    passphrase: string,
    loanIds: number[],
  ): Promise<DefaultCheckBatchResult> {
    const account = await server.getAccount(signer.publicKey());

    const loanIdsScVal = nativeToScVal(loanIds, { type: "u32" });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: "check_defaults",
          args: [loanIdsScVal],
        }),
      )
      .setTimeout(30)
      .build();

    let prepared;
    try {
      prepared = await server.prepareTransaction(tx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { loanIds, error: `prepareTransaction failed: ${message}` };
    }

    prepared.sign(signer);

    let send;
    try {
      send = await server.sendTransaction(prepared);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { loanIds, error: `sendTransaction failed: ${message}` };
    }

    const txHash = send.hash;
    const submitStatus = send.status;

    if (!txHash) {
      return {
        loanIds,
        ...(submitStatus !== undefined ? { submitStatus } : {}),
        error: "sendTransaction returned no hash",
      };
    }

    let txStatus: string | undefined;
    try {
      const polled = await server.pollTransaction(txHash, {
        attempts: this.pollAttempts,
        sleepStrategy: (_attempt: number) => this.pollSleepMs,
      });
      txStatus = polled.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Default check transaction polling failed", {
        txHash,
        message,
      });
    }

    return {
      loanIds,
      txHash,
      ...(submitStatus !== undefined ? { submitStatus } : {}),
      ...(txStatus !== undefined ? { txStatus } : {}),
    };
  }

  private async submitCheckDefaultsWithTimeout(
    server: rpc.Server,
    signer: Keypair,
    passphrase: string,
    loanIds: number[],
  ): Promise<DefaultCheckBatchResult> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<DefaultCheckBatchResult>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve({
          loanIds,
          timedOut: true,
          error: `batch timed out after ${this.batchTimeoutMs}ms`,
        });
      }, this.batchTimeoutMs);
      timeoutHandle.unref?.();
    });

    const submissionPromise: Promise<DefaultCheckBatchResult> =
      this.submitCheckDefaults(server, signer, passphrase, loanIds).catch(
        (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            loanIds,
            error: `default check batch failed: ${message}`,
          } satisfies DefaultCheckBatchResult;
        },
      );

    const result = await Promise.race([submissionPromise, timeoutPromise]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (result.timedOut) {
      logger.warn("Default check batch timed out", {
        loanIds,
        timeoutMs: this.batchTimeoutMs,
      });
    }

    return result;
  }

  /**
   * Acquires a distributed lock using Redis SET NX with TTL.
   * Returns true if lock acquired, false if another instance is running.
   */
  private async acquireLock(): Promise<boolean> {
    try {
      const lockValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const acquired = await cacheService.setNotExists(
        LOCK_KEY,
        lockValue,
        LOCK_TTL_SECONDS,
      );
      return acquired;
    } catch (error) {
      logger.error("Failed to acquire default checker lock", { error });
      return false;
    }
  }

  /**
   * Releases the distributed lock.
   */
  private async releaseLock(): Promise<void> {
    try {
      await cacheService.delete(LOCK_KEY);
    } catch (error) {
      logger.error("Failed to release default checker lock", { error });
    }
  }

  /**
   * Runs default checks for either:
   * - explicit `loanIds` (validated + de-duped), or
   * - all overdue loans discovered from `loan_events` (bounded by env limits).
   */
  async checkOverdueLoans(
    loanIds?: number[],
  ): Promise<DefaultCheckRunResult | null> {
    // Try to acquire distributed lock to prevent overlapping runs
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      logger.warn(
        "Default checker run skipped - another instance is already running",
      );
      return null;
    }

    try {
      const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { signer, server, passphrase } = this.assertConfigured();

      const latest = await server.getLatestLedger();
      const currentLedger = latest.sequence;

      const stats = await this.fetchOverdueStats(currentLedger);

      const explicitIds = loanIds
        ? Array.from(
            new Set(loanIds.filter((id) => Number.isInteger(id) && id > 0)),
          )
        : undefined;

      const targetIds =
        explicitIds && explicitIds.length > 0
          ? explicitIds
          : await this.fetchOverdueLoanIds(currentLedger);

      logger.info("default_check.run.start", {
        runId,
        currentLedger,
        termLedgers: this.termLedgers,
        batchSize: this.batchSize,
        batchTimeoutMs: this.batchTimeoutMs,
        maxLoansPerRun: this.maxLoansPerRun,
        overdueCount: stats.overdueCount,
        oldestDueLedger: stats.oldestDueLedger,
        ledgersPastOldestDue: stats.ledgersPastOldestDue,
        explicitLoanCount: explicitIds?.length ?? 0,
        targetLoanCount: targetIds.length,
      });

      const allChunks = chunk(targetIds, this.batchSize).filter(
        (b) => b.length > 0,
      );
      const batchResults = await mapConcurrent(
        allChunks,
        this.concurrency,
        async (batch) => {
          const result = await this.submitCheckDefaultsWithTimeout(
            server,
            signer,
            passphrase,
            batch,
          );

          logger.info("default_check.batch", {
            runId,
            loanIds: result.loanIds,
            txHash: result.txHash,
            submitStatus: result.submitStatus,
            txStatus: result.txStatus,
            error: result.error,
            timedOut: result.timedOut,
          });

          return result;
        },
      );

      const loansChecked = targetIds.length;
      const successfulSubmissions = batchResults.filter(
        (b) => !b.error && b.txHash,
      ).length;
      const failedSubmissions = batchResults.filter(
        (b) => b.error || !b.txHash,
      ).length;

      logger.info("default_check.run.complete", {
        runId,
        batches: batchResults.length,
        loansChecked,
        successfulSubmissions,
        failedSubmissions,
        currentLedger,
        overdueCount: stats.overdueCount,
        oldestDueLedger: stats.oldestDueLedger,
        ledgersPastOldestDue: stats.ledgersPastOldestDue,
      });

      return {
        runId,
        currentLedger,
        termLedgers: this.termLedgers,
        overdueCount: stats.overdueCount,
        loansChecked,
        successfulSubmissions,
        failedSubmissions,
        ...(stats.oldestDueLedger !== undefined
          ? { oldestDueLedger: stats.oldestDueLedger }
          : {}),
        ...(stats.ledgersPastOldestDue !== undefined
          ? { ledgersPastOldestDue: stats.ledgersPastOldestDue }
          : {}),
        batches: batchResults,
      };
    } finally {
      // Always release the lock, even if the run failed
      await this.releaseLock();
    }
  }
}

export const defaultChecker = new DefaultChecker();

let interval: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

export function startDefaultCheckerScheduler(): void {
  if (interval) return;

  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (
    !process.env.LOAN_MANAGER_CONTRACT_ID ||
    !process.env.LOAN_MANAGER_ADMIN_SECRET
  ) {
    logger.warn(
      "Default checker scheduler disabled (set LOAN_MANAGER_CONTRACT_ID and LOAN_MANAGER_ADMIN_SECRET)",
    );
    return;
  }

  const intervalMs = parsePositiveInt(
    process.env.DEFAULT_CHECK_INTERVAL_MS,
    30 * 60 * 1000,
  );

  interval = setInterval(() => {
    void (async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await defaultChecker.checkOverdueLoans();
      } catch (error) {
        logger.error("Default checker scheduled run failed", { error });
      } finally {
        inFlight = false;
      }
    })();
  }, intervalMs);

  logger.info("Default checker scheduler started", { intervalMs });
}

export function stopDefaultCheckerScheduler(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
  logger.info("Default checker scheduler stopped");
}
