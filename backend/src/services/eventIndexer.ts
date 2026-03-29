import { rpc as SorobanRpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import { createRequestId, runWithRequestContext } from "../utils/requestContext.js";
import {
  type IndexedLoanEvent,
  type WebhookEventType,
  webhookService,
} from "./webhookService.js";
import { eventStreamService } from "./eventStreamService.js";
import { sorobanService } from "./sorobanService.js";

interface SorobanRawEvent {
  id: string;
  pagingToken: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
}

interface LoanEvent extends IndexedLoanEvent {
  amount?: string;
  loanId?: number;
  borrower: string;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
  interestRateBps?: number;
  termLedgers?: number;
}

interface EventIndexerConfig {
  name: string;
  rpcUrl: string;
  contractId: string;
  pollIntervalMs?: number;
  batchSize?: number;
}

interface StoreEventsResult {
  insertedCount: number;
}

interface ProcessChunkResult {
  lastProcessedLedger: number;
  fetchedEvents: number;
  insertedEvents: number;
}

export class EventIndexer {
  private readonly name: string;
  private readonly rpc: SorobanRpc.Server;
  private readonly contractId: string;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private running = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor(config: EventIndexerConfig);
  constructor(rpcUrl: string, contractId: string, name?: string);
  constructor(configOrRpcUrl: EventIndexerConfig | string, contractId?: string, name?: string) {
    if (typeof configOrRpcUrl === "string") {
      if (!contractId) {
        throw new Error("contractId is required when using rpcUrl constructor");
      }
      this.name = name ?? "default";
      this.rpc = new SorobanRpc.Server(configOrRpcUrl);
      this.contractId = contractId;
      this.pollIntervalMs = 30_000;
      this.batchSize = 100;
      return;
    }

    this.name = configOrRpcUrl.name;
    this.rpc = new SorobanRpc.Server(configOrRpcUrl.rpcUrl);
    this.contractId = configOrRpcUrl.contractId;
    this.pollIntervalMs = configOrRpcUrl.pollIntervalMs ?? 30_000;
    this.batchSize = configOrRpcUrl.batchSize ?? 100;
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Indexer start requested while already running");
      return;
    }

    this.running = true;
    await this.pollOnce();
    this.scheduleNextPoll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  async processEvents(startLedger: number, endLedger: number): Promise<number> {
    const chunkResult = await this.processChunk(startLedger, endLedger);
    return chunkResult.lastProcessedLedger;
  }

  async reindexRange(fromLedger: number, toLedger: number): Promise<{
    fromLedger: number;
    toLedger: number;
    fetchedEvents: number;
    insertedEvents: number;
    lastProcessedLedger: number;
  }> {
    let current = fromLedger;
    let totalFetched = 0;
    let totalInserted = 0;
    let lastProcessedLedger = fromLedger - 1;

    while (current <= toLedger) {
      const chunkEnd = Math.min(current + this.batchSize - 1, toLedger);
      const result = await this.processChunk(current, chunkEnd);

      totalFetched += result.fetchedEvents;
      totalInserted += result.insertedEvents;
      lastProcessedLedger = result.lastProcessedLedger;
      current = chunkEnd + 1;
    }

    return {
      fromLedger,
      toLedger,
      fetchedEvents: totalFetched,
      insertedEvents: totalInserted,
      lastProcessedLedger,
    };
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;

    this.pollTimeout = setTimeout(async () => {
      try {
        await this.pollOnce();
      } catch (error) {
        logger.error("Indexer poll iteration failed", { error });
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollIntervalMs);
  }

  private async pollOnce(): Promise<void> {
    if (!this.running) return;

    const lastIndexedLedger = await this.getLastIndexedLedger();
    const latestLedger = await this.getLatestLedgerSequence();

    if (latestLedger <= lastIndexedLedger) {
      return;
    }

    const fromLedger = lastIndexedLedger + 1;
    const toLedger = Math.min(fromLedger + this.batchSize - 1, latestLedger);

    const result = await this.processChunk(fromLedger, toLedger);
    await this.updateLastIndexedLedger(result.lastProcessedLedger);
  }

  private async getLatestLedgerSequence(): Promise<number> {
    try {
      const latest = (await (this.rpc as unknown as {
        getLatestLedger: () => Promise<Record<string, unknown>>;
      }).getLatestLedger()) as Record<string, unknown>;

      const candidate =
        latest.sequence ?? latest.sequenceNumber ?? latest.seq ?? latest.id;
      const sequence = Number(candidate);

      return Number.isFinite(sequence) && sequence > 0 ? sequence : 0;
    } catch (error) {
      logger.warn("Failed to fetch latest ledger sequence", { error });
      return 0;
    }
  }

  private async getLastIndexedLedger(): Promise<number> {
    const result = await query(
      `SELECT last_indexed_ledger
       FROM indexer_state
       WHERE indexer_name = $1
       LIMIT 1`,
      [this.name],
    );

    if (!result.rows.length) {
      await query(
        `INSERT INTO indexer_state (last_indexed_ledger, indexer_name)
         VALUES (0, $1)`,
        [this.name],
      );
      return 0;
    }

    return Number(result.rows[0]?.last_indexed_ledger ?? 0);
  }

  private async updateLastIndexedLedger(ledger: number): Promise<void> {
    const updateResult = await query(
      `UPDATE indexer_state
       SET last_indexed_ledger = GREATEST(last_indexed_ledger, $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE indexer_name = $2`,
      [ledger, this.name],
    );

    if ((updateResult.rowCount ?? 0) === 0) {
      await query(
        `INSERT INTO indexer_state (last_indexed_ledger, indexer_name)
         VALUES ($1, $2)`,
        [ledger, this.name],
      );
    }
  }

  private async processChunk(
    startLedger: number,
    endLedger: number,
  ): Promise<ProcessChunkResult> {
    const correlationId = `indexer-${createRequestId()}`;

    return runWithRequestContext(correlationId, async () => {
      if (endLedger < startLedger) {
        return {
          lastProcessedLedger: endLedger,
          fetchedEvents: 0,
          insertedEvents: 0,
        };
      }

      try {
        const events = await this.fetchEventsInRange(startLedger, endLedger);
        if (events.length === 0) {
          return {
            lastProcessedLedger: endLedger,
            fetchedEvents: 0,
            insertedEvents: 0,
          };
        }

        const storeResult = await this.storeEvents(events);
        const maxLedger = events.reduce(
          (max, event) => Math.max(max, Number(event.ledger)),
          startLedger,
        );

        logger.info("Indexer processed chunk", {
          startLedger,
          endLedger,
          fetchedEvents: events.length,
          insertedEvents: storeResult.insertedCount,
        });

        return {
          lastProcessedLedger: Math.max(maxLedger, endLedger),
          fetchedEvents: events.length,
          insertedEvents: storeResult.insertedCount,
        };
      } catch (error) {
        logger.error("Error processing event chunk", {
          startLedger,
          endLedger,
          error,
        });
        throw error;
      }
    });
  }

  private async fetchEventsInRange(
    startLedger: number,
    endLedger: number,
  ): Promise<SorobanRawEvent[]> {
    const result: SorobanRawEvent[] = [];
    let cursor: string | undefined;
    let hasMorePages = true;

    while (hasMorePages) {
      const response = (await this.rpc.getEvents({
        startLedger,
        endLedger,
        cursor,
        limit: this.batchSize,
        filters: [
          {
            type: "contract",
            contractIds: [this.contractId],
          },
        ],
      } as never)) as unknown as {
        events?: SorobanRawEvent[];
        cursor?: string;
        nextCursor?: string;
      };

      const events = (response.events ?? []).filter(
        (event) => event.ledger >= startLedger && event.ledger <= endLedger,
      );

      result.push(...events);

      const nextCursor = response.nextCursor ?? response.cursor;
      if (!nextCursor || nextCursor === cursor || events.length === 0) {
        hasMorePages = false;
        continue;
      }

      cursor = nextCursor;
    }

    return result;
  }

  private async storeEvents(events: SorobanRawEvent[]): Promise<StoreEventsResult> {
    const parsedEvents: LoanEvent[] = [];

    for (const event of events) {
      try {
        const parsed = this.parseEvent(event);
        if (parsed) {
          parsedEvents.push(parsed);
        }
      } catch (error) {
        logger.warn("Failed to parse event", {
          eventId: event.id,
          error,
        });
        await this.quarantineEvent(event, error);
      }
    }

    if (parsedEvents.length === 0) {
      return { insertedCount: 0 };
    }

    const insertedEvents: LoanEvent[] = [];

    await query("BEGIN", []);
    try {
      for (const event of parsedEvents) {
        const insertResult = await query(
          `INSERT INTO loan_events (
            event_id,
            event_type,
            loan_id,
            borrower,
            amount,
            ledger,
            ledger_closed_at,
            tx_hash,
            contract_id,
            topics,
            value,
            interest_rate_bps,
            term_ledgers
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id`,
          [
            event.eventId,
            event.eventType,
            event.loanId ?? null,
            event.borrower || null,
            event.amount ?? null,
            event.ledger,
            event.ledgerClosedAt,
            event.txHash,
            event.contractId,
            JSON.stringify(event.topics),
            event.value,
            event.interestRateBps ?? null,
            event.termLedgers ?? null,
          ],
        );

        if ((insertResult.rowCount ?? 0) > 0) {
          insertedEvents.push(event);
          if (event.eventType === "LoanRepaid") {
            const { repaymentDelta } = sorobanService.getScoreConfig();
            await this.updateUserScore(event.borrower, repaymentDelta);
          } else if (event.eventType === "LoanDefaulted") {
            const { defaultPenalty } = sorobanService.getScoreConfig();
            await this.updateUserScore(event.borrower, -defaultPenalty);
          }
        }
      }

      await query("COMMIT", []);
    } catch (error) {
      await query("ROLLBACK", []);
      throw error;
    }

    for (const event of insertedEvents) {
      webhookService.dispatch(event).catch((error) => {
        logger.error("Webhook dispatch failed", {
          eventId: event.eventId,
          error,
        });
      });

      eventStreamService.broadcast({
        eventId: event.eventId,
        eventType: event.eventType,
        ...(event.loanId !== undefined ? { loanId: event.loanId } : {}),
        borrower: event.borrower,
        ...(event.amount !== undefined ? { amount: event.amount } : {}),
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt.toISOString(),
        txHash: event.txHash,
      });

      this.triggerNotification(event).catch((error) => {
        logger.error("Notification trigger failed", {
          eventId: event.eventId,
          error,
        });
      });
    }

    return {
      insertedCount: insertedEvents.length,
    };
  }

  private parseEvent(event: SorobanRawEvent): LoanEvent | null {
    const type = this.decodeEventType(event.topic[0]);
    if (!type) return null;

    let borrower = "";
    let loanId: number | undefined;
    let amount: string | undefined;
    let interestRateBps: number | undefined;
    let termLedgers: number | undefined;

    if (type === "LoanRequested") {
      if (!event.topic[1]) return null;
      borrower = this.decodeAddress(event.topic[1]);
      amount = this.decodeAmount(event.value);
    } else if (type === "LoanApproved") {
      if (!event.topic[1]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      if (loanId === undefined) return null;
      borrower = this.decodeAddress(event.value);
      interestRateBps = 1200;
      termLedgers = 17280;
    } else if (type === "LoanRepaid") {
      if (!event.topic[1] || !event.topic[2]) return null;
      borrower = this.decodeAddress(event.topic[1]);
      loanId = this.decodeLoanId(event.topic[2]);
      amount = this.decodeAmount(event.value);
    } else if (type === "LoanDefaulted") {
      if (!event.topic[1]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      if (loanId === undefined) return null;
      borrower = this.decodeAddress(event.value);
    } else if (type === "Seized") {
      if (!event.topic[1]) return null;
      borrower = this.decodeAddress(event.topic[1]);
    } else if (type === "Deposit" || type === "Withdraw") {
      if (!event.topic[1]) return null;
      borrower = this.decodeAddress(event.topic[1]);
      // LendingPool events: value is a tuple (amount, shares)
      const nativeValue = scValToNative(event.value);
      if (Array.isArray(nativeValue)) {
        amount = nativeValue[0].toString();
      } else {
        amount = nativeValue.toString();
      }
    } else if (type === "YieldDistributed") {
      amount = this.decodeAmount(event.value);
    } else if (type === "Mint" || type === "ScoreUpd" || type === "ScoreDecr") {
      if (!event.topic[1]) return null;
      borrower = this.decodeAddress(event.topic[1]);
    } else if (type === "Transfer") {
      if (!event.topic[1]) return null;
      borrower = this.decodeAddress(event.topic[1]); // 'from' address
    }

    return {
      eventId: event.id,
      eventType: type,
      ledger: event.ledger,
      ledgerClosedAt: new Date(event.ledgerClosedAt),
      txHash: event.txHash,
      contractId: event.contractId.toString(),
      topics: event.topic.map((topic) => topic.toXDR("base64")),
      value: event.value.toXDR("base64"),
      ...(amount !== undefined ? { amount } : {}),
      ...(loanId !== undefined ? { loanId } : {}),
      ...(interestRateBps !== undefined ? { interestRateBps } : {}),
      ...(termLedgers !== undefined ? { termLedgers } : {}),
      borrower,
    };
  }

  private async updateUserScore(userId: string, delta: number): Promise<void> {
    if (!userId) return;
    try {
      await query(
        `INSERT INTO scores (user_id, current_score)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET
           current_score = LEAST(850, GREATEST(300, scores.current_score + $3)),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, 500 + delta, delta],
      );
      logger.info("Updated user score from indexed event", {
        userId,
        delta,
      });
    } catch (error) {
      logger.error("Failed to update user score", { userId, error });
    }
  }

  private async triggerNotification(event: LoanEvent): Promise<void> {
    if (!event.borrower) return;

    let type = "";
    let title = "";
    let message = "";

    switch (event.eventType) {
      case "LoanApproved":
        type = "loan_approved";
        title = "Loan Approved";
        message = event.loanId
          ? `Your loan #${event.loanId} has been approved.`
          : "Your loan has been approved.";
        break;
      case "LoanRepaid":
        type = "repayment_confirmed";
        title = "Repayment Confirmed";
        message = event.loanId
          ? `Repayment for loan #${event.loanId} has been confirmed.`
          : "Your loan repayment has been confirmed.";
        break;
      case "LoanDefaulted":
        type = "loan_defaulted";
        title = "Loan Defaulted";
        message = event.loanId
          ? `Loan #${event.loanId} has been marked as defaulted.`
          : "A loan has been marked as defaulted.";
        break;
      default:
        return;
    }

    await query(
      `INSERT INTO notifications (user_id, type, title, message, loan_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [event.borrower, type, title, message, event.loanId ?? null],
    );
  }

  private decodeAddress(value: xdr.ScVal): string {
    const native = scValToNative(value);
    if (typeof native !== "string") {
      throw new Error(
        `Expected address string, got ${typeof native}: ${String(native)}`,
      );
    }
    return native;
  }

  private decodeAmount(value: xdr.ScVal): string {
    const native = scValToNative(value);
    if (typeof native !== "bigint" && typeof native !== "number") {
      throw new Error(
        `Expected numeric amount, got ${typeof native}: ${String(native)}`,
      );
    }
    return native.toString();
  }

  private decodeLoanId(value: xdr.ScVal): number | undefined {
    try {
      return Number(scValToNative(value));
    } catch {
      return undefined;
    }
  }

  private async quarantineEvent(
    event: SorobanRawEvent,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let rawTopics: string[] = [];
    let rawValue = "";
    try {
      rawTopics = event.topic.map((t) => t.toXDR("base64"));
      rawValue = event.value.toXDR("base64");
    } catch {
      // XDR serialisation itself failed; store empty strings so the row is
      // still inserted and the error_message captures the original failure.
    }

    const rawXdr = {
      id: event.id,
      topics: rawTopics,
      value: rawValue,
      ledger: event.ledger,
      txHash: event.txHash,
      contractId: event.contractId,
    };

    logger.warn("Quarantining malformed event", {
      eventId: event.id,
      ledger: event.ledger,
      txHash: event.txHash,
      rawXdr,
      error: errorMessage,
    });

    try {
      await query(
        `INSERT INTO quarantine_events (event_id, ledger, tx_hash, contract_id, raw_xdr, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.id,
          event.ledger,
          event.txHash,
          event.contractId,
          JSON.stringify(rawXdr),
          errorMessage,
        ],
      );
    } catch (dbError) {
      logger.error("Failed to quarantine malformed event", {
        eventId: event.id,
        dbError,
      });
    }
  }

  private decodeEventType(value: xdr.ScVal | undefined): WebhookEventType | null {
    if (!value) return null;

    try {
      const eventType = value.sym().toString();
      const supported: string[] = [
        "LoanRequested",
        "LoanApproved",
        "LoanRepaid",
        "LoanDefaulted",
        "Seized",
        "Paused",
        "Unpaused",
        "MinScoreUpdated",
        "Deposit",
        "Withdraw",
        "YieldDistributed",
        "Mint",
        "ScoreUpd",
        "ScoreDecr",
        "HashUpd",
        "Transfer",
        "PoolPaused",
        "PoolUnpaused",
      ];

      if (eventType === "PoolPaused") return "Paused";
      if (eventType === "PoolUnpaused") return "Unpaused";

      return supported.includes(eventType)
        ? (eventType as WebhookEventType)
        : null;
    } catch {
      return null;
    }
  }
}
