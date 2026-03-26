import crypto from "crypto";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  "LoanRequested",
  "LoanApproved",
  "LoanRejected",
  "LoanDisbursed",
  "LoanRepaid",
  "LoanDefaulted",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENT_TYPES)[number];

export interface IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
  loanId?: number;
  borrower: string;
  amount?: string;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

interface WebhookSubscription {
  id: number;
  callback_url: string;
  event_types: WebhookEventType[];
  secret: string | null;
}

const MAX_WEBHOOK_ATTEMPTS = parseInt(
  process.env.WEBHOOK_MAX_ATTEMPTS || "3",
  10,
);
const INITIAL_RETRY_DELAY_MS = parseInt(
  process.env.WEBHOOK_INITIAL_RETRY_DELAY_MS || "500",
  10,
);

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toEventTypes = (value: unknown): WebhookEventType[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((eventType): eventType is WebhookEventType =>
    SUPPORTED_WEBHOOK_EVENT_TYPES.includes(eventType as WebhookEventType),
  );
};

const createSignature = (payload: string, timestamp: string, secret: string) =>
  crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

export class WebhookService {
  async registerSubscription(input: {
    callbackUrl: string;
    eventTypes: WebhookEventType[];
    secret?: string;
  }) {
    const result = await query(
      `INSERT INTO webhook_subscriptions (callback_url, event_types, secret)
       VALUES ($1, $2::jsonb, $3)
       RETURNING id, callback_url, event_types, is_active, created_at, updated_at`,
      [
        input.callbackUrl,
        JSON.stringify(input.eventTypes),
        input.secret || null,
      ],
    );

    return this.normalizeSubscription(result.rows[0]);
  }

  async listSubscriptions() {
    const result = await query(
      `SELECT id, callback_url, event_types, is_active, created_at, updated_at
       FROM webhook_subscriptions
       ORDER BY created_at DESC`,
    );

    return result.rows.map((row) => this.normalizeSubscription(row));
  }

  async deleteSubscription(id: number) {
    const result = await query(
      "DELETE FROM webhook_subscriptions WHERE id = $1 RETURNING id",
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async deliverEvent(event: IndexedLoanEvent) {
    // Send user notifications for loan events
    await this.sendUserNotifications(event);

    const result = await query(
      `SELECT id, callback_url, event_types, secret
       FROM webhook_subscriptions
       WHERE is_active = true
         AND event_types @> $1::jsonb`,
      [JSON.stringify([event.eventType])],
    );

    const subscriptions = result.rows
      .map((row) => this.normalizeDeliverySubscription(row))
      .filter((subscription) => subscription.event_types.length > 0);

    await Promise.all(
      subscriptions.map((subscription) =>
        this.deliverToSubscription(subscription, event),
      ),
    );
  }

  private async deliverToSubscription(
    subscription: WebhookSubscription,
    event: IndexedLoanEvent,
  ) {
    const deliveryId = await this.createDeliveryRecord(subscription.id, event);
    const payload = JSON.stringify({
      eventId: event.eventId,
      eventType: event.eventType,
      loanId: event.loanId ?? null,
      borrower: event.borrower,
      amount: event.amount ?? null,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt.toISOString(),
      txHash: event.txHash,
      contractId: event.contractId,
      topics: event.topics,
      value: event.value,
    });

    let attemptCount = 0;
    let lastStatusCode: number | null = null;
    let lastError: string | null = null;

    while (attemptCount < MAX_WEBHOOK_ATTEMPTS) {
      attemptCount += 1;
      const timestamp = new Date().toISOString();
      const secret =
        subscription.secret || process.env.WEBHOOK_SIGNING_SECRET || "";
      const signature = secret
        ? createSignature(payload, timestamp, secret)
        : undefined;

      try {
        const response = await fetch(subscription.callback_url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "RemitLend-Webhook/1.0",
            "x-remitlend-delivery": `${deliveryId}`,
            "x-remitlend-event": event.eventType,
            "x-remitlend-timestamp": timestamp,
            ...(signature
              ? { "x-remitlend-signature": `sha256=${signature}` }
              : {}),
          },
          body: payload,
        });

        lastStatusCode = response.status;
        if (response.ok) {
          await this.markDeliveryResult(deliveryId, {
            attemptCount,
            lastStatusCode,
            delivered: true,
          });
          return;
        }

        lastError = `Webhook endpoint responded with ${response.status}`;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : "Unknown webhook delivery error";
      }

      if (attemptCount < MAX_WEBHOOK_ATTEMPTS) {
        await sleep(INITIAL_RETRY_DELAY_MS * 2 ** (attemptCount - 1));
      }
    }

    await this.markDeliveryResult(deliveryId, {
      attemptCount,
      lastStatusCode,
      delivered: false,
      lastError,
    });

    logger.warn("Webhook delivery failed after retries", {
      deliveryId,
      subscriptionId: subscription.id,
      eventId: event.eventId,
      lastStatusCode,
      lastError,
    });
  }

  private async createDeliveryRecord(
    subscriptionId: number,
    event: IndexedLoanEvent,
  ) {
    const result = await query(
      `INSERT INTO webhook_deliveries (subscription_id, event_id, event_type)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [subscriptionId, event.eventId, event.eventType],
    );

    return result.rows[0].id as number;
  }

  private async markDeliveryResult(
    deliveryId: number,
    input: {
      attemptCount: number;
      lastStatusCode: number | null;
      delivered: boolean;
      lastError?: string | null;
    },
  ) {
    await query(
      `UPDATE webhook_deliveries
       SET attempt_count = $2,
           last_status_code = $3,
           last_error = $4,
           delivered_at = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        deliveryId,
        input.attemptCount,
        input.lastStatusCode,
        input.lastError || null,
        input.delivered ? new Date() : null,
      ],
    );
  }

  private normalizeSubscription(row: Record<string, unknown>) {
    return {
      id: row.id,
      callbackUrl: row.callback_url,
      eventTypes: toEventTypes(row.event_types),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizeDeliverySubscription(
    row: Record<string, unknown>,
  ): WebhookSubscription {
    return {
      id: Number(row.id),
      callback_url: String(row.callback_url),
      event_types: toEventTypes(row.event_types),
      secret: row.secret ? String(row.secret) : null,
    };
  }

  private async sendUserNotifications(event: IndexedLoanEvent) {
    try {
      const { loanEventNotifier } = await import("./loanEventNotifier.js");
      
      switch (event.eventType) {
        case "LoanRequested":
        case "LoanApproved":
        case "LoanRejected":
          await loanEventNotifier.notifyLoanApplicationStatusChange(event);
          break;
        case "LoanDisbursed":
          await loanEventNotifier.notifyLoanDisbursed(event);
          break;
        case "LoanRepaid":
          await loanEventNotifier.notifyLoanRepaid(event);
          break;
        default:
          logger.debug("No notification handler for event type", { eventType: event.eventType });
      }
    } catch (error) {
      logger.error("Failed to send user notifications for loan event", {
        eventType: event.eventType,
        loanId: event.loanId,
        borrower: event.borrower,
        error,
      });
    }
  }
}

export const webhookService = new WebhookService();
