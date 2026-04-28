import { rpc as SorobanRpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { type PoolClient, query, withTransaction } from "../db/connection.js";
import logger from "../utils/logger.js";
import {
  createRequestId,
  runWithRequestContext,
} from "../utils/requestContext.js";
import {
  type IndexedLoanEvent,
  SUPPORTED_WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
  webhookService,
} from "./webhookService.js";
import { eventStreamService } from "./eventStreamService.js";
import {
  notificationService,
  type NotificationType,
} from "./notificationService.js";
import { sorobanService } from "./sorobanService.js";
import { updateUserScoresBulk } from "./scoresService.js";
import { AppError } from "../errors/AppError.js";

const EVENT_TYPE_ALIASES: Record<string, WebhookEventType> = {
  Mint: "NFTMinted",
  AdmRemint: "NFTMinted",
  ScoreUpd: "ScoreUpdated",
  Seized: "NFTSeized",
  NftBurned: "NFTBurned",
  GovProp: "ProposalCreated",
  GovAppr: "ProposalApproved",
  GovFin: "ProposalFinalized",
  GovCncl: "ProposalCancelled",
  GovEmerg: "ProposalCancelled",
  GovExp: "ProposalCancelled",
};

export interface SorobanRawEvent {
  id: string;
  pagingToken: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
}

interface ContractEvent extends IndexedLoanEvent {
  amount?: string;
  loanId?: number;
  address?: string;
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
  rpcUrl: string;
  contractId?: string;
  contractIds?: string[];
  contractConfigs?: Array<{ contractId: string }>;
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
  private readonly rpc: SorobanRpc.Server;
  private readonly contractIds: string[];
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly quarantineAlertThreshold: number;
  private lastObservedQuarantineCount = 0;
  private running = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor(config: EventIndexerConfig);
  constructor(rpcUrl: string, contractId: string);
  constructor(
    configOrRpcUrl: EventIndexerConfig | string,
    contractId?: string,
  ) {
    const thresholdRaw = Number.parseInt(
      process.env.QUARANTINE_ALERT_THRESHOLD ?? "25",
      10,
    );
    this.quarantineAlertThreshold =
      Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 25;

    if (typeof configOrRpcUrl === "string") {
      if (!contractId) {
        throw new Error("contractId is required when using rpcUrl constructor");
      }
      this.rpc = new SorobanRpc.Server(configOrRpcUrl);
      this.contractIds = [contractId];
      this.pollIntervalMs = 30_000;
      this.batchSize = 100;
      return;
    }

    this.rpc = new SorobanRpc.Server(configOrRpcUrl.rpcUrl);
    const configuredIds = configOrRpcUrl.contractIds ?? [];
    const configuredFromObjects = (configOrRpcUrl.contractConfigs ?? []).map(
      (config) => config.contractId,
    );
    const normalized = [
      ...configuredFromObjects,
      ...configuredIds,
      ...(configOrRpcUrl.contractId ? [configOrRpcUrl.contractId] : []),
    ].filter(Boolean);
    if (normalized.length === 0) {
      throw new Error("At least one contractId must be configured for indexer");
    }
    this.contractIds = [...new Set(normalized)];
    this.pollIntervalMs = configOrRpcUrl.pollIntervalMs ?? 30_000;
    this.batchSize = configOrRpcUrl.batchSize ?? 100;
  }

  async ingestRawEvents(events: SorobanRawEvent[]): Promise<StoreEventsResult> {
    return this.storeEvents(events);
  }

  isEventParseable(event: SorobanRawEvent): boolean {
    try {
      return this.parseEvent(event) !== null;
    } catch {
      return false;
    }
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

  async reindexRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<{
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
      const latest = (await (
        this.rpc as unknown as {
          getLatestLedger: () => Promise<Record<string, unknown>>;
        }
      ).getLatestLedger()) as Record<string, unknown>;

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
       ORDER BY id DESC
       LIMIT 1`,
      [],
    );

    if (!result.rows.length) {
      await query(
        `INSERT INTO indexer_state (last_indexed_ledger)
         VALUES (0)`,
        [],
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
       WHERE id = (
         SELECT id
         FROM indexer_state
         ORDER BY id DESC
         LIMIT 1
       )`,
      [ledger],
    );

    if ((updateResult.rowCount ?? 0) === 0) {
      await query(
        `INSERT INTO indexer_state (last_indexed_ledger)
         VALUES ($1)`,
        [ledger],
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
        logger.warn("Skipping invalid ledger range", {
          startLedger,
          endLedger,
        });
        return {
          lastProcessedLedger: Math.max(startLedger - 1, 0),
          fetchedEvents: 0,
          insertedEvents: 0,
        };
        throw AppError.badRequest(
          `Invalid ledger range: endLedger (${endLedger}) cannot be less than startLedger (${startLedger})`,
        );
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
            contractIds: this.contractIds,
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

    // Sort events by ledger to ensure consistent processing order
    return result.sort((a, b) => Number(a.ledger) - Number(b.ledger));
  }

  private async storeEvents(
    events: SorobanRawEvent[],
  ): Promise<StoreEventsResult> {
    const parsedEvents: ContractEvent[] = [];
    let quarantineAttempts = 0;

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
        quarantineAttempts += 1;
        await this.quarantineEvent(event, error);
      }
    }

    if (quarantineAttempts > 0) {
      await this.logQuarantineGrowth(quarantineAttempts);
    }

    if (parsedEvents.length === 0) {
      return { insertedCount: 0 };
    }

    const insertedEvents: ContractEvent[] = [];

    // Collect score deltas per user within the transaction so that the score
    // upsert is atomic with the event inserts. A single bulk upsert at the
    // end avoids N+1 queries and keeps scores within [300, 850].
    const scoreUpdates: Map<string, number> = new Map();

    await withTransaction(async (client: PoolClient) => {
      for (const event of parsedEvents) {
        const insertResult = await client.query(
          `INSERT INTO loan_events (
            event_id,
            event_type,
            loan_id,
            address,
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
          ON CONFLICT DO NOTHING
          RETURNING event_id`,
          [
            event.eventId,
            event.eventType,
            event.loanId ?? null,
            event.address ?? null,
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

          // Aggregate score deltas per borrower; a single bulk upsert at
          // the end of the transaction avoids N+1 score updates.
          if (event.eventType === "LoanRepaid") {
            const { repaymentDelta } = sorobanService.getScoreConfig();
            if (event.address) {
              scoreUpdates.set(
                event.address,
                (scoreUpdates.get(event.address) ?? 0) + repaymentDelta,
              );
            }
          } else if (event.eventType === "LoanDefaulted" || event.eventType === "CollateralLiquidated") {
            const { defaultPenalty } = sorobanService.getScoreConfig();
            if (event.address) {
              scoreUpdates.set(
                event.address,
                (scoreUpdates.get(event.address) ?? 0) - defaultPenalty,
              );
            }
          }
        }
      }

      // Apply batched score updates on the same pinned client so that both
      // the event inserts and the score changes are committed or rolled back
      // together — satisfying the atomicity requirement.
      if (scoreUpdates.size > 0) {
        await updateUserScoresBulk(scoreUpdates, client);
      }
    });
    // withTransaction commits here; any error triggers automatic ROLLBACK

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
        address: event.address,
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

  private parseEvent(event: SorobanRawEvent): ContractEvent | null {
    const type = this.decodeEventType(event.topic[0]);
    if (!type) return null;

    let loanId: number | undefined;
    let address: string | undefined;
    let amount: string | undefined;
    let interestRateBps: number | undefined;
    let termLedgers: number | undefined;

    if (type === "LoanRequested") {
      if (!event.topic[1] || !event.topic[2]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      if (loanId === undefined) return null;
      address = this.decodeAddress(event.topic[2]);
      amount = this.decodeAmount(event.value);
    } else if (type === "LoanApproved") {
      if (!event.topic[1] || !event.topic[2]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      if (loanId === undefined) return null;
      address = this.decodeAddress(event.topic[2]);

      const data = scValToNative(event.value);
      if (!Array.isArray(data) || data.length < 2) {
        throw new Error(
          `LoanApproved event missing interest_rate_bps or term_ledgers: ${event.id}`,
        );
      }

      interestRateBps = Number(data[0]);
      termLedgers = Number(data[1]);

      if (!Number.isFinite(interestRateBps)) {
        throw new Error(
          `LoanApproved event has invalid interest_rate_bps: ${event.id}`,
        );
      }
      if (!Number.isFinite(termLedgers)) {
        throw new Error(
          `LoanApproved event has invalid term_ledgers: ${event.id}`,
        );
      }
    } else if (type === "LoanRepaid") {
      if (!event.topic[1] || !event.topic[2]) return null;
      address = this.decodeAddress(event.topic[1]);
      loanId = this.decodeLoanId(event.topic[2]);
      amount = this.decodeAmount(event.value);
    } else if (type === "LoanDefaulted") {
      if (!event.topic[1]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      if (loanId === undefined) return null;
      address = this.decodeAddress(event.value);
    } else if (type === "CollateralLiquidated") {
      if (!event.topic[1]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      if (loanId === undefined) return null;
      amount = this.decodeAmount(event.value);
    } else if (
      type === "Deposit" ||
      type === "Withdraw" ||
      type === "EmergencyWithdraw"
    ) {
      if (!event.topic[1]) return null;
      address = this.decodeAddress(event.topic[1]);
      // LP events have (amount, shares) in value
      amount = this.decodeTupleFirstNumericValue(event.value);
    } else if (
      type === "NFTMinted" ||
      type === "ScoreUpdated" ||
      type === "NFTSeized" ||
      type === "NFTBurned"
    ) {
      if (!event.topic[1]) return null;
      address = this.decodeAddress(event.topic[1]);
      if (type === "NFTMinted" || type === "ScoreUpdated") {
        amount = this.decodeAmount(event.value);
      }
    } else if (
      type === "ProposalCreated" ||
      type === "ProposalApproved" ||
      type === "ProposalFinalized" ||
      type === "ProposalCancelled"
    ) {
      if (!event.topic[1]) return null;
      address = this.decodeAddress(event.topic[1]);
    } else if (type === "Transfer") {
      // (from, to), ()
      if (event.topic[2]) {
        address = this.decodeAddress(event.topic[2]);
      }
    } else if (type === "LoanRefinanced") {
      // (type, loan_id, borrower), [new_amount, new_term]
      if (!event.topic[1] || !event.topic[2]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      address = this.decodeAddress(event.topic[2]);
      amount = this.decodeTupleFirstNumericValue(event.value);
    } else if (type === "LoanExtended") {
      // (type, loan_id, borrower), [new_due_ledger, fee_amount, extension_count]
      if (!event.topic[1] || !event.topic[2]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      address = this.decodeAddress(event.topic[2]);
      const data = scValToNative(event.value);
      if (Array.isArray(data) && data.length >= 2) {
        amount = data[1].toString();
      }
    } else if (type === "LoanCancelled") {
      // (type, borrower), loan_id
      if (!event.topic[1]) return null;
      address = this.decodeAddress(event.topic[1]);
      loanId = this.decodeLoanId(event.value);
    } else if (type === "LoanRejected") {
      // (type, loan_id), reason
      if (!event.topic[1]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
    } else if (type === "LateFeeCharged") {
      // (type, loan_id), amount
      if (!event.topic[1]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      amount = this.decodeAmount(event.value);
    } else if (type === "CollateralReturned") {
      // (type, borrower, loan_id), amount
      if (!event.topic[1] || !event.topic[2]) return null;
      address = this.decodeAddress(event.topic[1]);
      loanId = this.decodeLoanId(event.topic[2]);
      amount = this.decodeAmount(event.value);
    } else if (type === "YieldDistributed" || type === "DepositCapUpdated") {
      // (type, token), amount / [old, new]
      if (!event.topic[1]) return null;
      address = this.decodeAddress(event.topic[1]);
      if (type === "YieldDistributed") {
        amount = this.decodeAmount(event.value);
      } else {
        const data = scValToNative(event.value);
        if (Array.isArray(data) && data.length >= 2) {
          amount = data[1].toString();
        }
      }
    } else if (type === "WithdrawalCooldownUpdated") {
      // (type), [old, new]
      const data = scValToNative(event.value);
      if (Array.isArray(data) && data.length >= 2) {
        amount = data[1].toString();
      }
    } else if (type === "PoolPaused" || type === "PoolUnpaused") {
      // (type)
    } else if (type === "ColDep" || type === "ColRel") {
      // (loan_id, borrower), amount
      if (event.topic[1]) {
        loanId = this.decodeLoanId(event.topic[1]);
      }
      if (event.topic[2]) {
        address = this.decodeAddress(event.topic[2]);
      }
      if (type === "ColDep") {
        amount = this.decodeAmount(event.value);
      }
    } else if (type === "ScoreDecr") {
      // (old_score, new_score, symbol)
      if (!event.topic[1]) return null;
      address = this.decodeAddress(event.topic[1]);
      const data = scValToNative(event.value);
      if (Array.isArray(data) && data.length >= 2) {
        amount = data[1].toString();
      }
    } else if (type === "LoanApprv") {
      // (type, admin), (loan_id, borrower)
      const data = scValToNative(event.value);
      if (Array.isArray(data) && data.length >= 2) {
        loanId = Number(data[0]);
        address = data[1].toString();
      }
    } else if (type === "LoanLiquidated") {
      // (type, loan_id, borrower, liquidator), (debt_repaid, liquidator_bonus, borrower_refund)
      if (!event.topic[1] || !event.topic[2]) return null;
      loanId = this.decodeLoanId(event.topic[1]);
      address = this.decodeAddress(event.topic[2]);
      amount = this.decodeTupleFirstNumericValue(event.value);
    }

    return {
      eventId: event.id,
      eventType: type as WebhookEventType,
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
      address,
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

  private async triggerNotification(event: ContractEvent): Promise<void> {
    if (!event.address) return;

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
      case "CollateralLiquidated":
        type = "loan_defaulted";
        title = "Collateral Seized";
        message = event.loanId
          ? `Collateral for loan #${event.loanId} has been seized due to default.`
          : "Collateral has been seized due to a loan default.";
        break;
      default:
        return;
    }

    await notificationService.createNotification({
      userId: event.address,
      type: type as NotificationType,
      title,
      message,
      loanId: event.loanId,
    });
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

  private decodeTupleFirstNumericValue(value: xdr.ScVal): string | undefined {
    const native = scValToNative(value);
    if (!Array.isArray(native) || native.length === 0) {
      return undefined;
    }
    const first = native[0];
    if (typeof first === "bigint" || typeof first === "number") {
      return first.toString();
    }
    return undefined;
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
      ledgerClosedAt: event.ledgerClosedAt,
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

  private async logQuarantineGrowth(newlyQuarantined: number): Promise<void> {
    try {
      const result = await query(
        "SELECT COUNT(*)::int AS count FROM quarantine_events",
        [],
      );
      const totalCount = Number(result.rows[0]?.count ?? 0);
      const previousCount = this.lastObservedQuarantineCount;

      if (totalCount > previousCount) {
        logger.warn("Quarantine event count increased", {
          previousCount,
          totalCount,
          delta: totalCount - previousCount,
          newlyQuarantined,
        });

        if (
          previousCount < this.quarantineAlertThreshold &&
          totalCount >= this.quarantineAlertThreshold
        ) {
          logger.error("Quarantine event count exceeded alert threshold", {
            threshold: this.quarantineAlertThreshold,
            totalCount,
          });
        }
      }

      this.lastObservedQuarantineCount = Math.max(previousCount, totalCount);
    } catch (error) {
      logger.error("Failed to check quarantine event count", { error });
    }
  }

  private decodeEventType(
    value: xdr.ScVal | undefined,
  ): WebhookEventType | null {
    if (!value) return null;

    try {
      const rawType = value.sym().toString();
      const normalizedType = EVENT_TYPE_ALIASES[rawType] ?? rawType;

      return SUPPORTED_WEBHOOK_EVENT_TYPES.includes(
        normalizedType as WebhookEventType,
      )
        ? (normalizedType as WebhookEventType)
        : null;
    } catch {
      return null;
    }
  }
}
