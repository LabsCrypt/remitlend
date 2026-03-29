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

/**
 * Mirrors `LoanManager::DEFAULT_TERM_LEDGERS` in `contracts/loan_manager/src/lib.rs`.
 * Used to estimate on-chain due ledgers from indexed `LoanApproved` events.
 */
const DEFAULT_TERM_LEDGERS = 17_280;

export interface DefaultCheckBatchResult {
  loanIds: number[];
  txHash?: string;
  submitStatus?: string;
  txStatus?: string;
  error?: string;
}

export interface DefaultCheckRunResult {
  runId: string;
  currentLedger: number;
  termLedgers: number;
  overdueCount: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class DefaultChecker {
  private contractId: string;
  private termLedgers: number;
  private batchSize: number;
  private maxLoansPerRun: number;
  private pollAttempts: number;
  private pollSleepMs: number;

  constructor() {
    this.contractId = process.env.LOAN_MANAGER_CONTRACT_ID || "";
    this.termLedgers = parsePositiveInt(
      process.env.LOAN_TERM_LEDGERS,
      DEFAULT_TERM_LEDGERS,
    );
    this.batchSize = parsePositiveInt(process.env.DEFAULT_CHECK_BATCH_SIZE, 25);
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

  /**
   * Runs default checks for either:
   * - explicit `loanIds` (validated + de-duped), or
   * - all overdue loans discovered from `loan_events` (bounded by env limits).
   */
  async checkOverdueLoans(loanIds?: number[]): Promise<DefaultCheckRunResult> {
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
      maxLoansPerRun: this.maxLoansPerRun,
      overdueCount: stats.overdueCount,
      oldestDueLedger: stats.oldestDueLedger,
      ledgersPastOldestDue: stats.ledgersPastOldestDue,
      explicitLoanCount: explicitIds?.length ?? 0,
      targetLoanCount: targetIds.length,
    });

    const batches: DefaultCheckBatchResult[] = [];
    for (const batch of chunk(targetIds, this.batchSize)) {
      if (!batch.length) continue;
      const result = await this.submitCheckDefaults(
        server,
        signer,
        passphrase,
        batch,
      );
      batches.push(result);

      logger.info("default_check.batch", {
        runId,
        loanIds: result.loanIds,
        txHash: result.txHash,
        submitStatus: result.submitStatus,
        txStatus: result.txStatus,
        error: result.error,
      });
    }

    logger.info("default_check.run.complete", {
      runId,
      batches: batches.length,
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
      ...(stats.oldestDueLedger !== undefined
        ? { oldestDueLedger: stats.oldestDueLedger }
        : {}),
      ...(stats.ledgersPastOldestDue !== undefined
        ? { ledgersPastOldestDue: stats.ledgersPastOldestDue }
        : {}),
      batches,
    };
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
