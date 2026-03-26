import { rpc, xdr } from "@stellar/stellar-sdk";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import {
  webhookService,
  type IndexedLoanEvent,
  type WebhookEventType,
} from "./webhookService.js";
import { notificationService } from "./notificationService.js";

interface IndexerConfig {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs: number;
  batchSize: number;
}

interface LoanEvent extends IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
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

export class EventIndexer {
  private server: rpc.Server;
  private config: IndexerConfig;
  private isRunning: boolean = false;
  private pollTimeout?: NodeJS.Timeout;

  constructor(config: IndexerConfig) {
    this.config = config;
    this.server = new rpc.Server(config.rpcUrl);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("Starting event indexer");
    await this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;
    try {
      await this.indexEvents();
    } catch (error) {
      logger.error("Indexing error", { error });
    }
    this.pollTimeout = setTimeout(
      () => this.poll(),
      this.config.pollIntervalMs,
    );
  }

  private async indexEvents(): Promise<void> {
    const state = await this.getIndexerState();
    const response = await this.server.getEvents({
      startLedger: state.lastIndexedLedger + 1,
      filters: [{ type: "contract", contractIds: [this.config.contractId] }],
      limit: this.config.batchSize,
    });
    if (!response.events?.length) return;

    const events = await this.processEvents(response.events);
    await this.storeEvents(events);
    const last = response.events[response.events.length - 1];
    if (last) await this.updateIndexerState(last.ledger, response.cursor || "");
  }

  private async processEvents(
    events: rpc.Api.EventResponse[],
  ): Promise<LoanEvent[]> {
    const result: LoanEvent[] = [];
    for (const e of events) {
      try {
        if (
          e.type !== "contract" ||
          !e.topic?.[0] ||
          !e.topic[1] ||
          !e.contractId
        )
          continue;
        const type = this.decodeEventType(e.topic[0]);
        if (!type) continue;

        let borrower = "";
        let loanId: number | undefined;
        let amount: string | undefined;
        let interestRateBps: number | undefined;
        let termLedgers: number | undefined;

        if (type === "LoanRequested") {
          borrower = this.decodeAddress(e.topic[1]);
          amount = this.decodeAmount(e.value);
        } else if (type === "LoanApproved") {
          loanId = this.decodeLoanId(e.topic[1]);
          if (loanId === undefined) continue;
          // Capture current contract defaults at time of approval
          interestRateBps = 1200; // Matches contract DEFAULT_INTEREST_RATE_BPS
          termLedgers = 17280; // Matches contract DEFAULT_TERM_LEDGERS
        } else if (type === "LoanRepaid") {
          if (!e.topic[2]) continue;
          borrower = this.decodeAddress(e.topic[1]);
          loanId = this.decodeLoanId(e.topic[2]);
          if (loanId === undefined) continue;
          amount = this.decodeAmount(e.value);
        } else if (type === "LoanDefaulted") {
          loanId = this.decodeLoanId(e.topic[1]);
          if (loanId === undefined) continue;
          borrower = this.decodeAddress(e.value);
        } else if (type === "Seized") {
          borrower = this.decodeAddress(e.topic[1]);
        }

        const evt: LoanEvent = {
          eventId: e.id,
          eventType: type,
          borrower,
          ledger: e.ledger,
          ledgerClosedAt: new Date(e.ledgerClosedAt),
          txHash: e.txHash,
          contractId: e.contractId.toString(),
          topics: e.topic.map((t: any) => t.toXDR("base64")),
          value: e.value.toXDR("base64"),
          ...(amount !== undefined ? { amount } : {}),
          ...(loanId !== undefined ? { loanId } : {}),
          ...(interestRateBps !== undefined ? { interestRateBps } : {}),
          ...(termLedgers !== undefined ? { termLedgers } : {}),
        };
        result.push(evt);
      } catch (err) {
        logger.error("Process event error", { err });
      }
    }
    return result;
  }

  private async storeEvents(events: LoanEvent[]): Promise<void> {
    if (!events.length) return;
    try {
      await query("BEGIN", []);
      for (const e of events) {
        const ex = await query(
          "SELECT id FROM loan_events WHERE event_id = $1",
          [e.eventId],
        );
        if (ex.rows.length) continue;
        await query(
          `INSERT INTO loan_events (event_id, event_type, loan_id, borrower, amount, ledger, ledger_closed_at, tx_hash, contract_id, topics, value, interest_rate_bps, term_ledgers)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            e.eventId,
            e.eventType,
            e.loanId || null,
            e.borrower,
            e.amount || null,
            e.ledger,
            e.ledgerClosedAt,
            e.txHash,
            e.contractId,
            JSON.stringify(e.topics),
            e.value,
            e.interestRateBps || null,
            e.termLedgers || null,
          ],
        );

        // Update user credit score if it's a repayment
        if (e.eventType === "LoanRepaid") {
          await this.updateUserScore(e.borrower, 15); // +15 for repayment
        } else if (e.eventType === "LoanDefaulted") {
          await this.updateUserScore(e.borrower, -50); // penalty for default
        }
      }
      await query("COMMIT", []);

      // Create in-app notifications (fire-and-forget, outside DB transaction)
      await Promise.all(
        events.map((event) =>
          this.createNotificationForEvent(event).catch((err) => {
            logger.error("Notification creation error", { err, eventId: event.eventId });
          }),
        ),
      );

      await Promise.all(
        events.map((event) =>
          webhookService.deliverEvent(event).catch((error) => {
            logger.error("Webhook delivery processing error", {
              error,
              eventId: event.eventId,
            });
          }),
        ),
      );
    } catch (err) {
      await query("ROLLBACK", []);
      throw err;
    }
  }

  private async createNotificationForEvent(event: LoanEvent): Promise<void> {
    if (!event.borrower) return;

    type NotifParams = Parameters<typeof notificationService.createNotification>[0];
    let params: NotifParams | null = null;

    switch (event.eventType) {
      case "LoanApproved":
        params = {
          userId: event.borrower,
          type: "loan_approved",
          title: "Loan Approved",
          message: event.loanId
            ? `Your loan #${event.loanId} has been approved.`
            : "Your loan has been approved.",
          ...(event.loanId !== undefined ? { loanId: event.loanId } : {}),
        };
        break;
      case "LoanRepaid":
        params = {
          userId: event.borrower,
          type: "repayment_confirmed",
          title: "Repayment Confirmed",
          message: event.loanId
            ? `Repayment for loan #${event.loanId} has been confirmed.`
            : "Your loan repayment has been confirmed.",
          ...(event.loanId !== undefined ? { loanId: event.loanId } : {}),
        };
        break;
      case "LoanDefaulted":
        params = {
          userId: event.borrower,
          type: "loan_defaulted",
          title: "Loan Defaulted",
          message: event.loanId
            ? `Loan #${event.loanId} has been marked as defaulted.`
            : "A loan has been marked as defaulted.",
          ...(event.loanId !== undefined ? { loanId: event.loanId } : {}),
        };
        break;
      default:
        // LoanRequested does not need a notification (user triggered it)
        return;
    }

    if (params) {
      await notificationService.createNotification(params);
    }
  }

  private async updateUserScore(userId: string, delta: number): Promise<void> {
    const result = await query(
      `INSERT INTO scores (user_id, current_score)
       VALUES ($1, $2)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         current_score = LEAST(850, GREATEST(300, scores.current_score + $3)),
         updated_at = CURRENT_TIMESTAMP
       RETURNING current_score`,
      [userId, 500 + delta, delta],
    );
    logger.info("Updated user score from indexer", { userId, delta });

    // Notify user about score change
    const newScore = result.rows[0]?.current_score as number | undefined;
    if (newScore !== undefined) {
      await notificationService.createNotification({
        userId,
        type: "score_changed",
        title: "Credit Score Updated",
        message: `Your credit score has been updated to ${newScore}.`,
      }).catch((err) => logger.error("Score notification error", { err, userId }));
    }
  }

  private async getIndexerState() {
    const r = await query(
      "SELECT last_indexed_ledger, last_indexed_cursor FROM indexer_state ORDER BY id DESC LIMIT 1",
      [],
    );
    const row = r.rows[0] as
      | { last_indexed_ledger?: number; last_indexed_cursor?: string | null }
      | undefined;

    return {
      lastIndexedLedger: row?.last_indexed_ledger ?? 0,
      lastIndexedCursor: row?.last_indexed_cursor ?? null,
    };
  }

  private async updateIndexerState(ledger: number, cursor: string) {
    await query(
      "UPDATE indexer_state SET last_indexed_ledger = $1, last_indexed_cursor = $2, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM indexer_state ORDER BY id DESC LIMIT 1)",
      [ledger, cursor],
    );
  }

  private decodeEventType(x: xdr.ScVal): WebhookEventType | null {
    try {
      const s = x.sym().toString();
      const supported: string[] = [
        "LoanRequested",
        "LoanApproved",
        "LoanRepaid",
        "LoanDefaulted",
        "Seized",
        "Paused",
        "Unpaused",
        "MinScoreUpdated",
      ];
      return supported.includes(s) ? (s as WebhookEventType) : null;
    } catch {
      return null;
    }
  }
  private decodeAddress(x: xdr.ScVal): string {
    try {
      return x.address().toString();
    } catch {
      return "";
    }
  }
  private decodeAmount(x: xdr.ScVal): string | undefined {
    try {
      return x.i128().toString();
    } catch {
      return undefined;
    }
  }
  private decodeLoanId(x: xdr.ScVal): number | undefined {
    try {
      return x.u32();
    } catch {
      return undefined;
    }
  }
}
