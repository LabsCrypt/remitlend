import crypto from "node:crypto";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  "LoanRequested",
  "LoanApproved",
  "LoanRepaid",
  "LoanDefaulted",
  "Seized",
  "Paused",
  "Unpaused",
  "MinScoreUpdated",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENT_TYPES)[number];

export interface IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
  loanId?: number;
  borrower: string;
  amount?: string;
  interestRateBps?: number;
  termLedgers?: number;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

export interface WebhookSubscription {
  id: number;
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: number;
  subscriptionId: number;
  eventId: string;
  eventType: WebhookEventType;
  attemptCount: number;
  lastStatusCode?: number;
  lastError?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface RegisterWebhookInput {
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string;
}

export class WebhookService {
  static isSupported(type: string): type is WebhookEventType {
    return SUPPORTED_WEBHOOK_EVENT_TYPES.includes(type as WebhookEventType);
  }

  async registerSubscription(
    input: RegisterWebhookInput,
  ): Promise<WebhookSubscription> {
    const result = await query(
      `INSERT INTO webhook_subscriptions (callback_url, event_types, secret, is_active)
       VALUES ($1, $2::jsonb, $3, true)
       RETURNING id, callback_url, event_types, secret, is_active, created_at, updated_at`,
      [input.callbackUrl, JSON.stringify(input.eventTypes), input.secret ?? null],
    );

    return this.mapSubscriptionRow(result.rows[0] as Record<string, unknown>);
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    const result = await query(
      `SELECT id, callback_url, event_types, secret, is_active, created_at, updated_at
       FROM webhook_subscriptions
       ORDER BY created_at DESC`,
      [],
    );

    return result.rows.map((row) =>
      this.mapSubscriptionRow(row as Record<string, unknown>),
    );
  }

  async deleteSubscription(id: number): Promise<boolean> {
    const result = await query(
      `DELETE FROM webhook_subscriptions
       WHERE id = $1`,
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getSubscriptionDeliveries(
    subscriptionId: number,
    limit: number = 50,
  ): Promise<WebhookDelivery[]> {
    const result = await query(
      `SELECT id, subscription_id, event_id, event_type, attempt_count, last_status_code,
              last_error, delivered_at, created_at, updated_at
       FROM webhook_deliveries
       WHERE subscription_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [subscriptionId, limit],
    );

    return result.rows.map((row) =>
      this.mapDeliveryRow(row as Record<string, unknown>),
    );
  }

  async dispatch(event: IndexedLoanEvent): Promise<void> {
    logger.info("Dispatching webhook event", {
      eventId: event.eventId,
      eventType: event.eventType,
      loanId: event.loanId,
      borrower: event.borrower,
    });

    try {
      const webhooksResult = await query(
        `SELECT id, callback_url, secret
         FROM webhook_subscriptions
         WHERE is_active = true
           AND event_types @> $1::jsonb`,
        [JSON.stringify([event.eventType])],
      );

      await Promise.all(
        webhooksResult.rows.map((hook) =>
          this.sendToWebhook(
            Number((hook as { id: number }).id),
            String((hook as { callback_url: string }).callback_url),
            ((hook as { secret?: string | null }).secret ?? undefined) ||
              undefined,
            event,
          ),
        ),
      );
    } catch (error) {
      logger.error("Error during webhook dispatch", {
        eventId: event.eventId,
        eventType: event.eventType,
        error,
      });
    }
  }

  private async sendToWebhook(
    subscriptionId: number,
    callbackUrl: string,
    secret: string | undefined,
    payload: IndexedLoanEvent,
  ): Promise<void> {
    const body = JSON.stringify(payload);

    const signature = secret
      ? crypto.createHmac("sha256", secret).update(body).digest("hex")
      : undefined;

    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(signature && { "x-remitlend-signature": signature }),
        },
        body,
      });

      const successful = response.ok;

      await query(
        `INSERT INTO webhook_deliveries (
          subscription_id,
          event_id,
          event_type,
          attempt_count,
          last_status_code,
          last_error,
          delivered_at
        )
        VALUES ($1, $2, $3, 1, $4, $5, $6)`,
        [
          subscriptionId,
          payload.eventId,
          payload.eventType,
          response.status,
          successful ? null : `Webhook returned status ${response.status}`,
          successful ? new Date() : null,
        ],
      );

      if (!successful) {
        logger.warn("Webhook delivery failed", {
          subscriptionId,
          callbackUrl,
          eventId: payload.eventId,
          statusCode: response.status,
        });
      }
    } catch (error) {
      await query(
        `INSERT INTO webhook_deliveries (
          subscription_id,
          event_id,
          event_type,
          attempt_count,
          last_error
        )
        VALUES ($1, $2, $3, 1, $4)`,
        [
          subscriptionId,
          payload.eventId,
          payload.eventType,
          error instanceof Error ? error.message : "Unknown webhook error",
        ],
      );

      logger.error("Failed to send webhook", {
        subscriptionId,
        callbackUrl,
        eventId: payload.eventId,
        error,
      });
    }
  }

  private mapSubscriptionRow(row: Record<string, unknown>): WebhookSubscription {
    const secret =
      typeof row.secret === "string" && row.secret.length > 0
        ? row.secret
        : undefined;

    return {
      id: Number(row.id),
      callbackUrl: String(row.callback_url),
      eventTypes: (row.event_types as WebhookEventType[]) ?? [],
      ...(secret ? { secret } : {}),
      isActive: Boolean(row.is_active),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }

  private mapDeliveryRow(row: Record<string, unknown>): WebhookDelivery {
    const lastStatusCode =
      typeof row.last_status_code === "number"
        ? row.last_status_code
        : row.last_status_code !== null && row.last_status_code !== undefined
          ? Number(row.last_status_code)
          : undefined;

    const lastError =
      typeof row.last_error === "string" && row.last_error.length > 0
        ? row.last_error
        : undefined;

    const deliveredAt = row.delivered_at
      ? new Date(String(row.delivered_at))
      : undefined;

    return {
      id: Number(row.id),
      subscriptionId: Number(row.subscription_id),
      eventId: String(row.event_id),
      eventType: String(row.event_type) as WebhookEventType,
      attemptCount: Number(row.attempt_count ?? 1),
      ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
      ...(lastError ? { lastError } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }
}

export const webhookService = new WebhookService();
